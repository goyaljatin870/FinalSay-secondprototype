"""Comparison tests: the 22-vs-15 Sept case, confidence gating to unresolved +
review_case creation, and relation-edge persistence with rationale."""

from __future__ import annotations

from sqlalchemy import select

from finalsay.models import RelationEdge, ReviewCase, Notice
from finalsay.models_iface.comparison_model import (
    MockComparisonModel,
    get_comparison_model,
)
from finalsay.services import comparison


def test_default_comparison_model_is_mock():
    model = get_comparison_model()
    assert model.name == "mock"


def test_postponed_22_vs_15_sept_not_consistent():
    model = MockComparisonModel()
    label, confidence, rationale = model.classify(
        "The exam is on 15 Sept.",
        "The exam is postponed to 22 Sept.",
    )
    assert label in ("contradictory", "superseded"), (label, rationale)
    assert label != "consistent"
    assert 0.0 <= confidence <= 1.0
    assert rationale


def _make_notice(db, kind, text, institution_id=1, action=None, audience=None):
    notice = Notice(
        kind=kind,
        institution_id=institution_id,
        issuer="Registrar",
        redacted_text=text,
        action=action,
        audience=audience,
    )
    db.add(notice)
    db.flush()
    return notice


def test_low_confidence_yields_unresolved_and_review_case(db_session):
    official = _make_notice(
        db_session,
        "official",
        "Library will operate on holiday hours next week.",
    )
    submission = _make_notice(
        db_session,
        "submission",
        "Cafeteria menu features seasonal vegetables.",
    )
    db_session.commit()

    # Deterministic low-confidence model to trigger gating.
    class _LowConf(MockComparisonModel):
        def classify(self, premise, hypothesis):
            return ("consistent", 0.3, "weak signal")

    outcome = comparison.classify_submission(
        db_session, submission, model=_LowConf(), threshold=0.6
    )
    db_session.commit()

    assert outcome.label == "unresolved"
    assert outcome.gated is True
    assert outcome.review_case is not None

    # A review_case row exists and points at the edge.
    cases = db_session.scalars(select(ReviewCase)).all()
    assert len(cases) == 1
    assert cases[0].edge_id == outcome.edge.id
    assert cases[0].status == "open"

    # The edge is persisted with rationale/model/status.
    edge = db_session.get(RelationEdge, outcome.edge.id)
    assert edge.label == "unresolved"
    assert edge.status == "unresolved"
    assert edge.model == "mock"
    assert edge.rationale
    assert "threshold" in edge.rationale.lower()


def test_model_unresolved_rationale_does_not_claim_high_score_is_below_threshold(db_session):
    official = _make_notice(
        db_session, "official", "The exam is scheduled on 15 Sept for all students."
    )
    submission = _make_notice(
        db_session, "submission", "The exam arrangements are described in this circular."
    )
    db_session.commit()

    class _Neutral(MockComparisonModel):
        def classify(self, premise, hypothesis):
            return ("unresolved", 0.99, "The model ranked neutral highest.")

    outcome = comparison.classify_submission(
        db_session, submission, model=_Neutral(), threshold=0.2
    )

    assert outcome.label == "unresolved"
    assert outcome.gated is True
    assert "routed to reviewer" in outcome.edge.rationale.lower()
    assert "below the threshold" not in outcome.edge.rationale.lower()


def test_high_confidence_persists_edge_without_review_case(db_session):
    official = _make_notice(
        db_session,
        "official",
        "The exam is scheduled on 15 Sept for all students.",
        action="exam on 15 Sept",
    )
    submission = _make_notice(
        db_session,
        "submission",
        "The exam is postponed to 22 Sept for all students.",
        action="exam postponed to 22 Sept",
    )
    db_session.commit()

    outcome = comparison.classify_submission(db_session, submission, threshold=0.6)
    db_session.commit()

    assert outcome.candidate is not None
    assert outcome.candidate.id == official.id
    assert outcome.label in ("contradictory", "superseded")
    assert outcome.review_case is None

    edge = db_session.get(RelationEdge, outcome.edge.id)
    assert edge.src_notice_id == submission.id
    assert edge.dst_notice_id == official.id
    assert edge.status == "auto"
    assert edge.rationale


def test_no_candidate_routes_to_unresolved(db_session):
    # Submission with no official notices in its institution.
    submission = _make_notice(
        db_session, "submission", "Some standalone submission.", institution_id=99
    )
    db_session.commit()

    outcome = comparison.classify_submission(db_session, submission)
    db_session.commit()

    assert outcome.label == "unresolved"
    assert outcome.review_case is not None


def test_reclassification_reuses_existing_open_review_case(db_session):
    submission = _make_notice(
        db_session, "submission", "Standalone submission with no official match.", institution_id=88
    )
    db_session.commit()

    outcome1 = comparison.classify_submission(db_session, submission)
    db_session.commit()
    assert outcome1.label == "unresolved"
    assert outcome1.review_case is not None

    cases_after_first = db_session.scalars(
        select(ReviewCase).where(ReviewCase.status == "open")
    ).all()
    assert len(cases_after_first) == 1
    original_case_id = cases_after_first[0].id

    # Second classification should reuse the open review case instead of creating a duplicate
    outcome2 = comparison.classify_submission(db_session, submission)
    db_session.commit()
    assert outcome2.label == "unresolved"
    assert outcome2.review_case.id == original_case_id
    assert outcome2.review_case.edge_id == outcome2.edge.id

    cases_after_second = db_session.scalars(
        select(ReviewCase).where(ReviewCase.status == "open")
    ).all()
    assert len(cases_after_second) == 1


def test_get_compare_api_is_idempotent(client, make_user, db_session):
    user = make_user("student_compare@finalsay.edu", "password123", "student")
    token_resp = client.post("/api/auth/login", data={"username": "student_compare@finalsay.edu", "password": "password123"})
    token = token_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    official = _make_notice(db_session, "official", "Official university notice on semester schedule.", institution_id=1)
    submission = Notice(
        kind="submission",
        institution_id=1,
        issuer="Registrar",
        redacted_text="Student copy of notice on semester schedule.",
        submitted_by=user.id,
    )
    db_session.add(submission)
    db_session.commit()

    # Initial GET /api/compare/{id} computes comparison
    res1 = client.get(f"/api/compare/{submission.id}", headers=headers)
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["submission_id"] == submission.id
    edge_id_1 = data1["edge_id"]

    # Second GET /api/compare/{id} reuses existing edge without adding duplicates
    res2 = client.get(f"/api/compare/{submission.id}", headers=headers)
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["edge_id"] == edge_id_1

    edges = db_session.scalars(
        select(RelationEdge).where(RelationEdge.src_notice_id == submission.id)
    ).all()
    assert len(edges) == 1


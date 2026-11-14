"""Comparison API (design.md section 7).

- ``GET /api/compare/{submission_id}``: return the latest classified relation
  edge and candidate for a submission (or compute it if not yet compared).
- ``POST /api/compare/{submission_id}``: re-run the configured ComparisonModel
  against candidate official notices for a submission, apply confidence gating,
  persist the new relation edge, and return the outcome.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from finalsay.auth import ensure_notice_access, require_role
from finalsay.db import get_db
from finalsay.models import Notice, NoticeDocumentExtraction, RelationEdge, ReviewCase, User
from finalsay.schemas import ComparisonResponse
from finalsay.services import comparison

router = APIRouter(prefix="/api/compare", tags=["comparison"])


def _outcome_to_response(
    submission: Notice, outcome: comparison.ComparisonOutcome, db: Session
) -> ComparisonResponse:
    candidate = outcome.candidate
    candidate_extractions = (
        list(
            db.scalars(
                select(NoticeDocumentExtraction)
                .where(NoticeDocumentExtraction.notice_id == candidate.id)
                .order_by(NoticeDocumentExtraction.extracted_at.desc())
            ).all()
        )
        if candidate
        else []
    )
    return ComparisonResponse(
        submission_id=submission.id,
        candidate_id=candidate.id if candidate else None,
        edge_id=outcome.edge.id,
        label=outcome.label,
        confidence=outcome.confidence,
        rationale=outcome.rationale,
        model=outcome.edge.model or "",
        status=outcome.edge.status,
        gated=outcome.gated,
        review_case_id=outcome.review_case.id if outcome.review_case else None,
        candidate_score=outcome.candidate_score,
        candidate_institution=(
            candidate.institution.name
            if candidate and candidate.institution
            else None
        ),
        candidate_issuer=candidate.issuer if candidate else None,
        candidate_notice_date=candidate.notice_date if candidate else None,
        candidate_deadline=candidate.deadline if candidate else None,
        candidate_source_url=candidate.source_url if candidate else None,
        candidate_text=candidate.redacted_text if candidate else None,
        candidate_supplemental_extractions=candidate_extractions,
        evidence=outcome.evidence,
    )


@router.get("/{submission_id}", response_model=ComparisonResponse)
def get_compare(
    submission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("student", "admin", "reviewer")),
) -> ComparisonResponse:
    submission = db.get(Notice, submission_id)
    if submission is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"notice {submission_id} not found",
        )
    if submission.kind != "submission":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="comparison requires a submission notice",
        )
    ensure_notice_access(submission, current_user)

    edge = db.scalars(
        select(RelationEdge)
        .where(RelationEdge.src_notice_id == submission_id)
        .order_by(RelationEdge.id.desc())
    ).first()

    if edge is not None:
        candidate = (
            db.get(Notice, edge.dst_notice_id)
            if edge.dst_notice_id != submission.id
            else None
        )
        review_case = db.scalars(
            select(ReviewCase)
            .where(ReviewCase.edge_id == edge.id)
            .order_by(ReviewCase.id.desc())
        ).first()
        gated = edge.status == "unresolved" or edge.label == "unresolved"
        candidate_extractions = (
            list(
                db.scalars(
                    select(NoticeDocumentExtraction)
                    .where(NoticeDocumentExtraction.notice_id == candidate.id)
                    .order_by(NoticeDocumentExtraction.extracted_at.desc())
                ).all()
            )
            if candidate
            else []
        )
        return ComparisonResponse(
            submission_id=submission.id,
            candidate_id=candidate.id if candidate else None,
            edge_id=edge.id,
            label=edge.label,
            confidence=edge.confidence,
            rationale=edge.rationale,
            model=edge.model or "",
            status=edge.status,
            gated=gated,
            review_case_id=review_case.id if review_case else None,
            candidate_score=None,
            candidate_institution=(
                candidate.institution.name
                if candidate and candidate.institution
                else None
            ),
            candidate_issuer=candidate.issuer if candidate else None,
            candidate_notice_date=candidate.notice_date if candidate else None,
            candidate_deadline=candidate.deadline if candidate else None,
            candidate_source_url=candidate.source_url if candidate else None,
            candidate_text=candidate.redacted_text if candidate else None,
            candidate_supplemental_extractions=candidate_extractions,
            evidence=[edge.rationale] if edge.rationale else [],
        )

    outcome = comparison.classify_submission(db, submission)
    db.commit()
    return _outcome_to_response(submission, outcome, db)


@router.post("/{submission_id}", response_model=ComparisonResponse)
def compare(
    submission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("student", "admin", "reviewer")),
) -> ComparisonResponse:
    submission = db.get(Notice, submission_id)
    if submission is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"notice {submission_id} not found",
        )
    if submission.kind != "submission":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="comparison requires a submission notice",
        )
    ensure_notice_access(submission, current_user)

    outcome = comparison.classify_submission(db, submission)
    db.commit()
    return _outcome_to_response(submission, outcome, db)

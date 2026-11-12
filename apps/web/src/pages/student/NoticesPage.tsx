import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, errorMessage } from '../../api/client'
import type { NoticeDetail, NoticeSummary } from '../../api/types'

// Browse official notices (GET /api/notices) and drill into detail + fields.
export default function NoticesPage() {
  const [searchParams] = useSearchParams()
  const institutionId = searchParams.get('institution_id')
  const [notices, setNotices] = useState<NoticeSummary[]>([])
  const [selected, setSelected] = useState<NoticeDetail | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .get<NoticeSummary[]>('/notices', {
        params: { kind: 'official', ...(institutionId ? { institution_id: institutionId } : {}) },
      })
      .then((res) => setNotices(res.data))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false))
  }, [institutionId])

  const openDetail = async (noticeId: number) => {
    setError('')
    try {
      const res = await api.get<NoticeDetail>(`/notices/${noticeId}`)
      setSelected(res.data)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <h1>Official notices</h1>
        <p className="muted">Verified notices fetched from the connected institutions.</p>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : notices.length === 0 ? (
          <p className="muted">
            No official notices yet. An admin can trigger a fetch from the Sources screen.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Issuer</th>
                <th>Publication date</th>
                <th>Deadline</th>
                <th>Audience</th>
                <th>Retrieved</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {notices.map((n) => (
                <tr key={n.id}>
                  <td>{n.id}</td>
                  <td>{n.title ?? '—'}</td>
                  <td>{n.issuer ?? '—'}</td>
                  <td>{n.published_date ?? n.notice_date ?? '—'}</td>
                  <td>{n.deadline ?? '—'}</td>
                  <td>{n.audience ?? '—'}</td>
                  <td>{n.retrieved_at ? new Date(n.retrieved_at).toLocaleString() : '—'}</td>
                  <td>
                    <button className="btn-secondary" onClick={() => openDetail(n.id)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      {selected && (
        <div className="card">
          <h2>Notice #{selected.id}</h2>
          <dl className="kv">
            <dt>Issuer</dt>
            <dd>{selected.issuer ?? '—'}</dd>
            <dt>Date</dt>
            <dd>{selected.notice_date ?? '—'}</dd>
            <dt>Publication date</dt>
            <dd>{selected.published_date ?? '—'}</dd>
            <dt>Deadline</dt>
            <dd>{selected.deadline ?? '—'}</dd>
            <dt>Audience</dt>
            <dd>{selected.audience ?? '—'}</dd>
            <dt>Action</dt>
            <dd>{selected.action ?? '—'}</dd>
            <dt>Source</dt>
            <dd>
              {selected.source_url ? (
                <a href={selected.source_url} target="_blank" rel="noreferrer">
                  {selected.source_url}
                </a>
              ) : (
                '—'
              )}
            </dd>
            <dt>SHA-256</dt>
            <dd className="mono">{selected.sha256 ?? '—'}</dd>
            <dt>Retrieved</dt>
            <dd>{selected.retrieved_at ? new Date(selected.retrieved_at).toLocaleString() : '—'}</dd>
          </dl>
          {selected.redacted_text && (
            <>
              <h3>Redacted text</h3>
              <pre className="pre">{selected.redacted_text}</pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}

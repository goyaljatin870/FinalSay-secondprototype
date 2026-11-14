import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowDownRight, ArrowRight, FileSearch, FileText, Landmark, ScanLine, ShieldCheck, UploadCloud, X } from 'lucide-react'
import Tesseract from 'tesseract.js'
import { api, errorMessage } from '../../api/client'
import type { ComparisonResponse, InstitutionOut } from '../../api/types'

const FILE_TYPES = '.pdf,.png,.jpg,.jpeg,.gif,.webp'
const STEPS = [
  { icon: ScanLine, title: 'Read the notice', description: 'Extract dates, deadlines and the issuer from your text or file.' },
  { icon: Landmark, title: 'Find the official match', description: 'Compare it with notices indexed for the selected institution.' },
  { icon: ShieldCheck, title: 'See what to do next', description: 'Review the differences and open the official source when available.' },
]

interface NoticeDraft {
  text: string
  institutionId: number | null
}

export default function SubmitPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const draft = location.state as NoticeDraft | null
  const fileInput = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'text' | 'file'>('text')
  const [text, setText] = useState(draft?.text ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [institutionId, setInstitutionId] = useState(String(draft?.institutionId ?? ''))
  const [institutions, setInstitutions] = useState<InstitutionOut[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [sourcesError, setSourcesError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrExtracted, setOcrExtracted] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setSourcesLoading(true)
    setSourcesError('')
    api.get<InstitutionOut[]>('/ingest/sources', { signal: controller.signal })
      .then(({ data }) => {
        const available = data.filter((item) => item.active && item.current_notice_count > 0)
        setInstitutions(available)
        setInstitutionId((current) => {
          if (available.some(({ id }) => String(id) === current)) return current
          return available.length === 1 ? String(available[0].id) : ''
        })
      })
      .catch((err) => {
        if (!controller.signal.aborted) setSourcesError(errorMessage(err))
      })
      .finally(() => {
        if (!controller.signal.aborted) setSourcesLoading(false)
      })
    return () => controller.abort()
  }, [attempt])

  async function performOcr(imageFile: File) {
    setOcrLoading(true)
    setOcrProgress(0)
    setError('')
    try {
      const res = await Tesseract.recognize(imageFile, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            setOcrProgress(Math.round(m.progress * 100))
          }
        },
      })
      const recognized = res.data.text.trim()
      if (recognized) {
        setOcrExtracted(recognized)
        setText(recognized)
      }
    } catch (err) {
      console.warn('Client OCR attempt:', err)
    } finally {
      setOcrLoading(false)
    }
  }

  function chooseFile(value: File | null) {
    if (fileInput.current) fileInput.current.value = ''
    setError('')
    setOcrExtracted('')
    if (value && (!/\.(pdf|png|jpe?g|gif|webp)$/i.test(value.name) || value.size === 0)) {
      setError('Choose a nonempty PDF, PNG, JPG, GIF or WebP file.')
      return
    }
    setFile(value)
    if (value && /\.(png|jpe?g|gif|webp)$/i.test(value.name)) {
      void performOcr(value)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    const noticeText = text.trim() || ocrExtracted.trim()
    if ((mode === 'text' && !noticeText) || (mode === 'file' && !file && !noticeText)) {
      setError(mode === 'text' ? 'Paste the notice text to continue.' : 'Choose a notice file to continue.')
      return
    }
    setBusy(true)
    try {
      const form = new FormData()
      if (noticeText) form.append('text', noticeText)
      if (mode === 'file' && file) form.append('file', file)
      if (institutionId) form.append('institution_id', institutionId)
      const { data } = await api.post<ComparisonResponse>('/ingest/submit', form)
      navigate('/result/' + data.submission_id, {
        state: { edgeId: data.edge_id, evidence: data.evidence, candidateScore: data.candidate_score },
      })
    } catch (err) {
      const msg = errorMessage(err)
      if (msg.includes('No Tesseract OCR engine is available') && file) {
        setError('Scanning image directly in browser…')
        try {
          const res = await Tesseract.recognize(file, 'eng')
          const scanned = res.data.text.trim()
          if (scanned) {
            setText(scanned)
            setOcrExtracted(scanned)
            // Retry submit with extracted text
            const retryForm = new FormData()
            retryForm.append('text', scanned)
            retryForm.append('file', file)
            if (institutionId) retryForm.append('institution_id', institutionId)
            const { data } = await api.post<ComparisonResponse>('/ingest/submit', retryForm)
            navigate('/result/' + data.submission_id, {
              state: { edgeId: data.edge_id, evidence: data.evidence, candidateScore: data.candidate_score },
            })
            return
          } else {
            setMode('text')
            setError('Could not extract text from the image. Please paste the notice text.')
          }
        } catch {
          setMode('text')
          setError('Please paste the notice text below to verify.')
        }
      } else {
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack workspace">
      <header className="workspace-hero">
        <div>
          <span className="hero-kicker"><FileSearch size={16} aria-hidden="true" /> Notice verification</span>
          <h1>Verify a notice</h1>
          <p>Check a forwarded circular against your institution’s official records.</p>
        </div>
        <Link to="/notices" className="button hero-button">
          <Landmark size={17} aria-hidden="true" /> Browse official notices <ArrowDownRight size={16} aria-hidden="true" />
        </Link>
      </header>

      <div className="workspace-grid">
        <section className="card submission-card" aria-labelledby="submission-title">
          <div className="section-title">
            <span className="section-icon"><FileText size={22} aria-hidden="true" /></span>
            <div><h2 id="submission-title">Your notice</h2><p className="muted">Paste the text or upload the document you received.</p></div>
          </div>
          <form onSubmit={submit} aria-busy={busy}>
            <fieldset disabled={busy}>
              <div className="segment" role="group" aria-label="Notice input method">
                <button type="button" aria-pressed={mode === 'text'} onClick={() => { setMode('text'); setError('') }}>
                  <FileText size={17} aria-hidden="true" /> Paste text
                </button>
                <button type="button" aria-pressed={mode === 'file'} onClick={() => { setMode('file'); setError('') }}>
                  <UploadCloud size={17} aria-hidden="true" /> Upload file
                </button>
              </div>
              <label>
                Institution
                <select value={institutionId} onChange={(event) => setInstitutionId(event.target.value)}
                  required={institutions.length > 0} disabled={sourcesLoading || institutions.length === 0}>
                  <option value="">{sourcesLoading ? 'Loading institutions…' : institutions.length ? 'Choose an institution' : 'No institutions with indexed notices'}</option>
                  {institutions.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
              {sourcesError && (
                <p className="form-note" role="alert">
                  Couldn’t load institutions. <button className="text-button" type="button" onClick={() => setAttempt(attempt + 1)}>Retry</button>
                </p>
              )}
              {!sourcesLoading && !sourcesError && institutions.length === 0 && (
                <p className="form-note">There are no indexed official notices yet. You can still submit a notice for review.</p>
              )}

              {mode === 'text' ? (
                <label>
                  Notice text
                  <textarea rows={7} value={text} placeholder="Paste the circular or message here…" onChange={(event) => setText(event.target.value)} />
                </label>
              ) : (
                <div
                  className={dragging ? 'dropzone dropzone-active' : 'dropzone'}
                  onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true) }}
                  onDragLeave={(event) => {
                    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false)
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    setDragging(false)
                    if (!busy) chooseFile(event.dataTransfer.files[0] ?? null)
                  }}
                >
                  <input ref={fileInput} type="file" accept={FILE_TYPES} hidden
                    onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
                  {file ? (
                    <div>
                      <div className="selected-file">
                        <FileText size={22} aria-hidden="true" />
                        <div><strong>{file.name}</strong><small>{Math.max(1, Math.ceil(file.size / 1024))} KB</small></div>
                        <button type="button" className="icon-button btn-secondary" onClick={() => chooseFile(null)} aria-label="Remove file">
                          <X size={17} aria-hidden="true" />
                        </button>
                      </div>
                      {ocrLoading && (
                        <p className="muted" style={{ fontSize: '0.825rem', marginTop: '0.5rem' }}>
                          Scanning notice text (OCR: {ocrProgress}%)…
                        </p>
                      )}
                      {!ocrLoading && ocrExtracted && (
                        <p style={{ fontSize: '0.825rem', color: '#10b981', marginTop: '0.5rem' }}>
                          ✓ Notice text extracted from image ({ocrExtracted.length} characters)
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      <span className="section-icon"><UploadCloud size={24} aria-hidden="true" /></span>
                      <strong>Drop your notice here</strong>
                      <span className="muted">PDF, PNG, JPG, GIF or WebP</span>
                      <button type="button" className="button btn-secondary" onClick={() => fileInput.current?.click()}>Choose a file</button>
                    </>
                  )}
                </div>
              )}
              {error && <p className="error" role="alert">{error}</p>}
              <div className="submission-footer">
                <span><ShieldCheck size={17} aria-hidden="true" /> Personal details are redacted before storage.</span>
                <button type="submit" disabled={sourcesLoading || Boolean(sourcesError)}>
                  {busy ? 'Checking notice…' : 'Check notice'} <ArrowRight size={18} aria-hidden="true" />
                </button>
              </div>
            </fieldset>
          </form>
        </section>

        <aside className="card workflow-card" aria-labelledby="workflow-title">
          <h2 id="workflow-title">What happens next</h2>
          <ol className="workflow-list">
            {STEPS.map(({ icon: Icon, title, description }) => (
              <li key={title}>
                <span className="section-icon"><Icon size={19} aria-hidden="true" /></span>
                <div><h3>{title}</h3><p className="muted">{description}</p></div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  )
}

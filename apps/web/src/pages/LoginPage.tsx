import { useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { errorMessage } from '../api/client'
import AuthLayout from '../components/AuthLayout'
import PasswordField from '../components/PasswordField'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const from = (location.state as { from?: string } | null)?.from || '/'

  const doLogin = async (e: string, p: string) => {
    setError('')
    setBusy(true)
    try {
      await login(e, p)
      navigate(from, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <div className="auth-form">
        <h1 id="auth-title">Welcome back</h1>
        <p className="muted">Sign in to your FinalSay workspace.</p>
        <form
          onSubmit={(ev) => {
            ev.preventDefault()
            void doLogin(email, password)
          }}
        >
          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              placeholder="you@university.edu"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              required
            />
          </label>
          <PasswordField value={password} onChange={setPassword} />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={18} aria-hidden="true" />
          </button>
        </form>
        <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border, #e2e8f0)' }}>
          <p className="muted" style={{ fontSize: '0.825rem', marginBottom: '0.5rem' }}>
            Demo accounts (click to fill):
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem', cursor: 'pointer' }}
              onClick={() => { setEmail('admin@finalsay.demo'); setPassword('admin123'); }}
            >
              Admin
            </button>
            <button
              type="button"
              style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem', cursor: 'pointer' }}
              onClick={() => { setEmail('reviewer@finalsay.demo'); setPassword('reviewer123'); }}
            >
              Reviewer
            </button>
            <button
              type="button"
              style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem', cursor: 'pointer' }}
              onClick={() => { setEmail('student@finalsay.demo'); setPassword('student123'); }}
            >
              Student
            </button>
            <button
              type="button"
              style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem', cursor: 'pointer' }}
              onClick={() => { setEmail('issuer@finalsay.demo'); setPassword('issuer123'); }}
            >
              Issuer
            </button>
          </div>
        </div>
        <p className="auth-switch muted">
          New to FinalSay? <Link to="/register">Create an account</Link>
        </p>
      </div>

    </AuthLayout>
  )
}

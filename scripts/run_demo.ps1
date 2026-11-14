# FinalSay local application launcher for Windows PowerShell.
#
# Defaults: SQLite + local comparison + LOCAL anchor. No paid API keys.
# Usage:
#   .\scripts\run_demo.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$BackendDir = Join-Path $RootDir "backend"
$WebDir = Join-Path $RootDir "apps\web"
$VenvDir = Join-Path $BackendDir ".venv"
$VenvPy = Join-Path $VenvDir "Scripts\python.exe"

# Prefer virtualenv python if it exists, otherwise find available python
if (Test-Path $VenvPy) {
    $PythonBin = $VenvPy
} else {
    $PythonBin = (Get-Command python -ErrorAction SilentlyContinue).Source
    if (-not $PythonBin) {
        $PythonBin = (Get-Command py -ErrorAction SilentlyContinue).Source
    }
    if (-not $PythonBin) {
        Write-Error "Python not found. Please install Python 3.11+."
        exit 1
    }
}

Write-Host "[run_demo] Using Python: $PythonBin"

if (-not (Test-Path $VenvPy)) {
    Write-Host "[run_demo] Creating backend virtual environment at $VenvDir..."
    & $PythonBin -m venv $VenvDir
}

$VenvPy = Join-Path $VenvDir "Scripts\python.exe"

$env:HF_HUB_OFFLINE = "1"
$env:TRANSFORMERS_OFFLINE = "1"

Write-Host "[run_demo] Installing backend requirements..."
& $VenvPy -m pip install --quiet --upgrade pip
& $VenvPy -m pip install --quiet -r (Join-Path $BackendDir "requirements.txt")

Write-Host "[run_demo] Configuring official portal sources..."
Push-Location $BackendDir
try {
    & $VenvPy -m finalsay.services.source_onboarding --apply
} finally {
    Pop-Location
}

Write-Host "[run_demo] Starting FastAPI backend on http://127.0.0.1:8000 ..."
$BackendProcess = Start-Process -FilePath $VenvPy -ArgumentList "-m uvicorn finalsay.main:app --host 127.0.0.1 --port 8000" -WorkingDirectory $BackendDir -PassThru

# Wait for backend health
Write-Host "[run_demo] Waiting for backend to become ready..."
$Ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/health" -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($health.status -eq "ok") {
            $Ready = $true
            break
        }
    } catch {}
    Start-Sleep -Seconds 1
}

if (-not $Ready) {
    Write-Warning "[run_demo] Backend health check timed out. Continuing to frontend..."
} else {
    Write-Host "[run_demo] Backend is healthy and ready."
}

Write-Host "[run_demo] Installing frontend dependencies..."
Push-Location $WebDir
try {
    npm install --no-fund --no-audit
} finally {
    Pop-Location
}

Write-Host @"

============================================================
  FinalSay local app is running
============================================================
  Frontend (PWA):  http://127.0.0.1:5173
  Backend API:     http://127.0.0.1:8000
  API docs:        http://127.0.0.1:8000/docs

  Students can register from the Register page.
  Bootstrap the first admin in another terminal with:
    cd backend; .venv\Scripts\python -m finalsay.services.provision_admin ADMIN_EMAIL

  Press Ctrl+C to stop (backend will be stopped automatically).
============================================================

"@

try {
    Push-Location $WebDir
    npm run dev -- --host 127.0.0.1 --port 5173
} finally {
    Pop-Location
    if ($BackendProcess -and -not $BackendProcess.HasExited) {
        Write-Host "[run_demo] Stopping backend..."
        Stop-Process -Id $BackendProcess.Id -Force -ErrorAction SilentlyContinue
    }
}

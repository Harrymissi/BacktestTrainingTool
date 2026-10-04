$ErrorActionPreference = "Stop"

$python = "python"
$installedPython = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
if (-not (Get-Command $python -ErrorAction SilentlyContinue)) {
    if (Test-Path $installedPython) {
        $python = $installedPython
    }
    else {
        Write-Host "Python was not found. Please install Python 3.10+ and enable Add python.exe to PATH."
        exit 1
    }
}

if (-not (Test-Path ".venv")) {
    & $python -m venv .venv
}

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Host "Virtual environment is missing .venv\Scripts\python.exe."
    exit 1
}

& ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt
& ".\.venv\Scripts\python.exe" app/server.py

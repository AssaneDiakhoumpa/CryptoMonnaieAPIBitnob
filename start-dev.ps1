# start-dev.ps1 : Lancement unifie du Backend et de l'Interface ERP
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Demarrage de l'ERP de Paiements Bitnob & IA (Sandbox)"   -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$root = $PSScriptRoot
$backendDir = Join-Path $root "backend"
$frontDir = Join-Path $root "Front"
$backendPython = Join-Path $backendDir ".venv\Scripts\python.exe"

# Verification de l'environnement virtuel Python
if (-not (Test-Path $backendPython)) {
    Write-Host "[ERREUR] L'environnement backend\.venv n'a pas ete trouve !" -ForegroundColor Red
    Write-Host "Creez-le dans backend et installez backend\requirements.txt."
    exit 1
}

$needsConfiguration = $false
if (-not (Test-Path (Join-Path $backendDir ".env"))) {
    Copy-Item (Join-Path $backendDir ".env.example") (Join-Path $backendDir ".env")
    $needsConfiguration = $true
}

if (-not (Test-Path (Join-Path $frontDir ".env.local"))) {
    Copy-Item (Join-Path $frontDir ".env.example") (Join-Path $frontDir ".env.local")
    $needsConfiguration = $true
}

if ($needsConfiguration) {
    Write-Host "[ATTENTION] Les fichiers d'environnement locaux viennent d'etre crees." -ForegroundColor Yellow
    Write-Host "Configurez-les, alignez APP_API_KEY, puis relancez le script."
    exit 1
}

if (-not (Test-Path (Join-Path $frontDir "node_modules"))) {
    Write-Host "[ERREUR] Les dependances Front sont absentes. Lancez npm ci dans Front." -ForegroundColor Red
    exit 1
}

Write-Host "`n[OK] FastAPI : http://localhost:8000 (docs : /docs)" -ForegroundColor Green
Write-Host "[OK] Next.js : http://localhost:3000" -ForegroundColor Green
Write-Host "APP_API_KEY doit avoir la meme valeur dans backend\.env et Front\.env.local." -ForegroundColor Yellow
Write-Host "Les deux serveurs sont lances dans des fenetres separees.`n" -ForegroundColor Gray

$backendCommand = "& '$backendPython' -m uvicorn app.main:app --reload --port 8000"
$frontCommand = "npm run dev -- --hostname 127.0.0.1 --port 3000"
Start-Process -FilePath "powershell.exe" -WorkingDirectory $backendDir -ArgumentList @("-NoExit", "-Command", $backendCommand)
Start-Process -FilePath $env:ComSpec -WorkingDirectory $frontDir -ArgumentList @("/k", $frontCommand)

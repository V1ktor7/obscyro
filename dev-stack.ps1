# Obscyro: Postgres (Docker) + migrations + backend + frontend (new PowerShell windows)
# Prerequisite: Docker Desktop running (Linux engine).
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"

if (-not (Test-Path (Join-Path $backend ".env"))) {
    Write-Host "Copy backend/.env.example to backend/.env (or run once: template is in repo)." -ForegroundColor Yellow
}

Set-Location $backend
docker compose up -d

Write-Host "Waiting for Postgres on 127.0.0.1:5435..."
$ready = $false
for ($i = 0; $i -lt 90; $i++) {
    $t = Test-NetConnection -ComputerName 127.0.0.1 -Port 5435 -WarningAction SilentlyContinue
    if ($t.TcpTestSucceeded) {
        $ready = $true
        break
    }
    Start-Sleep -Seconds 1
}
if (-not $ready) {
    throw "PostgreSQL not reachable on port 5435. Start Docker Desktop, then run this script again."
}

npm run migrate

if (-not (Test-Path (Join-Path $frontend ".env.local"))) {
    Set-Content -Path (Join-Path $frontend ".env.local") -Value "NEXT_PUBLIC_API_URL=http://localhost:4000`n"
}

Write-Host "Starting API and Next.js in new windows..."
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-NoProfile",
    "-Command",
    "Set-Location `"$backend`"; npm run dev"
)
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-NoProfile",
    "-Command",
    "Set-Location `"$frontend`"; npx next dev -p 3000"
)

Write-Host ""
Write-Host "API health:  http://localhost:4000/health" -ForegroundColor Green
Write-Host "Frontend:    http://localhost:3000" -ForegroundColor Green
Write-Host "Sign-up will call POST http://localhost:4000/v1/onboard" -ForegroundColor Green

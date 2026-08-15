#!/usr/bin/env pwsh
# Millers Hollow - Local Production Server Start Script

Write-Host "🎮 Millers Hollow Online - Production Server" -ForegroundColor Cyan
Write-Host "Building and starting server..." -ForegroundColor Yellow

# Check if dist exists
if (-not (Test-Path "dist")) {
    Write-Host "📦 Building project..." -ForegroundColor Blue
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Build failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Build complete" -ForegroundColor Green
}

Write-Host "`n🚀 Starting server on port 3001..." -ForegroundColor Green
Write-Host "Open: http://localhost:3001" -ForegroundColor Cyan
Write-Host "Share: http://localhost:3001?room=MILL-7Q2" -ForegroundColor Cyan
Write-Host "`nPress Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

$env:NODE_ENV = "production"
$env:PORT = "3001"

npm start

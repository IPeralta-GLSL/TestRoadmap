$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path

function Cleanup {
    Write-Host "`nDeteniendo servicios..."
    if ($BackendProcess -and -not $BackendProcess.HasExited) {
        Stop-Process -Id $BackendProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($FrontendProcess -and -not $FrontendProcess.HasExited) {
        Stop-Process -Id $FrontendProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "Detenido."
    exit
}

# Trap to catch generic exits/terminations
trap { Cleanup }

Write-Host "Iniciando backend..."
$BackendProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev" -WorkingDirectory "$ROOT\backend" -PassThru -NoNewWindow

Start-Sleep -Seconds 2

Write-Host "Iniciando frontend..."
$FrontendProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev" -WorkingDirectory "$ROOT\frontend" -PassThru -NoNewWindow

Write-Host ""
Write-Host "Backend corriendo en http://localhost:3000"
Write-Host "Frontend corriendo en http://localhost:5173"
Write-Host "Presiona Ctrl+C para detener"

# Wait loop that handles Ctrl+C gracefully in PowerShell console
try {
    while ($true) {
        if ($BackendProcess.HasExited -and $FrontendProcess.HasExited) {
            break
        }
        Start-Sleep -Milliseconds 500
    }
} finally {
    Cleanup
}

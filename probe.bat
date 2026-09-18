@echo off
REM One-shot read-only recon against the live Entergram workspace.
REM Reads the key from .env.local in this folder. Writes nothing back to Entergram.
title Entergram probe
echo ========================================
echo Entergram API probe (read-only)
echo ========================================
echo.
if not exist "%~dp0.env.local" (
  echo MISSING: .env.local
  echo Copy .env.example to .env.local and put the PRO API key in ENTERGRAM_API_KEY.
  pause
  exit /b 1
)
node "%~dp0scripts\probe.js" > "%~dp0probe-output.txt" 2>&1
echo Done. Output written to probe-output.txt
type "%~dp0probe-output.txt"
pause

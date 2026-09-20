@echo off
title Entergram watch dry run
REM One scan against the live workspace. Posts nothing, persists nothing.
REM Reads the API key and KV settings from .env.local in this folder.
if not exist "%~dp0.env.local" (
  echo MISSING: .env.local  - copy .env.example and fill it in.
  pause
  exit /b 1
)
node "%~dp0scripts\dryrun.js" %1
pause

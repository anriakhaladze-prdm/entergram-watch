@echo off
title Entergram roster builder
node "%~dp0scripts\build-roster.js" > "%~dp0roster-output.txt" 2>&1
echo Done. Output written to roster-output.txt
type "%~dp0roster-output.txt"
pause

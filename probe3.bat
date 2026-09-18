@echo off
title Entergram probe 3
node "%~dp0scripts\probe3.js" > "%~dp0probe3-output.txt" 2>&1
echo Done. Output written to probe3-output.txt
type "%~dp0probe3-output.txt"
pause

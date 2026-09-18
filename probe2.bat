@echo off
title Entergram probe 2
node "%~dp0scripts\probe2.js" > "%~dp0probe2-output.txt" 2>&1
echo Done. Output written to probe2-output.txt
type "%~dp0probe2-output.txt"
pause

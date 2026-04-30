@echo off
cd /d "%~dp0"
title WATCHDOG Frontend
echo  Starting WATCH-DOG frontend on http://localhost:3000 ...
if not exist "node_modules" ( call npm install )
npm run dev
pause

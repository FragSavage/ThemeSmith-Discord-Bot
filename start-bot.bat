@echo off
setlocal
title ThemeSmith Bot

if not exist backups mkdir backups

echo Starting ThemeSmith...
echo.
call npm.cmd start

echo.
echo ThemeSmith has stopped.
pause

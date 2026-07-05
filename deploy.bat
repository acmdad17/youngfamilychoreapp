@echo off
cd /d "%~dp0"
git add -A
git commit -m "%~1"
git push
git push origin master:main
echo.
echo Deploy complete.
pause

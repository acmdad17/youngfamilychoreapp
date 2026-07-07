@echo off
cd /d "%~dp0"
git add -A
if "%~1"=="" (
  git commit -m "Update app"
) else (
  git commit -m "%~1"
)
git push origin master:main
echo.
echo Deploy complete.
pause

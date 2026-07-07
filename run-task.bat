@echo off
title Chore App — Claude Code
cd /d "C:\Users\Bradford\Claude\Projects\Chore App"

if not exist "TASK.md" (
    echo.
    echo  No TASK.md found in the Chore App folder.
    echo  Cowork will create one when it needs Claude Code's help.
    echo.
    pause
    exit /b
)

echo.
echo  Found TASK.md — handing off to Claude Code...
echo.

claude "Read TASK.md in the current directory and complete the task described. Write a summary of what you did to RESULT.md when finished, then delete TASK.md."

@echo off
setlocal

cd /d "%~dp0"

set "VIBE_MAIN_SHELL=opentui"
set "VIBE_TRANSCRIPT_PUBLICATION_MODE=next"
set "VIBE_PSMUX_CHILD="
set "VIBE_PSMUX_ROLE="
set "VIBE_PSMUX_SESSION=vibe_openchat"

where node >nul 2>nul
if errorlevel 1 (
	echo Node.js was not found on PATH.
	echo Install Node.js or launch from a shell where node is available.
	pause
	exit /b 1
)

where bun >nul 2>nul
if errorlevel 1 (
	echo Bun was not found on PATH.
	echo Install Bun or launch from a shell where bun is available.
	pause
	exit /b 1
)

where psmux >nul 2>nul
if errorlevel 1 (
	echo psmux was not found on PATH.
	echo Install psmux before launching Vibe Agent.
	pause
	exit /b 1
)

node ".\bin\vibe-agent.js"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
	echo.
	echo OpenTUI Coding Chat exited with code %EXIT_CODE%.
	pause
)

exit /b %EXIT_CODE%

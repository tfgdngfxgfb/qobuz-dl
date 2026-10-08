@echo off
setlocal
cd /d "%~dp0"
echo Starting Qobuz-DL GUI...
if /I "%~1"=="--browser" set "QOBUZ_DL_GUI_BROWSER=1"

if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -m qobuz_dl.gui_app
    goto :done
)

where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    python -m qobuz_dl.gui_app
) else (
    py -m qobuz_dl.gui_app
)

:done
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Error: Failed to start the GUI.
    echo Make sure Python and the required dependencies are installed.
    echo You can also try: launch_gui.bat --browser
    pause
)

@echo off
setlocal
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python not found. Please install Python or use GitHub Pages.
  pause
  exit /b 1
)
start "" http://127.0.0.1:8000/
echo NativeMP3Converter local server: http://127.0.0.1:8000/
echo Press Ctrl+C to stop.
python -m http.server 8000 --bind 127.0.0.1
endlocal

@echo off
setlocal
pushd "%~dp0" || exit /b 1
where node.exe >nul 2>&1 || goto missing
where yt-dlp.exe >nul 2>&1 || goto missing
where ffmpeg.exe >nul 2>&1 || goto missing
where deno.exe >nul 2>&1 || goto missing
py -3.13 -V >nul 2>&1 || goto missing
if not exist "dist\index.html" (
  call npm ci --ignore-scripts || goto error
  call npm run build || goto error
)
node server/launch.mjs
if errorlevel 1 goto error
popd
exit /b 0
:missing
echo Background processing needs Node.js, yt-dlp, FFmpeg, Deno and Python 3.13.
where winget.exe >nul 2>&1 || goto error
choice /C YN /M "Install missing free dependencies using Windows Package Manager"
if errorlevel 2 goto error
where node.exe >nul 2>&1 || winget install --id OpenJS.NodeJS.LTS --exact --source winget
where yt-dlp.exe >nul 2>&1 || winget install --id yt-dlp.yt-dlp --exact --source winget
where ffmpeg.exe >nul 2>&1 || winget install --id Gyan.FFmpeg --exact --source winget
where deno.exe >nul 2>&1 || winget install --id DenoLand.Deno --exact --source winget
py -3.13 -V >nul 2>&1 || winget install --id Python.Python.3.13 --exact --source winget
echo After installation, close this window and run this launcher again.
:error
pause
popd
exit /b 1

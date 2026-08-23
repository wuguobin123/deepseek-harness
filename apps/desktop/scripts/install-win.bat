@echo off
rem Enterprise AI Workbench - Windows one-line installer.
rem
rem Usage (paste into cmd.exe):
rem   curl -fsSL -o "%TEMP%\install-win.bat" https://wgb123-1257121815.cos.ap-beijing.myqcloud.com/install-win.bat && call "%TEMP%\install-win.bat"
rem
rem Flow: kill running instances -^> uninstall any previous version -^> download
rem       latest installer with curl.exe -^> run it.
rem
rem Why uninstall first: the package is unsigned. When a previous version is
rem present (especially with files still locked by a running process), the NSIS
rem one-click installer aborts with "Failed to uninstall old application files".
rem
rem Why curl + batch instead of PowerShell: download-execute cradles like
rem "iex (Invoke-WebRequest ...)" are flagged and blocked by Tencent Cloud's
rem host security agent. Messages are ASCII-only so the .bat never depends on
rem the console codepage (GBK/UTF-8 garbling).

setlocal EnableDelayedExpansion

set "APP_NAME=Enterprise AI Workbench"
set "PACKAGE=latest-win-x64.exe"
set "BASE_URL=%WORKBENCH_RELEASES_URL%"
if not defined BASE_URL set "BASE_URL=https://wgb123-1257121815.cos.ap-beijing.myqcloud.com"

set "INSTALL_DIR=%LOCALAPPDATA%\Programs\%APP_NAME%"
set "LEGACY_DIR=%LOCALAPPDATA%\Programs\@enterprise-workbenchdesktop"
set "UPDATER1=%LOCALAPPDATA%\enterprise-ai-workbench-updater"
set "UPDATER2=%LOCALAPPDATA%\@enterprise-workbenchdesktop-updater"

echo ==^> [1/4] Stopping running instances
taskkill /F /IM "%APP_NAME%.exe" >nul 2>&1

echo ==^> [2/4] Uninstalling previous version if present
set "FOUND=0"

rem The NSIS uninstaller lives inside the install dir as "Uninstall <product>.exe".
set "UNI1=%INSTALL_DIR%\Uninstall %APP_NAME%.exe"
set "UNI2=%LEGACY_DIR%\Uninstall %APP_NAME%.exe"
if exist "%UNI1%" (
  set "FOUND=1"
  echo     Running "%UNI1%" /S
  start "" /wait "%UNI1%" /S
)
if exist "%UNI2%" (
  set "FOUND=1"
  echo     Running "%UNI2%" /S
  start "" /wait "%UNI2%" /S
)

rem Drop leftover Add/Remove Programs entries pointing at removed installs.
for %%K in (
  "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall"
  "HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall"
  "HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
) do (
  for /f "delims=" %%E in ('reg query %%K /s /f "%APP_NAME%" /d 2^>nul ^| findstr /i "^HKEY"') do (
    set "FOUND=1"
    echo     Removing registry entry %%E
    reg delete "%%E" /f >nul 2>&1
  )
)
if "!FOUND!"=="0" (
  echo     No previous installation found, skipping uninstall
) else (
  echo     Previous installation removed
)

rem NSIS uninstallers detach (they re-launch themselves from %%TEMP%%), so poll
rem until the install directory is actually gone.
echo ==^> [3/4] Waiting for cleanup to finish
set /a TRIES=0
:waitloop
if not exist "%INSTALL_DIR%" if not exist "%LEGACY_DIR%" goto waitdone
set /a TRIES+=1
if !TRIES! GEQ 60 goto waitdone
timeout /t 1 /nobreak >nul
goto waitloop
:waitdone

taskkill /F /IM "%APP_NAME%.exe" >nul 2>&1
if exist "%INSTALL_DIR%" rd /s /q "%INSTALL_DIR%" >nul 2>&1
if exist "%LEGACY_DIR%" rd /s /q "%LEGACY_DIR%" >nul 2>&1
if exist "%UPDATER1%" rd /s /q "%UPDATER1%" >nul 2>&1
if exist "%UPDATER2%" rd /s /q "%UPDATER2%" >nul 2>&1

echo ==^> [4/4] Downloading and installing %PACKAGE%
where curl >nul 2>&1
if errorlevel 1 (
  echo ERROR: curl.exe not found ^(Windows 10 1803+ ships it^).
  echo        Download %BASE_URL%/%PACKAGE% manually and run it.
  pause
  exit /b 1
)
curl.exe -fSL --progress-bar -o "%TEMP%\%PACKAGE%" "%BASE_URL%/%PACKAGE%"
if errorlevel 1 (
  echo ERROR: download failed, check your network and try again.
  pause
  exit /b 1
)

start "" /wait "%TEMP%\%PACKAGE%"
echo Done. Launch "%APP_NAME%" from the Start Menu.
pause

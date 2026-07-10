@echo off
REM Track Manager launcher.
REM Clears ELECTRON_RUN_AS_NODE (which makes Electron behave as plain Node
REM and breaks the app) before starting.
set "ELECTRON_RUN_AS_NODE="
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0."

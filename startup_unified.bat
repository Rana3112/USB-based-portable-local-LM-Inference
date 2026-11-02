@echo off
setlocal enabledelayedexpansion

:: 1. Dynamically resolve current directory to root of USB drive
cd /d "%~dp0"
title llama.cpp Portable AI Suite + Web MCP Bridge

echo ===============================================================================
echo            PORTABLE LLAMA.CPP SUITE WITH WEB SEARCH ^& SCRAPING MCP
echo ===============================================================================
echo  USB Root Drive : %~dp0
echo  Web UI URL     : http://127.0.0.1:8080
echo  MCP SSE Bridge : http://127.0.0.1:3001/sse
echo ===============================================================================
echo.

:: 1. Clean up any previous dangling instances on port 3001
taskkill /F /IM web_mcp_bridge.exe >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1

:: 2. Start the search & scraper MCP bridge in the background on port 3001
echo [1/2] Starting Portable Web Search ^& Scraping MCP Bridge on port 3001...

if exist "%~dp0node\node.exe" (
    echo       Using portable embedded runtime: node\node.exe server.js
    start "Web MCP Bridge (Port 3001)" /min "%~dp0node\node.exe" "%~dp0server.js" --port 3001
) else if exist "%~dp0web_mcp_bridge.exe" (
    echo       Using standalone binary: web_mcp_bridge.exe
    start "Web MCP Bridge (Port 3001)" /min "%~dp0web_mcp_bridge.exe" --port 3001
) else (
    echo [ERROR] Neither node\node.exe nor web_mcp_bridge.exe was found!
    pause
    exit /b 1
)

:: 3. Actively poll until port 3001 is confirmed LISTENING before launching llama-server
echo       Waiting for MCP bridge to bind to port 3001...
set /a attempts=0
:wait_port
netstat -an | findstr "127.0.0.1:3001" | findstr "LISTENING" >nul
if not errorlevel 1 (
    echo       MCP Bridge is online and ready on http://127.0.0.1:3001/sse!
    goto port_ready
)
timeout /t 1 /nobreak >nul
set /a attempts+=1
if !attempts! lss 10 goto wait_port
echo [WARNING] MCP Bridge took longer than expected to bind to port 3001.

:port_ready
echo.
:: 4. Launch llama-server with multi-model presets and MCP proxy enabled
echo [2/2] Launching llama-server on http://127.0.0.1:8080 ...
echo       Presets file : presets.ini
echo       Context mode : Native model context (ctx-size 0) + unlimited shift (--context-shift)
echo       Proxy flag   : --ui-mcp-proxy
echo.
echo -------------------------------------------------------------------------------
echo Close this window or press Ctrl+C to terminate both llama-server and MCP bridge.
echo -------------------------------------------------------------------------------
echo.

"%~dp0llama-server.exe" --models-preset "%~dp0presets.ini" --host 127.0.0.1 --port 8080 --ui-mcp-proxy --context-shift

:: 5. Clean shutdown when llama-server exits
echo.
echo ===============================================================================
echo Shutting down Portable Web MCP Bridge...
taskkill /F /IM web_mcp_bridge.exe >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
echo Suite stopped cleanly.
echo ===============================================================================
pause

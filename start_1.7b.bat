@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title LFM3 1.7B Uncensored + Web MCP Bridge

echo ===============================================================================
echo            STARTING LFM3 1.7B UNCENSORED WITH WEB SEARCH ^& SCRAPING
echo ===============================================================================
echo  USB Root Drive : %~dp0
echo  Web UI URL     : http://127.0.0.1:8080
echo  MCP SSE Bridge : http://127.0.0.1:3001/sse
echo ===============================================================================
echo.

:: 1. Auto-start MCP Bridge on port 3001 if not already running
netstat -an | findstr "127.0.0.1:3001" | findstr "LISTENING" >nul
if errorlevel 1 (
    echo [1/2] Starting Portable Web Search ^& Scraping MCP Bridge on port 3001...
    if exist "%~dp0node\node.exe" (
        start "Web MCP Bridge (Port 3001)" /min "%~dp0node\node.exe" "%~dp0server.js" --port 3001
    ) else if exist "%~dp0web_mcp_bridge.exe" (
        start "Web MCP Bridge (Port 3001)" /min "%~dp0web_mcp_bridge.exe" --port 3001
    )
    set /a _att=0
    :wait_mcp_17b
    netstat -an | findstr "127.0.0.1:3001" | findstr "LISTENING" >nul
    if not errorlevel 1 goto mcp_ready_17b
    timeout /t 1 /nobreak >nul
    set /a _att+=1
    if !_att! lss 10 goto wait_mcp_17b
    :mcp_ready_17b
    echo       MCP Bridge is online on port 3001!
) else (
    echo [1/2] Web MCP Bridge is already running on port 3001.
)

echo.
:: 2. Launch llama-server with 1.7B model, unlimited context, and MCP proxy
echo [2/2] Launching LFM3 1.7B Uncensored on http://127.0.0.1:8080 ...
echo.
"%~dp0llama-server.exe" -m "%~dp0models\LFM3-1.7B-Uncensored\LFM3-1.7B-Uncensored-AD-Q6_K.gguf" -c 0 --context-shift --host 127.0.0.1 --port 8080 --ui-mcp-proxy

:: 3. Clean shutdown on exit
echo.
echo Stopping Web MCP Bridge...
taskkill /F /IM web_mcp_bridge.exe >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
echo Stopped cleanly.
pause

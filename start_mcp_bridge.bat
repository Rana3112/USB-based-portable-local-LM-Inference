@echo off
cd /d "%~dp0"
title Web Search ^& Scraping MCP Bridge
echo Starting Web MCP Bridge on http://127.0.0.1:3001/sse ...
if exist "%~dp0web_mcp_bridge.exe" (
    "%~dp0web_mcp_bridge.exe" --port 3001
) else if exist "%~dp0node\node.exe" (
    "%~dp0node\node.exe" "%~dp0server.js" --port 3001
) else (
    echo [ERROR] web_mcp_bridge.exe or node\node.exe not found!
)
pause

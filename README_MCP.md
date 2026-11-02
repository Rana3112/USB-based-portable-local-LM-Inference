# Portable Deep Web Search & Scraping MCP Server for llama.cpp Suite

## Overview
This USB suite includes a zero-dependency, plug-and-play **Deep Web Search & Scraping MCP Server** designed to integrate directly with `llama-server`'s built-in Web UI.

- **Bridge Binary:** `web_mcp_bridge.exe` (Self-contained, Route A)
- **Embedded Runtime Fallback:** `node\node.exe server.js` (Route B)
- **MCP SSE Endpoint:** `http://127.0.0.1:3001/sse`
- **Web UI URL:** `http://127.0.0.1:8080`
- **Context Size:** Unlimited / Continuous (`ctx-size = 0` with `--context-shift` enabled)
- **Search & Scraping Engine:** Browser-rendered live web search & headless markdown extraction (Monid TinyFish) with automatic DuckDuckGo & direct DOM fallback. Zero credit card or payment required.

---

## Active Tools

1. **`web_search`**:
   - Queries live web data using real browser-rendered search.
   - Returns ranked, non-cached search results with titles, URLs, site names, dates, and deep snippets.
   - Automatically falls back to DuckDuckGo if offline.

2. **`web_scrape`**:
   - Fetches target URLs and renders dynamic content in a headless browser.
   - Strips ads, navigation, and boilerplate, returning structured Markdown (up to 4,000 characters).

3. **`deep_search`**:
   - Specialized research and intense search engine.
   - Supports 3 corpora:
     - `domain_type: "web"` (General ranked web results)
     - `domain_type: "news"` (Live breaking news with publishers and exact dates)
     - `domain_type: "research_paper"` (Academic literature with authors, publication venue, year, citation count, and PDF URLs)

4. **`deep_scrape`**:
   - Deep browser-rendered webpage scraper designed for complex JavaScript-heavy websites and single-page applications (React, Next.js, Vue, docs portals).

---

## Quick Start
1. Double-click `startup_unified.bat` (or `start_1.7b.bat`, `start_omni.bat`, `start_allmodels.bat`).
2. The script automatically ensures port `3001` is running before launching `llama-server.exe`.
3. Open your browser to `http://127.0.0.1:8080`.
4. In the Web UI **MCP** panel, click the refresh icon on **Web-Tools** to sync all 4 active tools.

/**
 * Portable Web Search & Scraping MCP Server for llama.cpp Suite
 * Enhanced with Deep Search & Browser-Rendered Web Scraping (Monid TinyFish) + DDG Fallback.
 * Zero host dependencies. Implements Model Context Protocol (MCP) over HTTP/SSE.
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Parse CLI arguments
const args = process.argv.slice(2);
let PORT = 3001;
let HOST = '127.0.0.1';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    PORT = parseInt(args[i + 1], 10) || 3001;
    i++;
  } else if (args[i] === '--host' && args[i + 1]) {
    HOST = args[i + 1];
    i++;
  }
}

if (process.env.PORT) {
  PORT = parseInt(process.env.PORT, 10) || PORT;
}

// Active SSE sessions: Map<sessionId, { res, keepAlive } >
const sessions = new Map();

// Standard CORS Headers for llama-server web UI & browser clients
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-requested-with, *',
  'Access-Control-Max-Age': '86400'
};

// Tool Definitions according to MCP Specification
const MCP_TOOLS = [
  {
    name: 'web_search',
    description: 'Searches the live web to retrieve real-time news, facts, articles, weather, and detailed references using browser-rendered search with DuckDuckGo fallback.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query keywords or question to look up online (e.g. "latest AI developments", "DeepSeek V4 benchmarks", "Tokyo weather today").'
        },
        max_results: {
          type: 'integer',
          description: 'Maximum number of search results to return (default: 5, max: 10).'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'web_scrape',
    description: 'Fetches any webpage URL and extracts its primary readable text content into clean Markdown, stripping scripts, styles, advertisements, navigation bars, and headers/footers (up to 4,000 characters).',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The full HTTP or HTTPS URL of the webpage to scrape and extract text from (e.g., "https://en.wikipedia.org/wiki/Artificial_intelligence").'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'deep_search',
    description: 'Intense deep search engine for comprehensive information gathering. Supports searching the general web, news (with publication dates and publishers), or academic research papers (with authors, citations, venues, and PDF URLs).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query or research topic (e.g. "quantum computing fault tolerance", "NVIDIA earnings Q3").'
        },
        domain_type: {
          type: 'string',
          enum: ['web', 'news', 'research_paper'],
          description: 'Type of corpus to search: "web" (general ranked results), "news" (current breaking news and reporting with dates), or "research_paper" (academic literature, citations, PDF links).'
        },
        purpose: {
          type: 'string',
          description: 'Optional short description of the objective behind the search to sharpen relevance ranking.'
        },
        max_results: {
          type: 'integer',
          description: 'Maximum number of results to return (default: 5, max: 10).'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'deep_scrape',
    description: 'Deep browser-rendered webpage scraper. Executes client-side JavaScript, overcomes single-page application (SPA) limitations, and extracts clean, structured Markdown from dynamic websites.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The web page URL to render and scrape.'
        },
        purpose: {
          type: 'string',
          description: 'Optional short description of the goal to guide text extraction.'
        }
      },
      required: ['url']
    }
  }
];

// Resolve Monid API Key
function getMonidApiKey() {
  if (process.env.MONID_API_KEY) return process.env.MONID_API_KEY;
  try {
    const credPath = path.join(os.homedir(), '.config', 'monid', 'credentials.yaml');
    if (fs.existsSync(credPath)) {
      const content = fs.readFileSync(credPath, 'utf8');
      const match = content.match(/key:\s*([^\r\n]+)/);
      if (match && match[1]) return match[1].trim();
    }
  } catch {}
  return 'monid_live_GPyb1cBCmPHbSQDa4v419otZ';
}

// Utility: HTML Entity Decoder
function decodeEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => {
      try { return String.fromCharCode(dec); } catch { return ''; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try { return String.fromCharCode(parseInt(hex, 16)); } catch { return ''; }
    });
}

// Utility: Clean HTML to readable Markdown/Plaintext (Fallback Scraper)
function cleanHtml(html, maxLength = 4000) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : 'Untitled Webpage';

  let text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '')
    .replace(/<canvas\b[^>]*>[\s\S]*?<\/canvas>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<table\b[^>]*class=['"][^'"]*(?:infobox|navbox|sidebar|metadata)[^'"]*['"][^>]*>[\s\S]*?<\/table>/gi, '');

  const articleMatch = text.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const mainMatch = text.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const roleMainMatch = text.match(/<div\b[^>]*role=['"]main['"][^>]*>([\s\S]*?)<\/div>/i);

  if (articleMatch && articleMatch[1].replace(/<[^>]+>/g, '').trim().length > 250) {
    text = articleMatch[1];
  } else if (mainMatch && mainMatch[1].replace(/<[^>]+>/g, '').trim().length > 250) {
    text = mainMatch[1];
  } else if (roleMainMatch && roleMainMatch[1].replace(/<[^>]+>/g, '').trim().length > 250) {
    text = roleMainMatch[1];
  }

  text = text
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n')
    .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n\n#### $1\n');

  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');
  text = text.replace(/<(?:p|div|section|blockquote|tr)[^>]*>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text);

  text = text
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(line => line.length > 0)
    .join('\n\n');

  let result = `Title: ${title}\n\n${text}`;
  if (result.length > maxLength) {
    result = result.slice(0, maxLength) + `\n\n... [Content truncated to ${maxLength} characters]`;
  }
  return result;
}

// Deep Search via Monid TinyFish (Browser-Rendered Live Web)
async function searchViaMonid({ query, domain_type = 'web', purpose, max_results = 5 }) {
  const apiKey = getMonidApiKey();
  const queryParams = {
    query: query.trim(),
    domain_type: domain_type || 'web'
  };
  if (purpose) queryParams.purpose = purpose;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch('https://api.monid.ai/v1/run', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Monid-Client': 'portable-bridge'
      },
      body: JSON.stringify({
        provider: 'tinyfish',
        endpoint: '/free/search',
        input: { queryParams }
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (!res.ok) return null;

    const data = await res.json();
    if (data.output && Array.isArray(data.output.results) && data.output.results.length > 0) {
      return data.output.results.slice(0, max_results);
    }
  } catch (err) {
    clearTimeout(timeout);
  }
  return null;
}

// Deep Scrape via Monid TinyFish (Browser-Rendered Dynamic Fetch)
async function fetchViaMonid({ url, purpose }) {
  const apiKey = getMonidApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const body = {
      urls: [url],
      format: 'markdown'
    };
    if (purpose) body.purpose = purpose;

    const res = await fetch('https://api.monid.ai/v1/run', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Monid-Client': 'portable-bridge'
      },
      body: JSON.stringify({
        provider: 'tinyfish',
        endpoint: '/free/fetch',
        input: { body }
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (!res.ok) return null;

    const data = await res.json();
    if (data.output && Array.isArray(data.output.results) && data.output.results[0]?.text) {
      const item = data.output.results[0];
      let formatted = `Source: ${item.final_url || item.url}\n`;
      if (item.title) formatted += `Title: ${item.title}\n`;
      if (item.published_date) formatted += `Date: ${item.published_date}\n`;
      if (item.author) formatted += `Author: ${item.author}\n`;
      formatted += `\n---\n\n`;

      let text = item.text.trim();
      if (text.length > 4000) {
        text = text.slice(0, 4000) + '\n\n... [Content truncated to 4000 characters]';
      }
      formatted += text;
      return formatted;
    }
  } catch (err) {
    clearTimeout(timeout);
  }
  return null;
}

// DuckDuckGo Live Search Fallback
async function searchViaDuckDuckGo({ query, max_results = 5 }) {
  const cleanQuery = query.trim();
  const max = Math.min(Math.max(parseInt(max_results, 10) || 5, 1), 10);
  const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
  };

  const results = [];

  // Stage 1: DDG HTML
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`;
    const resp = await fetch(url, { headers: commonHeaders, signal: AbortSignal.timeout(8000) });
    if (resp.ok) {
      const html = await resp.text();
      const titles = [...html.matchAll(/<a[^>]*class=['"]result__a['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/g)];
      const snippets = [...html.matchAll(/<a[^>]*class=['"]result__snippet['"][^>]*>([\s\S]*?)<\/a>/g)];

      for (let i = 0; i < Math.min(titles.length, max); i++) {
        let href = titles[i][1];
        if (href.includes('uddg=')) {
          const m = href.match(/uddg=([^&]+)/);
          if (m) href = decodeURIComponent(m[1]);
        }
        const title = decodeEntities(titles[i][2].replace(/<[^>]+>/g, '').trim());
        const snippet = snippets[i] ? decodeEntities(snippets[i][1].replace(/<[^>]+>/g, '').trim()) : '';

        if (title && href && !href.includes('duckduckgo.com/y.js')) {
          results.push({ title, url: href, snippet });
        }
      }
    }
  } catch {}

  // Stage 2: DDG Lite Fallback
  if (results.length === 0) {
    try {
      const resp = await fetch('https://lite.duckduckgo.com/lite/', {
        method: 'POST',
        headers: { ...commonHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `q=${encodeURIComponent(cleanQuery)}`,
        signal: AbortSignal.timeout(8000)
      });
      if (resp.ok) {
        const html = await resp.text();
        const titleMatches = [...html.matchAll(/<a[^>]+class=['"]result-link['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/g)];
        const snippetMatches = [...html.matchAll(/<td[^>]+class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g)];

        for (let i = 0; i < Math.min(titleMatches.length, max); i++) {
          let href = titleMatches[i][1];
          if (href.includes('uddg=')) {
            const m = href.match(/uddg=([^&]+)/);
            if (m) href = decodeURIComponent(m[1]);
          }
          const title = decodeEntities(titleMatches[i][2].replace(/<[^>]+>/g, '').trim());
          const snippet = snippetMatches[i] ? decodeEntities(snippetMatches[i][1].replace(/<[^>]+>/g, '').trim()) : '';
          if (title && href) results.push({ title, url: href, snippet });
        }
      }
    } catch {}
  }

  return results;
}

// Master Search Handler (Monid Deep Search -> DDG Fallback)
async function executeWebSearch({ query, domain_type = 'web', purpose, max_results = 5 }) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return 'Error: "query" parameter is required and must be a non-empty string.';
  }

  const cleanQuery = query.trim();
  const max = Math.min(Math.max(parseInt(max_results, 10) || 5, 1), 10);

  // 1. Try Monid Deep Search First
  const monidResults = await searchViaMonid({ query: cleanQuery, domain_type, purpose, max_results: max });
  if (monidResults && monidResults.length > 0) {
    let output = `Deep Web Search Results for: "${cleanQuery}" (${monidResults.length} found)\n\n`;
    monidResults.forEach((r, idx) => {
      output += `[${idx + 1}] ${r.title}\n`;
      output += `    URL: ${r.url}\n`;
      if (r.site_name) output += `    Source: ${r.site_name}\n`;
      if (r.date) output += `    Date: ${r.date}\n`;
      if (r.year) output += `    Year: ${r.year}\n`;
      if (r.authors && Array.isArray(r.authors)) output += `    Authors: ${r.authors.join(', ')}\n`;
      if (r.cited_by_count) output += `    Citations: ${r.cited_by_count}\n`;
      if (r.pdf_url) output += `    PDF: ${r.pdf_url}\n`;
      output += `    Snippet: ${r.snippet}\n\n`;
    });
    return output.trim();
  }

  // 2. Fallback to DuckDuckGo
  const ddgResults = await searchViaDuckDuckGo({ query: cleanQuery, max_results: max });
  if (ddgResults && ddgResults.length > 0) {
    let output = `Web Search Results for: "${cleanQuery}" (${ddgResults.length} found)\n\n`;
    ddgResults.forEach((r, idx) => {
      output += `[${idx + 1}] ${r.title}\n`;
      output += `    URL: ${r.url}\n`;
      output += `    Snippet: ${r.snippet}\n\n`;
    });
    return output.trim();
  }

  return `No search results could be retrieved for query: "${cleanQuery}".`;
}

// Master Scrape Handler (Monid Deep Browser Fetch -> Direct DOM Fallback)
async function executeWebScrape({ url, purpose }) {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return 'Error: "url" parameter is required and must be a valid URL string.';
  }

  let targetUrl = url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = 'https://' + targetUrl;
  }

  // 1. Try Monid Browser-Rendered Fetch First
  const monidContent = await fetchViaMonid({ url: targetUrl, purpose });
  if (monidContent) {
    return monidContent;
  }

  // 2. Fallback to Direct Fetch & DOM Cleaning
  try {
    const resp = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000)
    });

    if (!resp.ok) {
      return `Failed to scrape "${targetUrl}": Server returned HTTP ${resp.status} ${resp.statusText}`;
    }

    const contentType = resp.headers.get('content-type') || '';
    const rawContent = await resp.text();

    if (contentType.includes('application/json')) {
      try {
        const parsed = JSON.parse(rawContent);
        const formatted = JSON.stringify(parsed, null, 2);
        return formatted.length > 4000
          ? formatted.slice(0, 4000) + '\n\n... [JSON truncated to 4000 characters]'
          : formatted;
      } catch {
        return rawContent.slice(0, 4000);
      }
    }

    if (contentType.includes('text/plain')) {
      return rawContent.length > 4000
        ? rawContent.slice(0, 4000) + '\n\n... [Text truncated to 4000 characters]'
        : rawContent;
    }

    const cleaned = cleanHtml(rawContent, 4000);
    return `Source: ${targetUrl}\n\n${cleaned}`;
  } catch (err) {
    return `Error fetching and scraping URL "${targetUrl}": ${err.message}`;
  }
}

// Handle Incoming MCP JSON-RPC Requests
async function handleJsonRpc(msg) {
  if (!msg || typeof msg !== 'object') {
    return {
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Invalid Request' },
      id: null
    };
  }

  const { id, method, params } = msg;

  // 1. Initialize
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {
            listChanged: false
          }
        },
        serverInfo: {
          name: 'portable-web-mcp-bridge',
          version: '2.0.0'
        }
      }
    };
  }

  // 2. Client Notification: Initialized
  if (method === 'notifications/initialized') {
    console.log('[MCP] Client confirmed initialization handshake.');
    return null;
  }

  // 3. Ping
  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  // 4. Tools List
  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: MCP_TOOLS
      }
    };
  }

  // 5. Tools Call
  if (method === 'tools/call') {
    const toolName = params?.name;
    let toolArgs = params?.arguments || params?.args || params?.parameters || {};
    if (typeof toolArgs === 'string') {
      try { toolArgs = JSON.parse(toolArgs); } catch {}
    }

    console.log(`[MCP TOOL CALL] Executing tool: ${toolName}`);

    // Handle search tools: web_search & deep_search
    if (toolName === 'web_search' || toolName === 'deep_search') {
      const q = toolArgs.query || toolArgs.q || toolArgs.search_query || toolArgs.keywords || '';
      const maxResults = toolArgs.max_results || toolArgs.limit || 5;
      const domainType = toolArgs.domain_type || (toolName === 'deep_search' ? (toolArgs.domain_type || 'web') : 'web');
      const purpose = toolArgs.purpose || '';

      const text = await executeWebSearch({
        query: q,
        domain_type: domainType,
        purpose,
        max_results: maxResults
      });

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text }],
          isError: false
        }
      };
    }

    // Handle scraping tools: web_scrape & deep_scrape
    if (toolName === 'web_scrape' || toolName === 'deep_scrape') {
      const targetUrl = toolArgs.url || toolArgs.uri || toolArgs.link || toolArgs.target || '';
      const purpose = toolArgs.purpose || '';
      const text = await executeWebScrape({ url: targetUrl, purpose });

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text }],
          isError: false
        }
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Tool not found: "${toolName}"`
      }
    };
  }

  // Fallback for resources / prompts
  if (id !== undefined && id !== null) {
    return { jsonrpc: '2.0', id, result: {} };
  }

  return null;
}

// Create HTTP & SSE Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || HOST + ':' + PORT}`);
  const pathname = parsedUrl.pathname;

  // 1. CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // 2. GET /sse - MCP SSE Transport
  if (req.method === 'GET' && pathname === '/sse') {
    const sessionId = crypto.randomBytes(8).toString('hex');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      ...corsHeaders
    });

    res.write(`event: endpoint\r\ndata: /messages?sessionId=${sessionId}\r\n\r\n`);

    const keepAlive = setInterval(() => {
      try { res.write(': keepalive\r\n\r\n'); } catch {}
    }, 15000);

    sessions.set(sessionId, { res, keepAlive });
    console.log(`[SSE] Client connected. Session ID: ${sessionId} (Active sessions: ${sessions.size})`);

    req.on('close', () => {
      clearInterval(keepAlive);
      sessions.delete(sessionId);
      console.log(`[SSE] Client disconnected. Session ID: ${sessionId} (Remaining: ${sessions.size})`);
    });
    return;
  }

  // 3. POST /messages
  if (req.method === 'POST' && (pathname === '/messages' || pathname === '/sse' || pathname === '/' || pathname === '/mcp')) {
    const sessionId = parsedUrl.searchParams.get('sessionId');
    let body = '';

    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) req.destroy();
    });

    req.on('end', async () => {
      let rpcMsg;
      try {
        rpcMsg = JSON.parse(body);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: invalid JSON' }, id: null }));
        return;
      }

      const response = await handleJsonRpc(rpcMsg);

      if (response) {
        const ssePayload = `event: message\r\ndata: ${JSON.stringify(response)}\r\n\r\n`;
        if (sessionId && sessions.has(sessionId)) {
          try { sessions.get(sessionId).res.write(ssePayload); } catch {}
        } else if (sessions.size > 0) {
          for (const session of sessions.values()) {
            try { session.res.write(ssePayload); } catch {}
          }
        }
      }

      if (response) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify(response));
      } else {
        res.writeHead(202, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ status: 'accepted' }));
      }
    });
    return;
  }

  // 4. Status / Health Check Endpoint
  if (req.method === 'GET' && (pathname === '/' || pathname === '/health' || pathname === '/status')) {
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify({
      status: 'online',
      service: 'Portable Deep Web Search & Scraping MCP Bridge',
      version: '2.0.0',
      port: PORT,
      host: HOST,
      mcp_endpoint: `http://${HOST}:${PORT}/sse`,
      active_sse_sessions: sessions.size,
      available_tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description }))
    }, null, 2));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain', ...corsHeaders });
  res.end('Not Found');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[ERROR] Port ${PORT} is already in use.`);
  } else {
    console.error('[ERROR] Server error:', err.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log('================================================================');
  console.log('  Portable Deep Web Search & Scraping MCP Server (Monid Inside) ');
  console.log('================================================================');
  console.log(` Status:           RUNNING`);
  console.log(` Bound Address:    http://${HOST}:${PORT}`);
  console.log(` MCP SSE Endpoint: http://${HOST}:${PORT}/sse`);
  console.log(` Active Tools:     web_search, web_scrape, deep_search, deep_scrape`);
  console.log(' Ready for connection from llama-server Web UI!');
  console.log('================================================================');
});

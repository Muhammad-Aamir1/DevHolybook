/**
 * proxy.js — Git Mastery AI Proxy (OpenRouter Edition)
 * ════════════════════════════════════════════════════
 * Uses OpenRouter — one key, many free models.
 * Get your key at: https://openrouter.ai/keys
 *
 * LEFT  panel → DeepSeek V3 (free) → fallback free models
 * RIGHT panel → Gemini Flash (free) → fallback free models
 *
 * HOW TO RUN:
 *   node proxy.js
 *   OR:
 *   OPENROUTER_KEY=sk-or-... node proxy.js
 *
 * REQUIREMENTS: Node.js 18+  (no npm install needed)
 * ════════════════════════════════════════════════════
 */

const http  = require('http');
const https = require('https');

// ══════════════════════════════════════════════════════════
//   PASTE YOUR OPENROUTER KEY HERE
//   Get it free at: https://openrouter.ai/keys
// ══════════════════════════════════════════════════════════
const OPENROUTER_KEY = process.env.OPENROUTER_KEY || 'PASTE_HERE_OPEN_ROUTER_KEY';
// ══════════════════════════════════════════════════════════

const PORT = process.env.PORT ? Number(process.env.PORT) : 3132;

// Free models on OpenRouter — in fallback order
// All marked :free — no credits needed
const MODELS = {
  deepseek: [
    'openai/gpt-4o-mini',
    'openrouter/auto',
  ],
  gemini: [
    'openai/gpt-4o-mini',
    'openrouter/auto',
  ],
};

const SYSTEM = {
  deepseek: 'You are DeepSeek, a precise and technical Git/version-control expert. Answer in 2-3 focused paragraphs. Use backtick code for commands. Be direct — no filler.',
  gemini  : 'You are Gemini, a clear and helpful Git/GitHub assistant. Answer in 2-3 short paragraphs. Use backtick code for commands. Lead with the most practical insight.',
};

const CORS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type'                : 'application/json',
};

// ── HTTPS helper ──────────────────────────────────────────
function httpsPost(hostname, path, headers, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req  = https.request(
      {
        hostname, path, method: 'POST',
        headers: {
          'Content-Type'  : 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers,
        },
      },
      res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve({ status: res.statusCode, body: d }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Call one OpenRouter model ─────────────────────────────
async function callOpenRouter(model, system, prompt) {
  const r = await httpsPost(
    'openrouter.ai',
    '/api/v1/chat/completions',
    {
      'Authorization'          : `Bearer ${OPENROUTER_KEY}`,
      'HTTP-Referer'           : 'http://localhost:3131',
      'X-Title'                : 'Git Mastery Guide',
    },
    {
      model,
      messages   : [
        { role: 'system', content: system },
        { role: 'user',   content: prompt },
      ],
      max_tokens : 450,
      temperature: 0.4,
    }
  );

  let p;
  try {
    p = JSON.parse(r.body);
  } catch (parseErr) {
    console.error('OpenRouter returned non-JSON body:', r.status, r.body);
    throw new Error(`OpenRouter parse error: ${parseErr.message}`);
  }

  // OpenRouter error shapes
  if (p.error)                              throw new Error(p.error.message || JSON.stringify(p.error));
  if (r.status === 429)                     throw new Error('Rate limited');
  if (r.status === 402)                     throw new Error('Insufficient credits');
  if (!p.choices?.[0]?.message?.content)   throw new Error('Empty response');

  return p.choices[0].message.content.trim();
}

// ── Fallback loop ─────────────────────────────────────────
async function runWithFallback(persona, prompt) {
  const sys    = SYSTEM[persona];
  const models = MODELS[persona];
  const errors = [];

  for (const model of models) {
    try {
      const text   = await callOpenRouter(model, sys, prompt);
      const source = model.split('/').pop().replace(':free', '').replace(/-/g, ' ');
      if (errors.length) {
        console.log(`  ↩  Fallback succeeded: ${model}`);
      }
      return { text, source };
    } catch (e) {
      errors.push(`${model}: ${e.message}`);
      console.warn(`  ⚠  ${model} failed: ${e.message}`);
    }
  }

  throw new Error('All models failed:\n' + errors.map(e => '  • ' + e).join('\n'));
}

// ── HTTP server ───────────────────────────────────────────
function send(res, status, obj) {
  res.writeHead(status, CORS);
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (req.method !== 'POST' || !req.url.startsWith('/api/')) {
    return send(res, 404, { error: 'Use POST /api/deepseek  or  POST /api/gemini' });
  }

  const persona = req.url.slice(5);
  if (!['deepseek', 'gemini'].includes(persona)) {
    return send(res, 404, { error: `Unknown endpoint "${persona}"` });
  }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      const { prompt } = JSON.parse(body);
      if (!prompt) return send(res, 400, { error: 'Missing "prompt"' });

      console.log(`\n  → [${persona}] "${prompt.slice(0, 70)}${prompt.length > 70 ? '…' : ''}"`);
      const result = await runWithFallback(persona, prompt);
      console.log(`  ✓ [${persona}] answered by: ${result.source}`);

      send(res, 200, { text: result.text, source: result.source });
    } catch (err) {
      console.error(`  ✗ [${persona}] all models failed`);
      send(res, 502, { error: err.message });
    }
  });
});

server.listen(PORT, () => {
  const hasKey = OPENROUTER_KEY !== 'YOUR_OPENROUTER_KEY_HERE';

  console.log('\n  ╔═════════════════════════════════════════════╗');
  console.log('  ║   Git Mastery AI Proxy  ✅  Running         ║');
  console.log('  ╚═════════════════════════════════════════════╝\n');
  console.log(`  🌐  Listening on http://localhost:${PORT}\n`);

  if (hasKey) {
    console.log('  🔑  OpenRouter key: ✅ loaded\n');
    console.log('  🤖  DeepSeek panel  →  ' + MODELS.deepseek[0]);
    console.log('  🔮  Gemini panel    →  ' + MODELS.gemini[0]);
    console.log('\n  All :free models — no credits needed.');
  } else {
    console.log('  ❌  No OpenRouter key found!\n');
    console.log('  Add your key in proxy.js on line 21:');
    console.log("    const OPENROUTER_KEY = 'sk-or-v1-...';\n");
    console.log('  Or run with env var:');
    console.log('    OPENROUTER_KEY=sk-or-v1-... node proxy.js\n');
    console.log('  Get a free key at: https://openrouter.ai/keys\n');
  }

  console.log('\n  Open git-mastery.html in your browser (via Live Server).');
  console.log('  Press Ctrl+C to stop.\n');
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ❌  Port ${PORT} already in use. Change PORT in proxy.js.\n`);
  } else {
    console.error('\n  ❌ ', err.message);
  }
  process.exit(1);
});

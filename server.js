const express = require('express');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ── Email cache (JSON file) ─────────────────────────────────
// Pure-JS persistence — no native compilation required.
const CACHE_FILE   = path.join(__dirname, 'email_cache.json');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); }
  catch (_) { return {}; }
}

function saveCache(cache) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); }
  catch (_) {}
}

const emailCache = loadCache();

// GET /api/cache/:email — return cached result if still fresh
app.get('/api/cache/:email', (req, res) => {
  const entry = emailCache[req.params.email.toLowerCase()];
  if (!entry || Date.now() - entry.checked_at > CACHE_TTL_MS) {
    return res.json({ cached: false });
  }
  res.json({ cached: true, status: entry.status });
});

// POST /api/cache — store a verified email result
app.post('/api/cache', (req, res) => {
  const { email, status } = req.body;
  if (!email || !status) return res.status(400).json({ error: 'email and status required' });
  emailCache[email.toLowerCase()] = { status, checked_at: Date.now() };
  saveCache(emailCache);
  res.json({ ok: true });
});

// ── HubSpot proxy ──────────────────────────────────────────
app.all('/api/hubspot/*', (req, res) => {
  const targetPath = req.path.replace('/api/hubspot', '');
  const qs         = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const targetUrl  = `https://api.hubapi.com${targetPath}${qs}`;

  const options = {
    method:  req.method,
    headers: {
      'Authorization': req.headers['authorization'] || '',
      'Content-Type':  'application/json',
    },
  };

  const proxyReq = https.request(targetUrl, options, proxyRes => {
    res.status(proxyRes.statusCode);
    ['content-type', 'x-hubspot-correlation-id'].forEach(h => {
      if (proxyRes.headers[h]) res.setHeader(h, proxyRes.headers[h]);
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', err => res.status(502).json({ error: err.message }));

  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
    proxyReq.write(JSON.stringify(req.body));
  }

  proxyReq.end();
});

// ── Static file ────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`AeroRev running on port ${PORT}`));

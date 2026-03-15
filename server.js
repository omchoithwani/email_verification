const express  = require('express');
const https    = require('https');
const path     = require('path');
const Database = require('better-sqlite3');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ── Email cache DB ──────────────────────────────────────────
// Stores previously verified email results so they don't need
// to be re-checked on subsequent runs.
const db = new Database(path.join(__dirname, 'email_cache.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS email_cache (
    email      TEXT PRIMARY KEY,
    status     TEXT NOT NULL,
    checked_at INTEGER NOT NULL
  )
`);

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// GET /api/cache/:email — check if an email has a cached result
app.get('/api/cache/:email', (req, res) => {
  const row = db.prepare('SELECT status, checked_at FROM email_cache WHERE email = ?')
                .get(req.params.email.toLowerCase());
  if (!row || Date.now() - row.checked_at > CACHE_TTL_MS) {
    return res.json({ cached: false });
  }
  res.json({ cached: true, status: row.status });
});

// POST /api/cache — store a verified email result
app.post('/api/cache', (req, res) => {
  const { email, status } = req.body;
  if (!email || !status) return res.status(400).json({ error: 'email and status required' });
  db.prepare('INSERT OR REPLACE INTO email_cache (email, status, checked_at) VALUES (?, ?, ?)')
    .run(email.toLowerCase(), status, Date.now());
  res.json({ ok: true });
});

// ── HubSpot proxy ──────────────────────────────────────────
// Forwards /api/hubspot/* → https://api.hubapi.com/*
// The Authorization header is passed through as-is from the browser.
// The token is never stored server-side.
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

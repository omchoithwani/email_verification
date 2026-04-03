const express = require('express');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ── Helpers ────────────────────────────────────────────────
function loadJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return {}; }
}
function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data)); } catch (_) {}
}

// ── Email result cache ──────────────────────────────────────
const EMAIL_CACHE_FILE = path.join(__dirname, 'email_cache.json');
const EMAIL_TTL_MS     = 30 * 24 * 60 * 60 * 1000; // 30 days
const emailCache       = loadJSON(EMAIL_CACHE_FILE);

app.get('/api/cache/:email', (req, res) => {
  const entry = emailCache[req.params.email.toLowerCase()];
  if (!entry || Date.now() - entry.checked_at > EMAIL_TTL_MS)
    return res.json({ cached: false });
  res.json({ cached: true, status: entry.status });
});

app.post('/api/cache', (req, res) => {
  const { email, status } = req.body;
  if (!email || !status) return res.status(400).json({ error: 'email and status required' });
  emailCache[email.toLowerCase()] = { status, checked_at: Date.now() };
  saveJSON(EMAIL_CACHE_FILE, emailCache);
  res.json({ ok: true });
});

// ── Domain MX cache ─────────────────────────────────────────
// Persists MX lookup results so the same domain isn't re-queried
// across separate browser sessions.
const DOMAIN_CACHE_FILE = path.join(__dirname, 'domain_cache.json');
const DOMAIN_TTL_MS     = 7 * 24 * 60 * 60 * 1000; // 7 days
const domainCache       = loadJSON(DOMAIN_CACHE_FILE);

app.get('/api/mx/:domain', (req, res) => {
  const entry = domainCache[req.params.domain.toLowerCase()];
  if (!entry || Date.now() - entry.checked_at > DOMAIN_TTL_MS)
    return res.json({ cached: false });
  res.json({ cached: true, hasMX: entry.hasMX });
});

app.post('/api/mx', (req, res) => {
  const { domain, hasMX } = req.body;
  if (!domain || hasMX === undefined) return res.status(400).json({ error: 'domain and hasMX required' });
  domainCache[domain.toLowerCase()] = { hasMX, checked_at: Date.now() };
  saveJSON(DOMAIN_CACHE_FILE, domainCache);
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

const express = require('express');
const https   = require('https');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

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

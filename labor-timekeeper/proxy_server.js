import http from 'http';
import https from 'https';

const TARGET_URL = process.env.TARGET_URL || 'http://34.31.213.200:8080';
const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  const target = new URL(TARGET_URL);
  const isHttps = target.protocol === 'https:';
  const transport = isHttps ? https : http;
  const defaultPort = isHttps ? 443 : (target.port || 80);

  const options = {
    hostname: target.hostname,
    port: target.port || defaultPort,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: target.hostname
    }
  };

  const proxyReq = transport.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy Error:', err);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad Gateway: VM may be down.');
  });

  req.pipe(proxyReq, { end: true });
});

server.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT} -> ${TARGET_URL}`);
});

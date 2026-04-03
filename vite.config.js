import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'jira-proxy',
      configureServer(server) {
        server.middlewares.use('/api/jira', async (req, res) => {
          const authHeader = req.headers.authorization;
          const jiraDomain = req.headers['x-jira-domain'] || 'sterlingbank';
          
          if (!authHeader) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing Authorization header' }));
            return;
          }

          let domain = jiraDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
          if (!domain.includes('.atlassian.net')) domain = domain + '.atlassian.net';
          const targetUrl = 'https://' + domain + req.url;

          try {
            const response = await fetch(targetUrl, {
              method: req.method || 'GET',
              headers: {
                Authorization: authHeader,
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
            });
            const text = await response.text();
            res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') || 'application/json' });
            res.end(text);
          } catch (err) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Proxy error: ' + err.message }));
          }
        });
      },
    },
  ],
  server: { port: 3000 },
});

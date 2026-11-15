import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import path from 'path';
import { initDatabase } from './server/db.ts';
import { setupWebSocketServer } from './server/realtime.ts';
import { registerApiRoutes, runExpirySweep } from './server/routes.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function bootstrap() {
  initDatabase();

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  registerApiRoutes(app);

  const httpServer = http.createServer(app);
  setupWebSocketServer(httpServer);

  // Automatic server-side expiry & OTP purge sweep every 5 seconds
  setInterval(() => {
    try {
      runExpirySweep();
    } catch {
      // Keep sweep resilient
    }
  }, 5000);

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`BEAUTY NUMBER server running on http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start BEAUTY NUMBER server:', err);
  process.exit(1);
});

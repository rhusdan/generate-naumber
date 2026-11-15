import type { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { verifyAuthToken } from './auth.ts';

interface SocketClient {
  ws: WebSocket;
  userId: string;
  role: 'user' | 'admin';
}

const clients = new Set<SocketClient>();

export function setupWebSocketServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const reqUrl = new URL(req.url || '/', 'http://localhost:3000');
    const token = reqUrl.searchParams.get('token');
    if (!token) {
      ws.close(4001, 'Unauthorized');
      return;
    }
    const payload = verifyAuthToken(token);
    if (!payload) {
      ws.close(4001, 'Invalid token');
      return;
    }

    const client: SocketClient = {
      ws,
      userId: payload.userId,
      role: payload.role,
    };
    clients.add(client);

    ws.send(JSON.stringify({ event: 'ws:connected', data: { userId: payload.userId } }));

    ws.on('close', () => {
      clients.delete(client);
    });

    ws.on('error', () => {
      clients.delete(client);
    });
  });

  return wss;
}

export function emitToUser(userId: string, event: string, data: unknown) {
  const payload = JSON.stringify({ event, data });
  for (const client of clients) {
    if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

export function emitToAll(event: string, data: unknown) {
  const payload = JSON.stringify({ event, data });
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

/**
 * Authoritative WebSocket game server entry point.
 *
 * Boots a `ws` WebSocketServer on PORT (default 8080), exposes a tiny HTTP
 * health check, and wires every incoming connection into the SessionManager.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import { SessionManager } from './sessionManager.ts';

const PORT = Number(process.env.PORT ?? 8080);

export function startServer(port: number = PORT): { close: () => Promise<void>; port: number } {
  const manager = new SessionManager();

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', sessions: manager.activeCount }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: http });
  wss.on('connection', (ws) => manager.handleConnection(ws));
  wss.on('error', (err) => console.error('[server] wss error:', err.message));

  http.listen(port, () => {
    const addr = http.address();
    const boundPort = typeof addr === 'object' && addr ? addr.port : port;
    console.log(`[server] listening on ws://localhost:${boundPort}`);
  });

  const close = () =>
    new Promise<void>((resolve) => {
      wss.close(() => http.close(() => resolve()));
    });

  return {
    close,
    get port() {
      const addr = http.address();
      return typeof addr === 'object' && addr ? addr.port : port;
    },
  };
}

// Start automatically unless imported by a test harness (which sets its own port).
if (!process.env.GAME_SERVER_NO_AUTOSTART) {
  startServer();
}

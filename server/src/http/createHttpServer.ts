/**
 * 创建共享 HTTP + WebSocket 服务器。
 *
 * http.createServer() 处理 HTTP 请求，同时通过 upgrade 事件
 * 将 /ws 路径的连接升级为 WebSocket（由 ws 库 handleUpgrade）。
 *
 * 零额外依赖：仅 Node.js 内置 http + ws 库。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import type { Server } from 'node:http';

export interface HttpWsServer {
  httpServer: Server;
  wss: WebSocketServer;
  listen(port: number, cb?: () => void): Server;
  close(cb?: (err?: Error) => void): void;
}

export function createHttpWsServer(): HttpWsServer {
  const httpServer = createServer();
  const wss = new WebSocketServer({ noServer: true });

  // 仅升级 /ws 路径到 WebSocket
  httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  return {
    httpServer,
    wss,
    listen(port: number, cb?: () => void) {
      return httpServer.listen(port, cb);
    },
    close(cb?: (err?: Error) => void) {
      wss.close();
      httpServer.close(cb);
    },
  };
}

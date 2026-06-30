/**
 * 服务入口：启动 HTTP + WebSocket 共享服务器。
 *
 * 架构：
 *   http.createServer()
 *   ├── request → handleRequest (REST API)
 *   └── upgrade → /ws 路径升级为 WebSocket (MahjongWSServer)
 *
 * 部署到 CloudBase 云托管时，监听 process.env.PORT。
 * 本地开发默认端口 3000。
 */
import { createHttpWsServer } from './http/createHttpServer.js';
import { handleRequest } from './http/routes.js';
import './http/registerRoutes.js'; // side-effect: 注册所有 HTTP 路由
import { MahjongWSServer } from './ws/WebSocketServer.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

// 创建共享 HTTP+WS 服务器
const { httpServer, wss, listen, close } = createHttpWsServer();

// HTTP 请求 → 路由分发
httpServer.on('request', (req, res) => {
  handleRequest(req, res);
});

// WebSocket → MahjongWSServer
const mahjongServer = new MahjongWSServer(wss);

listen(PORT, () => {
  console.log(`[mahjong-server] HTTP + WebSocket 服务器已启动，端口 ${PORT}`);
  console.log(`[mahjong-server] REST API: http://localhost:${PORT}/api/health`);
  console.log(`[mahjong-server] WebSocket: ws://localhost:${PORT}/ws`);
});

// 优雅退出
function shutdown() {
  console.log('[mahjong-server] 正在关闭...');
  close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

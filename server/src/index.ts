/**
 * 服务入口：启动 WebSocket 服务器。
 * 部署到 CloudBase 云托管时，监听 process.env.PORT。
 */
import { createWSServer } from './ws/index.js';

const PORT = parseInt(process.env.PORT ?? '8080', 10);

const wss = createWSServer(PORT);
console.log(`[mahjong-server] WebSocket 服务器已启动，端口 ${PORT}`);

// 优雅退出
process.on('SIGTERM', () => {
  wss.close(() => process.exit(0));
});

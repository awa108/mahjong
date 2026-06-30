/**
 * HTTP 路由注册（通过 import 副作用生效）。
 *
 * 端点：
 *   GET  /api/health      — 健康检查
 *   POST /api/login/mock  — 开发环境 mock 登录
 */
import { addRoute, sendJson } from './routes.js';
import { authService } from '../auth/AuthService.js';

// ─── GET /api/health ────────────────────────────

addRoute('GET', '/api/health', (_req, res) => {
  sendJson(res, 200, { status: 'ok', uptime: process.uptime() });
});

// ─── POST /api/login/mock ───────────────────────

addRoute('POST', '/api/login/mock', async (_req, res, body) => {
  const payload = (body ?? {}) as Record<string, unknown>;
  const nickname =
    typeof payload.nickname === 'string' && payload.nickname.length > 0
      ? payload.nickname
      : 'Player';
  const avatarUrl =
    typeof payload.avatarUrl === 'string' ? payload.avatarUrl : undefined;

  const result = await authService.login({
    code: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    nickname,
    avatarUrl,
  });

  sendJson(res, 200, {
    playerId: result.playerId,
    nickname: result.nickname,
    avatarUrl: result.avatarUrl,
    sessionToken: result.sessionToken,
  });
});

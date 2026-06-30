/**
 * HTTP 端点测试：health + mock login。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHttpWsServer } from '../src/http/createHttpServer.js';
import { handleRequest } from '../src/http/routes.js';
import '../src/http/registerRoutes.js'; // side-effect: register routes
import type { Server } from 'node:http';

let server: ReturnType<typeof createHttpWsServer>;
let url: string;

beforeAll(async () => {
  server = createHttpWsServer();
  server.httpServer.on('request', (req, res) => handleRequest(req, res));
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const addr = server.httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  url = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

async function fetchJson(path: string, options?: { method?: string; body?: unknown }) {
  const resp = await fetch(`${url}${path}`, {
    method: options?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options?.body != null ? JSON.stringify(options.body) : undefined,
  });
  const data = await resp.json();
  return { status: resp.status, data };
}

describe('HTTP endpoints', () => {
  describe('GET /api/health', () => {
    it('returns 200 with status ok', async () => {
      const { status, data } = await fetchJson('/api/health');
      expect(status).toBe(200);
      expect(data.status).toBe('ok');
      expect(typeof data.uptime).toBe('number');
    });
  });

  describe('POST /api/login/mock', () => {
    it('returns playerId, nickname, sessionToken', async () => {
      const { status, data } = await fetchJson('/api/login/mock', {
        method: 'POST',
        body: { nickname: 'TestPlayer' },
      });

      expect(status).toBe(200);
      expect(typeof data.playerId).toBe('string');
      expect(data.playerId.length).toBeGreaterThan(0);
      expect(data.nickname).toBe('TestPlayer');
      expect(typeof data.sessionToken).toBe('string');
      expect(data.sessionToken.length).toBeGreaterThan(0);
    });

    it('defaults nickname to Player when missing', async () => {
      const { status, data } = await fetchJson('/api/login/mock', {
        method: 'POST',
        body: {},
      });

      expect(status).toBe(200);
      expect(data.nickname).toBe('Player');
    });

    it('defaults nickname to Player when empty string', async () => {
      const { status, data } = await fetchJson('/api/login/mock', {
        method: 'POST',
        body: { nickname: '' },
      });

      expect(status).toBe(200);
      expect(data.nickname).toBe('Player');
    });

    it('returns unique playerId each call', async () => {
      const a = await fetchJson('/api/login/mock', { method: 'POST', body: { nickname: 'A' } });
      const b = await fetchJson('/api/login/mock', { method: 'POST', body: { nickname: 'B' } });
      expect(a.data.playerId).not.toBe(b.data.playerId);
    });
  });

  describe('404', () => {
    it('returns 404 for unknown routes', async () => {
      const { status, data } = await fetchJson('/api/nonexistent');
      expect(status).toBe(404);
      expect(data.error).toBe('Not Found');
    });
  });
});

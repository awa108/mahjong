/**
 * AuthService 测试：mock login、token 校验、伪造拒绝、过期拒绝。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthService } from '../src/auth/AuthService.js';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('AuthService', () => {
  let auth: AuthService;

  beforeEach(() => {
    auth = new AuthService({ sessionTtlMs: 1000 }); // 1s TTL for faster expiry test
  });

  // ── mock login ────────────────────────────────

  it('mock login 生成 playerId / nickname / token', async () => {
    const result = await auth.login({ code: 'mock_testuser' });
    expect(result.playerId).toBe('testuser');
    expect(result.nickname).toBeDefined();
    expect(result.sessionToken).toBeDefined();
  });

  it('mock login 不传 code 时自动生成 playerId', async () => {
    const result = await auth.login({ code: '' });
    expect(result.playerId).toMatch(/^p_/);
    expect(result.sessionToken.length).toBeGreaterThan(20);
  });

  it('mock login 复用已有 profile', async () => {
    const r1 = await auth.login({ code: 'mock_alice', nickname: 'Alice' });
    const r2 = await auth.login({ code: 'mock_alice' });
    expect(r2.nickname).toBe('Alice');
  });

  // ── token 校验 ────────────────────────────────

  it('合法 token 校验通过', async () => {
    const { sessionToken, playerId } = await auth.login({ code: 'mock_bob' });
    const uid = auth.verifyToken(sessionToken);
    expect(uid).toBe(playerId);
  });

  it('无 token 校验拒绝', () => {
    expect(auth.verifyToken('')).toBeNull();
  });

  it('伪造 token 校验拒绝', () => {
    expect(auth.verifyToken('fake-token-12345')).toBeNull();
  });

  it('过期 token 校验拒绝', async () => {
    const { sessionToken } = await auth.login({ code: 'mock_eve' });
    await sleep(1200); // 超过 1s TTL
    expect(auth.verifyToken(sessionToken)).toBeNull();
  });

  it('吊销 token 后校验拒绝', async () => {
    const { sessionToken } = await auth.login({ code: 'mock_mallory' });
    auth.revokeToken(sessionToken);
    expect(auth.verifyToken(sessionToken)).toBeNull();
  });

  // ── token 续期 ────────────────────────────────

  it('心跳续期后不过期', async () => {
    const { sessionToken, playerId } = await auth.login({ code: 'mock_charlie' });
    await sleep(600);
    const ok = auth.refreshToken(sessionToken);
    expect(ok).toBe(true);
    await sleep(600); // total 1200ms > TTL, but refresh
    expect(auth.verifyToken(sessionToken)).toBe(playerId);
  });

  // ── profile ───────────────────────────────────

  it('getProfile 返回玩家公开信息', async () => {
    const { playerId } = await auth.login({ code: 'mock_dave', nickname: 'Dave', avatarUrl: 'https://example.com/avatar.png' });
    const p = auth.getProfile(playerId);
    expect(p?.nickname).toBe('Dave');
    expect(p?.avatarUrl).toBe('https://example.com/avatar.png');
  });

  it('updateProfile 更新昵称', async () => {
    const { playerId } = await auth.login({ code: 'mock_frank', nickname: 'Frank' });
    auth.updateProfile(playerId, { nickname: 'Frankie' });
    expect(auth.getProfile(playerId)?.nickname).toBe('Frankie');
  });

  // ── wx login 占位 ────────────────────────────

  it('配置 appSecret 时走 wxLogin（mock fetch）', async () => {
    const auth2 = new AuthService({ appId: 'wxappid', appSecret: 'secret', sessionTtlMs: 5000 });

    // Mock fetch to return valid wx response
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ openid: 'oabc123', session_key: 'skey' }),
    } as Response);

    const result = await auth2.login({ code: 'wx_code_123', nickname: 'WXUser', avatarUrl: '' });
    expect(result.playerId).toBe('wx_oabc123');
    expect(result.nickname).toBe('WXUser');
    expect(result.sessionToken).toBeDefined();

    fetchSpy.mockRestore();
  });

  it('微信 code2session 失败时抛错', async () => {
    const auth2 = new AuthService({ appId: 'wxappid', appSecret: 'secret', sessionTtlMs: 5000 });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errcode: 40029, errmsg: 'invalid code' }),
    } as Response);

    await expect(auth2.login({ code: 'bad_code' })).rejects.toThrow('invalid code');
  });
});

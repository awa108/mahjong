/**
 * AuthService — 认证服务。
 *
 * 开发环境：mock login，生成 playerId + nickname + avatarUrl + sessionToken。
 * 生产环境：支持 wx.login code 换 openid，appSecret 仅从环境变量读取。
 *
 * sessionToken 校验：同步查内存 Map，支持过期（默认 24h）。
 */
import crypto from 'node:crypto';

// ─── 类型 ──────────────────────────────────────────

export interface LoginResult {
  playerId: string;
  nickname: string;
  avatarUrl: string;
  sessionToken: string;
}

export interface WxLoginPayload {
  code: string;
  nickname?: string;
  avatarUrl?: string;
}

// ─── AuthService ───────────────────────────────────

export class AuthService {
  /** token → { playerId, expires } */
  private sessions = new Map<string, { playerId: string; expires: number }>();
  /** playerId → profile */
  private profiles = new Map<string, { nickname: string; avatarUrl: string }>();

  private readonly appId: string;
  private readonly appSecret: string;
  private readonly sessionTtlMs: number;

  constructor(opts?: {
    appId?: string;
    appSecret?: string;
    sessionTtlMs?: number;
  }) {
    this.appId = opts?.appId ?? process.env.WX_APPID ?? '';
    this.appSecret = opts?.appSecret ?? process.env.WX_APPSECRET ?? '';
    this.sessionTtlMs = opts?.sessionTtlMs ?? 24 * 3600 * 1000;
  }

  // ── 登录 ──────────────────────────────────────

  /**
   * 登录入口：开发环境直接 mock，生产环境换 openid。
   * 都是幂等的：同一 code/playerId 多次调用不会创建新 session。
   */
  async login(payload: WxLoginPayload): Promise<LoginResult> {
    // 生产：走微信 code2session
    if (this.appSecret) {
      return this.wxLogin(payload);
    }
    // 开发：mock
    return this.mockLogin(payload);
  }

  private async mockLogin(payload: WxLoginPayload): Promise<LoginResult> {
    const playerId =
      payload.code && payload.code.startsWith('mock_')
        ? payload.code.slice(5)
        : `p_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;

    // 复用已有 profile，或用新传参，或默认
    let profile = this.profiles.get(playerId);
    if (profile) {
      if (payload.nickname) profile.nickname = payload.nickname;
      if (payload.avatarUrl) profile.avatarUrl = payload.avatarUrl;
    } else {
      profile = {
        nickname: payload.nickname ?? `玩家${playerId.slice(-4)}`,
        avatarUrl: payload.avatarUrl ?? '',
      };
      this.profiles.set(playerId, profile);
    }

    const sessionToken = this.signToken(playerId);
    return { playerId, nickname: profile.nickname, avatarUrl: profile.avatarUrl, sessionToken };
  }

  private async wxLogin(payload: WxLoginPayload): Promise<LoginResult> {
    if (!this.appId || !this.appSecret) {
      throw new Error('WX_APPID / WX_APPSECRET 未配置');
    }

    const resp = await fetch(
      `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(this.appId)}&secret=${encodeURIComponent(this.appSecret)}&js_code=${encodeURIComponent(payload.code)}&grant_type=authorization_code`,
    );

    if (!resp.ok) {
      throw new Error(`微信 code2session 失败: HTTP ${resp.status}`);
    }

    const data = (await resp.json()) as {
      openid?: string;
      session_key?: string;
      errcode?: number;
      errmsg?: string;
    };

    if (data.errcode || !data.openid) {
      throw new Error(`微信 code2session 失败: ${data.errmsg ?? '无 openid'}`);
    }

    const playerId = `wx_${data.openid}`;
    const sessionToken = this.signToken(playerId);

    let profile = this.profiles.get(playerId);
    if (profile) {
      if (payload.nickname) profile.nickname = payload.nickname;
      if (payload.avatarUrl) profile.avatarUrl = payload.avatarUrl;
    } else {
      profile = {
        nickname: payload.nickname ?? `微信用户${Date.now().toString(36).slice(-4)}`,
        avatarUrl: payload.avatarUrl ?? '',
      };
      this.profiles.set(playerId, profile);
    }

    return { playerId, nickname: profile.nickname, avatarUrl: profile.avatarUrl, sessionToken };
  }

  // ── Token 签发 / 校验 ─────────────────────────

  /** 签发 session token（纯随机，不嵌入 playerId）。 */
  signToken(playerId: string): string {
    const token = crypto.randomBytes(24).toString('hex');
    this.sessions.set(token, {
      playerId,
      expires: Date.now() + this.sessionTtlMs,
    });
    return token;
  }

  /** 校验 token，返回 playerId；无效/过期返回 null。 */
  verifyToken(token: string): string | null {
    if (!token) return null;
    const entry = this.sessions.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.sessions.delete(token);
      return null;
    }
    return entry.playerId;
  }

  /** 刷新 token 过期时间（心跳续期）。 */
  refreshToken(token: string): boolean {
    const entry = this.sessions.get(token);
    if (!entry || Date.now() > entry.expires) return false;
    entry.expires = Date.now() + this.sessionTtlMs;
    return true;
  }

  /** 吊销 token。 */
  revokeToken(token: string): void {
    this.sessions.delete(token);
  }

  /** 吊销某玩家所有 session token（断线时调用，防止 token 复用攻击）。 */
  revokePlayerTokens(playerId: string): void {
    for (const [token, entry] of this.sessions) {
      if (entry.playerId === playerId) {
        this.sessions.delete(token);
      }
    }
  }

  // ── Profile ───────────────────────────────────

  /** 获取玩家公开信息。 */
  getProfile(playerId: string): { nickname: string; avatarUrl: string } | undefined {
    return this.profiles.get(playerId);
  }

  /** 更新昵称/头像（供后续使用）。 */
  updateProfile(playerId: string, data: { nickname?: string; avatarUrl?: string }): void {
    const p = this.profiles.get(playerId);
    if (p) {
      if (data.nickname) p.nickname = data.nickname;
      if (data.avatarUrl) p.avatarUrl = data.avatarUrl;
    } else {
      this.profiles.set(playerId, {
        nickname: data.nickname ?? '',
        avatarUrl: data.avatarUrl ?? '',
      });
    }
  }

  // ── 测试用 ───────────────────────────────────

  _reset(): void {
    this.sessions.clear();
    this.profiles.clear();
  }
}

/** 单例 */
export const authService = new AuthService();

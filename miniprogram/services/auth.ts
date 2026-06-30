/**
 * auth — 小程序端认证服务。
 *
 * 开发环境：mock login，本地生成 playerId 和 sessionToken。
 * 生产环境：wx.login 换 code → POST /auth/login 换取 sessionToken。
 *
 * 原则：
 * - 前端只保存 sessionToken，不保存 appSecret / openid。
 * - 连接 WebSocket 时必须携带 sessionToken。
 * - 敏感密钥仅存于服务端环境变量。
 */
import { apiCall } from './api';

/** 本地缓存的 key。 */
const TOKEN_KEY = 'mahjong_session_token';
const PLAYER_KEY = 'mahjong_player_info';

export interface PlayerInfo {
  playerId: string;
  nickname: string;
  avatarUrl: string;
  sessionToken: string;
}

// ─── 公开 API ──────────────────────────────────────

/**
 * 确保已有有效 session token：
 * 1. 本地缓存命中 → 直接返回
 * 2. 缓存未命中 → 走登录流程 → 缓存 → 返回
 */
export async function ensureAuth(): Promise<PlayerInfo> {
  const cached = readCachedPlayer();
  if (cached) return cached;

  const info = await doLogin();
  cachePlayer(info);
  return info;
}

/** 强制重新登录（清除旧缓存）。 */
export async function reLogin(): Promise<PlayerInfo> {
  clearCache();
  const info = await doLogin();
  cachePlayer(info);
  return info;
}

/** 获取当前的 sessionToken（仅返回字符串，供 socket 连接使用）。 */
export async function getSessionToken(): Promise<string> {
  const info = await ensureAuth();
  return info.sessionToken;
}

/** 清除本地登录态。 */
export function clearCache(): void {
  try {
    wx.removeStorageSync(TOKEN_KEY);
    wx.removeStorageSync(PLAYER_KEY);
  } catch {
    // ignore storage error
  }
}

// ─── 内部 ──────────────────────────────────────────

async function doLogin(): Promise<PlayerInfo> {
  // 开发环境：mock login
  if (!isProduction()) {
    return mockLogin();
  }
  // 生产环境：wx.login → 服务端换 token
  return wxLoginToServer();
}

function isProduction(): boolean {
  // 通过小程序环境判断；开发工具里 __wxConfig 可能不存在
  try {
    const accountInfo = (wx as any).getAccountInfoSync?.();
    return accountInfo?.miniProgram?.envVersion === 'release';
  } catch {
    return false;
  }
}

async function mockLogin(): Promise<PlayerInfo> {
  // 先用缓存中 playerId 生成稳定 mock code
  let mockCode: string;

  try {
    const cached = wx.getStorageSync(PLAYER_KEY) as PlayerInfo | undefined;
    if (cached?.playerId) {
      mockCode = `mock_${cached.playerId}`;
    } else {
      mockCode = `mock_${randomPlayerId()}`;
    }
  } catch {
    mockCode = `mock_${randomPlayerId()}`;
  }

  const nickname = `玩家${Date.now().toString(36).slice(-4)}`;
  const avatarUrl = '';

  // 调用服务端 /auth/login（开发环境服务端走 mock）
  try {
    const result = await apiCall('/auth/login', {
      code: mockCode,
      nickname,
      avatarUrl,
    }) as { playerId: string; nickname: string; avatarUrl: string; sessionToken: string };

    return {
      playerId: result.playerId,
      nickname: result.nickname,
      avatarUrl: result.avatarUrl,
      sessionToken: result.sessionToken,
    };
  } catch {
    // 如果后端未启动，fallback 本地生成
    const playerId = mockCode.startsWith('mock_') ? mockCode.slice(5) : mockCode;
    return {
      playerId,
      nickname,
      avatarUrl,
      sessionToken: `local_${playerId}_${Date.now().toString(36)}`,
    };
  }
}

async function wxLoginToServer(): Promise<PlayerInfo> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: async (res) => {
        if (!res.code) return reject(new Error('wx.login 无 code'));
        try {
          const result = await apiCall('/auth/login', {
            code: res.code,
            nickname: '',
            avatarUrl: '',
          }) as { playerId: string; nickname: string; avatarUrl: string; sessionToken: string };

          resolve({
            playerId: result.playerId,
            nickname: result.nickname,
            avatarUrl: result.avatarUrl,
            sessionToken: result.sessionToken,
          });
        } catch (e) {
          reject(e);
        }
      },
      fail: reject,
    });
  });
}

// ─── 缓存读写 ──────────────────────────────────────

function cachePlayer(info: PlayerInfo): void {
  try {
    wx.setStorageSync(TOKEN_KEY, info.sessionToken);
    wx.setStorageSync(PLAYER_KEY, info);
  } catch {
    // ignore
  }
}

function readCachedPlayer(): PlayerInfo | null {
  try {
    const info = wx.getStorageSync(PLAYER_KEY) as PlayerInfo | undefined;
    if (info?.sessionToken && info?.playerId) return info;
    return null;
  } catch {
    return null;
  }
}

function randomPlayerId(): string {
  const hex = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 12; i++) {
    id += hex[Math.floor(Math.random() * hex.length)];
  }
  return id;
}

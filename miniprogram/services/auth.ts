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
import { APP_ENV } from '../config/index';

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
 *
 * @param nickname 可选昵称（传入后用于 mock login）
 */
export async function ensureAuth(nickname?: string): Promise<PlayerInfo> {
  const cached = readCachedPlayer();
  if (cached) return cached;

  const info = await doLogin(nickname);
  cachePlayer(info);
  return info;
}

/** 强制重新登录（清除旧缓存）。 */
export async function reLogin(nickname?: string): Promise<PlayerInfo> {
  clearCache();
  const info = await doLogin(nickname);
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

async function doLogin(nickname?: string): Promise<PlayerInfo> {
  // 开发环境：调用服务端 mock login；失败则 fallback 本地
  if (APP_ENV === 'development') {
    try {
      return await serverMockLogin(nickname ?? 'Player');
    } catch {
      return localMockLogin(nickname ?? 'Player');
    }
  }
  // 生产环境：wx.login → 服务端换 token
  return wxLoginToServer(nickname ?? '');
}

/** 调用服务端 POST /api/login/mock。 */
async function serverMockLogin(nickname: string): Promise<PlayerInfo> {
  const result = await apiCall<{
    playerId: string;
    nickname: string;
    avatarUrl: string;
    sessionToken: string;
  }>('/login/mock', { nickname });

  return {
    playerId: result.playerId,
    nickname: result.nickname,
    avatarUrl: result.avatarUrl,
    sessionToken: result.sessionToken,
  };
}

/** 本地 fallback mock（服务端不可用时）。 */
function localMockLogin(nickname: string): PlayerInfo {
  // 注意：local fallback 生成的 token 仅在服务端不可用时作为临时使用
  // token 格式为 "local_<playerId>_<timestamp>"，不会通过服务端的 verifyToken 验证
  const playerId = `p_local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  return {
    playerId,
    nickname,
    avatarUrl: '',
    sessionToken: `local_${playerId}_${Date.now().toString(36)}`,
  };
}

async function wxLoginToServer(nickname: string): Promise<PlayerInfo> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: async (res) => {
        if (!res.code) return reject(new Error('wx.login 无 code'));
        try {
          const result = await apiCall('/auth/login', {
            code: res.code,
            nickname: nickname || '',
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

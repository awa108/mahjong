/**
 * HTTPS API 封装（微信登录、建房等短请求）。
 */
import { API_BASE_URL } from '../config/index';

/** 泛型 API 调用。 */
export async function apiCall<T = unknown>(path: string, data: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE_URL}${path}`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`));
        }
      },
      fail(err) {
        reject(err);
      },
    });
  });
}

/** 发送 code 到服务端换取 session token（生产环境走微信 code2session）。 */
export async function login(code: string) {
  return apiCall<{ playerId: string; nickname: string; avatarUrl: string; sessionToken: string }>(
    '/login/mock',
    { code },
  );
}

/** 创建房间（HTTP 路径，目前建房走 WS CREATE_ROOM）。 */
export async function createRoom(token: string, nickname: string) {
  return apiCall<{ roomCode: string }>('/room/create', { token, nickname });
}

/** 获取房间信息。 */
export async function getRoom(token: string, roomCode: string) {
  return apiCall<unknown>('/room/info', { token, roomCode });
}

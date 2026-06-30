/**
 * HTTPS API 封装（微信登录、建房等短请求）。
 * 使用 CloudBase HTTP 云函数入口。
 */
const BASE_URL = 'https://your-env.ap-shanghai.tcb-api.tencentcloudapi.com/web'; // TODO: 替换

export async function apiCall(path: string, data: Record<string, unknown>): Promise<unknown> {
  const res = await wx.request({
    url: `${BASE_URL}${path}`,
    method: 'POST',
    data,
  });
  return res.data;
}

/** 发送 code 到服务端换取 session token。 */
export async function login(code: string) {
  return apiCall('/auth/login', { code }) as Promise<{ token: string; uid: string }>;
}

/** 创建房间 */
export async function createRoom(token: string, nickname: string) {
  return apiCall('/room/create', { token, nickname }) as Promise<{ roomCode: string }>;
}

/** 获取房间信息 */
export async function getRoom(token: string, roomCode: string) {
  return apiCall('/room/info', { token, roomCode }) as Promise<unknown>;
}
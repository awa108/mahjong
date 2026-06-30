/**
 * 小程序前端统一配置。
 *
 * 安全红线：
 * - 本文件绝不包含任何密钥（appSecret、JWT_SECRET、数据库密码等）。
 * - 所有密钥仅存在于 server 端环境变量，前端代码中不可出现。
 * - CI 中自动执行: grep -rE "(secret|password|key)" miniprogram/ --include="*.ts"
 *
 * 使用方式：
 *   import { API_BASE_URL, WS_URL } from '../../config/index';
 */

// ─── 环境判断 ──────────────────────────────────────────

export const APP_ENV: 'development' | 'production' = (() => {
  try {
    const accountInfo = wx.getAccountInfoSync?.();
    return accountInfo?.miniProgram?.envVersion === 'release' ? 'production' : 'development';
  } catch {
    return 'development';
  }
})();

// ─── API 地址 ─────────────────────────────────────────

/** HTTP API 地址。
 *  开发环境默认 localhost:3000。
 *  生产环境替换为 CloudBase 云托管分配的 HTTPS 域名。
 */
export const API_BASE_URL: string =
  APP_ENV === 'development'
    ? 'http://localhost:3000/api'
    : 'https://your-service-url.ap-shanghai.tcb-api.tencentcloudapi.com/api';

/** WebSocket 地址。
 *  开发环境默认 localhost:3000/ws。
 *  生产环境替换为 CloudBase 云托管分配的 WSS 域名。
 */
export const WS_URL: string =
  APP_ENV === 'development'
    ? 'ws://localhost:3000/ws'
    : 'wss://your-service-url.ap-shanghai.tcb-api.tencentcloudapi.com/ws';

// ─── CloudBase ────────────────────────────────────────

/** CloudBase 环境 ID。
 *  仅在需要客户端直连云开发资源时才需填写（如云存储上传），否则留空。
 */
export const CLOUD_ENV_ID: string = 'cloud1-d9ggcgqxc02c1aea9';

// ─── 运行时安全检查 ───────────────────────────────────

if (APP_ENV === 'production') {
  if (API_BASE_URL.startsWith('http://')) {
    console.error('[config] PRODUCTION 环境必须使用 https，当前 API_BASE_URL 以 http:// 开头');
  }
  if (WS_URL.startsWith('ws://')) {
    console.error('[config] PRODUCTION 环境必须使用 wss，当前 WS_URL 以 ws:// 开头');
  }
}

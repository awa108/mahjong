/**
 * 应用环境配置。
 *
 * 说明：
 * - 开发环境：微信开发者工具"不校验合法域名"模式
 * - 生产环境：须在微信公众平台配置合法 request/ws 域名
 * - 本文件不包含任何 secret（appSecret、密钥等应仅存在于 server 环境变量）
 */
export const APP_ENV: 'development' | 'production' = (() => {
  try {
    const accountInfo = wx.getAccountInfoSync?.();
    return accountInfo?.miniProgram?.envVersion === 'release' ? 'production' : 'development';
  } catch {
    return 'development';
  }
})();

/** HTTP API 地址。 */
export const API_BASE_URL: string =
  APP_ENV === 'development'
    ? 'http://localhost:3000/api'
    : 'https://your-service-url.ap-shanghai.tcb-api.tencentcloudapi.com/api';

/** WebSocket 地址。 */
export const WS_URL: string =
  APP_ENV === 'development'
    ? 'ws://localhost:3000/ws'
    : 'wss://your-service-url.ap-shanghai.tcb-api.tencentcloudapi.com/ws';

/** CloudBase 环境 ID（按需配置）。 */
export const CLOUD_ENV_ID: string = '';

// 生产环境安全协议检查（运行时 warn）
if (APP_ENV === 'production') {
  if (API_BASE_URL.startsWith('http://')) {
    console.error('[config] PRODUCTION must use https for API_BASE_URL');
  }
  if (WS_URL.startsWith('ws://')) {
    console.error('[config] PRODUCTION must use wss for WS_URL');
  }
}

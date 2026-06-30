/**
 * 微信麻雀小程序应用入口。
 * 初始化全局数据与 WebSocket 生命周期占位。
 */
import { WS_URL } from './config/index';

App({
  globalData: {
    /** WebSocket 服务器基地址（从 config 读取）。 */
    wsBaseUrl: WS_URL,
    /** 当前语言/区域 */
    locale: 'zh-CN' as const,
    /** ROUND_END 结算结果（game 页接收后写入，result 页读取后清空）。 */
    roundResult: null as any,
  },

  onLaunch() {
    console.log('[mahjong] App launched');
  },

  onHide() {
    // 退后台时不做特殊处理，WebSocket 维持心跳
  },
});

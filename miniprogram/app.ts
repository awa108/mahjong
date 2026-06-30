/**
 * 微信麻雀小程序应用入口。
 * 初始化全局数据与 WebSocket 生命周期占位。
 */

App({
  globalData: {
    /** 用户 session token（登录后写入）。 */
    token: '',
    /** 当前语言/区域 */
    locale: 'zh-CN',
    /**
     * WebSocket 服务器基地址。
     * 开发环境连本地，生产环境改为云托管 wss 地址。
     */
    WS_BASE_URL: 'wss://localhost:8080',
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

/**
 * 首页 — 登录 & 进入大厅。
 *
 * 流程：
 * 1. 用户输入昵称（可选，为空时服务端自动生成）
 * 2. 调用 ensureAuth 获取 playerId + sessionToken
 * 3. 跳转 lobby，由 lobby 负责 WebSocket 建连
 */
import { ensureAuth } from '../../services/auth';

const app = getApp<{ globalData: { WS_BASE_URL: string; token: string } }>();

Page({
  data: {
    nickname: '',
    loading: false,
    error: '',
  },

  onLoad() {
    // 如果已有缓存 token，可直接进入大厅
    this.checkCachedAuth();
  },

  /** 尝试读取缓存登录态，存在则提示可直接进入。 */
  async checkCachedAuth() {
    try {
      const info = await ensureAuth();
      if (info.playerId) {
        this.setData({ nickname: info.nickname || '' });
      }
    } catch {
      // 缓存不存在，正常流程
    }
  },

  // ── 输入 ──────────────────────────────────────

  onInputNickname(e: WechatMiniprogram.Input) {
    this.setData({ nickname: e.detail.value, error: '' });
  },

  // ── 进入大厅 ──────────────────────────────────

  /** 登录并进入大厅。 */
  async onEnterLobby() {
    if (this.data.loading) return;

    this.setData({ loading: true, error: '' });

    try {
      // 1. 获取登录态
      wx.showLoading({ title: '登录中…', mask: true });
      const info = await ensureAuth();

      wx.hideLoading();

      // 2. 跳转大厅（WebSocket 由 lobby 建立）
      const nickname = encodeURIComponent(this.data.nickname.trim() || info.nickname);
      wx.navigateTo({ url: `/pages/lobby/lobby?playerId=${info.playerId}&nickname=${nickname}` });
    } catch (e: any) {
      wx.hideLoading();
      this.setData({
        loading: false,
        error: e?.message ?? e?.errMsg ?? '登录失败，请重试',
      });
      wx.showToast({ title: '登录失败', icon: 'none' });
    }
  },
});

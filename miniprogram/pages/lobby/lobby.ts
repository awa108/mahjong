/**
 * lobby 大厅页 — 连接游戏服务器，创建/加入房间。
 *
 * 流程：
 * 1. 从 index 页拿到 playerId + nickname
 * 2. 建立 WebSocket 连接（带 token）
 * 3. 点击"创建房间"→ 发 CREATE_ROOM → 收到回执后跳 room 页
 * 4. 输入房间码点"加入"→ 发 JOIN_ROOM → 收到回执后跳 room 页
 *
 * 所有房间状态来自服务端广播，前端不做假状态。
 */
import { mahjongSocket, SocketEvent, type SocketError } from '../../services/socket';
import { ensureAuth } from '../../services/auth';
import type { ServerMessage } from '@mahjong/shared';

Page({
  data: {
    playerId: '',
    nickname: '',
    roomCode: '',
    connecting: true,
    error: '',
    creating: false,
    joining: false,
  },

  // ── 生命周期 ──────────────────────────────────

  async onLoad(query: Record<string, string>) {
    const playerId = query.playerId ?? '';
    const nickname = decodeURIComponent(query.nickname ?? '');

    this.setData({ playerId, nickname });

    // 监听服务端消息
    mahjongSocket.on(SocketEvent.MESSAGE, this.onServerMessage);
    mahjongSocket.on(SocketEvent.OPEN, this.onSocketOpen);
    mahjongSocket.on(SocketEvent.ERROR, this.onSocketError);
    mahjongSocket.on(SocketEvent.FATAL, this.onSocketFatal);

    // 建立连接
    await this.doConnect();
  },

  onUnload() {
    mahjongSocket.off(SocketEvent.MESSAGE, this.onServerMessage);
    mahjongSocket.off(SocketEvent.OPEN, this.onSocketOpen);
    mahjongSocket.off(SocketEvent.ERROR, this.onSocketError);
    mahjongSocket.off(SocketEvent.FATAL, this.onSocketFatal);
  },

  // ── 连接 ──────────────────────────────────────

  async doConnect() {
    try {
      const info = await ensureAuth();
      mahjongSocket.connect(info.sessionToken);
    } catch (e: any) {
      this.setData({
        connecting: false,
        error: `连接失败: ${e?.message ?? '未知错误'}`,
      });
    }
  },

  onSocketOpen() {
    this.setData({ connecting: false, error: '' });
  },

  // ── 创建 / 加入房间 ───────────────────────────

  /** 创建房间：发送 CREATE_ROOM，回执后跳转。 */
  onCreateRoom() {
    if (this.data.creating) return;

    this.setData({ creating: true, error: '' });
    wx.showLoading({ title: '创建中…', mask: true });

    mahjongSocket.send({
      type: 'CREATE_ROOM',
      payload: { nickname: this.data.nickname },
    } as any);
  },

  /** 输入房间码。 */
  onInputRoomCode(e: WechatMiniprogram.Input) {
    this.setData({ roomCode: e.detail.value });
  },

  /** 加入房间：发送 JOIN_ROOM。 */
  onJoinRoom() {
    const code = this.data.roomCode.trim();
    if (!code || code.length !== 6) {
      wx.showToast({ title: '请输入 6 位房间码', icon: 'none' });
      return;
    }
    if (this.data.joining) return;

    this.setData({ joining: true, error: '' });
    wx.showLoading({ title: '加入中…', mask: true });

    mahjongSocket.send({
      type: 'JOIN_ROOM',
      payload: { roomCode: code, nickname: this.data.nickname },
    } as any);
  },

  // ── 服务端消息处理 ────────────────────────────

  onServerMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'CREATE_ROOM': {
        wx.hideLoading();
        // 服务端返回 room + playerId + sessionToken
        const { room, playerId } = msg.payload as any;
        mahjongSocket.setIdentity(room.roomId, playerId);
        this.setData({ creating: false });

        wx.navigateTo({
          url: `/pages/room/room?roomCode=${room.roomCode}&playerId=${playerId}&role=host`,
        });
        break;
      }

      case 'JOIN_ROOM': {
        wx.hideLoading();
        const payload = msg.payload as any;
        const room = payload.room;
        const playerId = payload.playerId;
        mahjongSocket.setIdentity(room.roomId, playerId);
        this.setData({ joining: false });

        wx.navigateTo({
          url: `/pages/room/room?roomCode=${room.roomCode}&playerId=${playerId}&role=player`,
        });
        break;
      }

      case 'HEARTBEAT':
        break;

      default: {
        // 其他消息（如 ErrorMsg 的 type 可能为 CREATE_ROOM 或 JOIN_ROOM）
        const errMsg = msg as any;
        if (errMsg.error) {
          wx.hideLoading();
          this.setData({ creating: false, joining: false });
          wx.showToast({ title: errMsg.error.msg ?? '操作失败', icon: 'none' });
          this.setData({ error: errMsg.error.msg ?? '' });
        }
        break;
      }
    }
  },

  // ── 错误处理 ──────────────────────────────────

  onSocketError(err: SocketError) {
    console.warn('[lobby] socket error:', err.source, err.message);
    if (err.source === 'connect') {
      this.setData({ connecting: true, error: err.message });
    }
  },

  onSocketFatal(err: SocketError) {
    this.setData({ connecting: false, error: err.message });
    wx.showModal({
      title: '连接失败',
      content: err.message,
      showCancel: false,
      success: () => wx.navigateBack(),
    });
  },
});

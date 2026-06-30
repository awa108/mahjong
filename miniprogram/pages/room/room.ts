/**
 * room 房间页 — 展示 4 个座位、玩家昵称、准备状态、开始按钮。
 *
 * 设计原则：
 * - 所有状态来自服务端广播（JOIN_ROOM / READY / START_GAME），不做假状态。
 * - 准备/取消由服务端决定，不本地乐观更新。
 * - 房主按钮（开始）仅在 4 人全准备 + 自己是房主时可用。
 * - 断线提示、重连状态透明展示。
 */
import { mahjongSocket, SocketEvent, type SocketError } from '../../services/socket';
import type { ServerMessage, Room, Player } from '@mahjong/shared';

Page({
  data: {
    /** 房间码（6 位）。 */
    roomCode: '',
    /** 本家 playerId。 */
    myPlayerId: '',
    /** 是否房主。 */
    isHost: false,
    /** 玩家列表（最多 4 个座位，含空位）。 */
    players: [] as {
      seat: number;
      playerId: string;
      nickname: string;
      online: boolean;
      ready: boolean;
      score: number;
      empty: boolean;
    }[],
    /** 本家是否已准备。 */
    myReady: false,
    /** 当前已就绪玩家数。 */
    readyCount: 0,
    /** 总玩家数。 */
    playerCount: 0,
    /** 是否可以开始（4 人全准备 + 是本家是房主）。 */
    canStart: false,
    /** 是否正在开始游戏。 */
    starting: false,
    /** 错误提示。 */
    error: '',
    /** 连接是否断开 */
    disconnected: false,
  },

  // ── 生命周期 ──────────────────────────────────

  onLoad(query: Record<string, string>) {
    const roomCode = query.roomCode ?? '';
    const playerId = query.playerId ?? '';
    const role = query.role ?? 'player';

    this.setData({
      roomCode,
      myPlayerId: playerId,
      isHost: role === 'host',
    });

    // 初始化空座位
    this.initEmptySeats();

    // 监听消息
    mahjongSocket.on(SocketEvent.MESSAGE, this.onServerMessage);
    mahjongSocket.on(SocketEvent.ERROR, this.onSocketError);
    mahjongSocket.on(SocketEvent.FATAL, this.onSocketFatal);
    mahjongSocket.on(SocketEvent.OPEN, this.onReconnected);
  },

  onUnload() {
    mahjongSocket.off(SocketEvent.MESSAGE, this.onServerMessage);
    mahjongSocket.off(SocketEvent.ERROR, this.onSocketError);
    mahjongSocket.off(SocketEvent.FATAL, this.onSocketFatal);
    mahjongSocket.off(SocketEvent.OPEN, this.onReconnected);
  },

  // ── 共享房间卡片 ──────────────────────────────

  onShareAppMessage() {
    return {
      title: `麻将房间 ${this.data.roomCode}`,
      path: `/pages/index/index`,
    };
  },

  // ── 空座位初始化 ──────────────────────────────

  initEmptySeats() {
    const seats: this['data']['players'] = [];
    for (let i = 0; i < 4; i++) {
      seats.push({
        seat: i,
        playerId: '',
        nickname: '',
        online: false,
        ready: false,
        score: 0,
        empty: true,
      });
    }
    this.setData({ players: seats });
  },

  // ── 消息路由 ──────────────────────────────────

  /**
   * 核心消息处理。
   * JOIN_ROOM：房间更新（有人加入/广播）
   * READY：准备状态变化
   * START_GAME：对局开始 → 跳转 game 页
   */
  onServerMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'JOIN_ROOM': {
        const room = (msg.payload as any).room as Room | undefined;
        if (room) {
          this.applyRoom(room);
        }
        break;
      }

      case 'READY': {
        const payload = msg.payload as { playerId: string; ready: boolean };
        this.applyReadyChange(payload.playerId, payload.ready);
        break;
      }

      case 'START_GAME': {
        // 对局开始，跳转游戏页
        wx.hideLoading();
        this.setData({ starting: false });
        wx.redirectTo({ url: '/pages/game/game' });
        break;
      }

      case 'HEARTBEAT':
        break;

      default: {
        // Error 消息处理
        const errMsg = msg as any;
        if (errMsg.error) {
          wx.showToast({ title: errMsg.error.msg ?? '操作失败', icon: 'none' });
        }
        break;
      }
    }
  },

  // ── 状态更新 ──────────────────────────────────

  /** 将 Room 对象映射到页面座位列表。 */
  applyRoom(room: Room) {
    const seats = this.data.players.map((old) => ({ ...old }));

    // 先清空
    for (const s of seats) {
      s.empty = true;
      s.playerId = '';
      s.nickname = '';
      s.online = false;
      s.ready = false;
    }

    // 填入真实玩家
    let readyCount = 0;
    for (const p of room.players) {
      const seat = seats[p.seat];
      if (!seat) continue;

      seat.empty = false;
      seat.playerId = p.playerId;
      seat.nickname = p.nickname;
      seat.online = p.online;
      seat.ready = p.ready;
      seat.score = p.score;

      if (p.ready) readyCount++;

      // 本家状态
      if (p.playerId === this.data.myPlayerId) {
        this.setData({ myReady: p.ready });
      }
    }

    const playerCount = room.players.length;
    const canStart = this.data.isHost && readyCount === 4 && playerCount === 4;

    this.setData({ players: seats, readyCount, playerCount, canStart });
  },

  /** 更新单玩家准备状态。 */
  applyReadyChange(playerId: string, ready: boolean) {
    const seats = this.data.players.map((s) => ({ ...s }));
    let readyCount = 0;

    for (const s of seats) {
      if (s.playerId === playerId) {
        s.ready = ready;
      }
      if (s.ready) readyCount++;
    }

    const canStart = this.data.isHost && readyCount === 4 && this.data.playerCount === 4;

    this.setData({
      players: seats,
      readyCount,
      canStart,
      myReady: playerId === this.data.myPlayerId ? ready : this.data.myReady,
    });
  },

  // ── 用户操作 ──────────────────────────────────

  /** 准备 / 取消准备。 */
  onToggleReady() {
    mahjongSocket.send({
      type: 'READY',
      payload: {},
    } as any);
  },

  /** 房主开始游戏。 */
  onStartGame() {
    if (this.data.starting) return;
    if (!this.data.canStart) return;

    this.setData({ starting: true });
    wx.showLoading({ title: '发牌中…', mask: true });

    mahjongSocket.send({
      type: 'START_GAME',
      payload: {},
    } as any);
  },

  /** 离开房间。 */
  onLeaveRoom() {
    wx.showModal({
      title: '离开房间',
      content: '确定要离开吗？',
      success: (res) => {
        if (res.confirm) {
          mahjongSocket.clearIdentity();
          mahjongSocket.close();
          wx.navigateBack();
        }
      },
    });
  },

  // ── 错误处理 ──────────────────────────────────

  onSocketError(err: SocketError) {
    if (err.source === 'reconnect') {
      this.setData({ disconnected: true, error: err.message });
    }
  },

  onSocketFatal(err: SocketError) {
    this.setData({ disconnected: true });
    wx.showModal({
      title: '连接已断开',
      content: err.message,
      showCancel: false,
      success: () => wx.navigateBack(),
    });
  },

  /** 重连成功后刷新连接状态。 */
  onReconnected() {
    this.setData({ disconnected: false, error: '' });
  },
});

/**
 * game 对局页 — 展示牌桌、手牌、操作栏。
 *
 * 核心原则：
 * - 所有游戏状态来自服务端 PlayerViewState
 * - 操作按钮完全由 view.allowedActions 决定
 * - 不自行判断胡牌、吃碰杠合法性
 * - 其他玩家手牌仅显示扣置数量
 */
import type { PlayerViewState, ServerMessage, Tile, Seat } from '@mahjong/shared';
import { sortTiles } from '@mahjong/shared';
import { mahjongSocket, SocketEvent, type SocketError } from '../../services/socket';

interface GamePageData {
  myHand: Tile[];
  myMelds: { kind: string; tiles: Tile[]; from: number | null }[];
  players: PlayerView[];
  lastDiscard: Tile | null;
  lastDiscardBy: number | null;
  turn: number;
  mySeat: number;
  dealer: number;
  allowedActions: string[];
  wallRemaining: number;
  selectedIndex: number;
  roundNo: number;
  error: string;
  disconnected: boolean;
}

interface PlayerView {
  seat: number;
  nickname: string;
  score: number;
  online: boolean;
  melds: { kind: string; tiles: Tile[]; from: number | null }[];
  discards: Tile[];
  concealedCount: number;
}

Page<GamePageData, WechatMiniprogram.Page.CustomOption>({
  data: {
    myHand: [],
    myMelds: [],
    players: [],
    lastDiscard: null,
    lastDiscardBy: null,
    turn: 0,
    mySeat: 0,
    dealer: 0,
    allowedActions: [],
    wallRemaining: 0,
    selectedIndex: -1,
    roundNo: 0,
    error: '',
    disconnected: false,
  },

  onLoad() {
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

  // ── 消息路由 ─────────────────────────────────────

  onServerMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'START_GAME': {
        const view = (msg.payload as any).view as PlayerViewState | undefined;
        if (view) this.applyView(view);
        break;
      }
      case 'HU': {
        const p = msg.payload as any;
        wx.showToast({
          title: `玩家${this.seatLabel(p.winner)} 胡了！`,
          icon: 'none',
          duration: 3000,
        });
        if (p.hand) {
          console.log('[game] 胡牌手牌:', p.hand);
        }
        break;
      }
      case 'ROUND_END': {
        // 将结算结果写入全局数据，然后跳转结果页
        getApp<IAppOption>().globalData.roundResult = msg;
        wx.redirectTo({ url: '/pages/result/result' });
        break;
      }
      case 'HEARTBEAT':
        break;
      default: {
        const err = (msg as any).error;
        if (err) {
          wx.showToast({ title: err.msg ?? '操作失败', icon: 'none' });
        }
        break;
      }
    }
  },

  // ── 视图应用 ─────────────────────────────────────

  applyView(view: PlayerViewState) {
    const players: PlayerView[] = view.players.map((p) => ({
      seat: p.seat,
      nickname: p.nickname,
      score: p.score,
      online: p.online,
      melds: p.melds,
      discards: p.discards,
      concealedCount: p.concealedCount,
    }));

    this.setData({
      myHand: sortTiles(view.myHand),
      myMelds: view.myMelds,
      players,
      lastDiscard: view.lastDiscard,
      lastDiscardBy: view.lastDiscardBy,
      turn: view.turn,
      mySeat: view.mySeat,
      dealer: view.dealer,
      allowedActions: view.allowedActions,
      wallRemaining: view.wallRemaining,
      selectedIndex: -1,
      roundNo: view.roundNo,
      error: '',
    });
  },

  // ── 辅助 ─────────────────────────────────────────

  seatLabel(seat: Seat): string {
    return ['东', '南', '西', '北'][seat] ?? String(seat);
  },

  /** 对手面板列表（排除本家）。 */
  opponentPlayers(): PlayerView[] {
    return this.data.players.filter((p) => p.seat !== this.data.mySeat);
  },

  // ── 手牌操作 ─────────────────────────────────────

  onTileTap(e: WechatMiniprogram.TouchEvent) {
    const idx = e.currentTarget.dataset.index as number;
    const { selectedIndex, allowedActions, myHand } = this.data;

    if (!allowedActions.includes('PLAY_TILE')) return;
    if (idx < 0 || idx >= myHand.length) return;

    this.setData({ selectedIndex: idx === selectedIndex ? -1 : idx });
  },

  // ── 动作按钮 ─────────────────────────────────────

  onPlayTile() {
    const { selectedIndex, myHand, allowedActions } = this.data;
    if (!allowedActions.includes('PLAY_TILE')) return;
    if (selectedIndex < 0 || selectedIndex >= myHand.length) {
      wx.showToast({ title: '请先选择一张牌', icon: 'none' });
      return;
    }

    const tile = myHand[selectedIndex]!;
    mahjongSocket.send({
      type: 'PLAY_TILE',
      payload: { tile: { suit: tile.suit, rank: tile.rank } },
    } as any);
  },

  onChi() {
    const { lastDiscard } = this.data;
    if (!lastDiscard) return;
    mahjongSocket.send({
      type: 'CHI',
      payload: { tile: lastDiscard, chiLow: lastDiscard },
    } as any);
  },

  onPeng() {
    const { lastDiscard } = this.data;
    if (!lastDiscard) return;
    mahjongSocket.send({
      type: 'PENG',
      payload: { tile: { suit: lastDiscard.suit, rank: lastDiscard.rank } },
    } as any);
  },

  onGang() {
    const { lastDiscard } = this.data;
    mahjongSocket.send({
      type: 'GANG',
      payload: {
        tile: lastDiscard ?? { suit: 'm', rank: 1 },
        gangKind: lastDiscard ? 'ming_kong' : 'an_kong',
      },
    } as any);
  },

  onHu() {
    mahjongSocket.send({
      type: 'HU',
      payload: { source: 'discard' },
    } as any);
  },

  onPass() {
    mahjongSocket.send({ type: 'PASS', payload: {} } as any);
  },

  // ── Socket 事件 ──────────────────────────────────

  onSocketError(err: SocketError) {
    if (err.source === 'reconnect') {
      this.setData({ disconnected: true, error: err.message });
    }
    if (err.source === 'protocol' && err.code) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  onSocketFatal(err: SocketError) {
    wx.showModal({
      title: '连接已断开',
      content: err.message,
      showCancel: false,
      success: () => wx.navigateBack(),
    });
  },

  onReconnected() {
    this.setData({ disconnected: false, error: '' });
  },
});

interface IAppOption {
  globalData: {
    WS_BASE_URL: string;
    roundResult: any;
  };
}

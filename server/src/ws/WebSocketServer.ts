/**
 * WebSocketServer — 权威麻将服务端的消息路由核心。
 *
 * 架构原则：
 * - 客户端不可信：每条游戏消息都校验 playerId、roomId、turn、action 合法性。
 * - 广播裁剪：对每个玩家发送各自的 PlayerViewState，不广播完整 GameState。
 * - 速率限制：同一连接每秒消息数超过阈值则断开。
 * - 心跳保活：30 秒无心跳超时断开。
 */
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { URL } from 'node:url';
import {
  parseClientMessage, makeError, ErrorCode,
  toPlayerView,
  tile,
  type ClientMessage, type ServerMessage,
  type Room, type Seat, type Tile,
} from '@mahjong/shared';
import { roomManager } from '../room/RoomManager.js';
import { GameEngine, type TurnPhase } from '../game/GameEngine.js';
import { authService } from '../auth/AuthService.js';

// ─── 常量 ─────────────────────────────────────────

const HEARTBEAT_TIMEOUT_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const RATE_LIMIT_MAX = 30; // 每秒最多 30 条消息
const RATE_LIMIT_WINDOW_MS = 1000;

// ─── 连接状态 ─────────────────────────────────────

interface ConnState {
  playerId: string;
  roomId: string;
  ws: WebSocket;
  lastHeartbeat: number;
  alive: boolean;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

// ─── MahjongWSServer ──────────────────────────────

export class MahjongWSServer {
  private wss!: WebSocketServer;
  /** ws → ConnState */
  private conns = new Map<WebSocket, ConnState>();
  /** roomId → GameEngine */
  private engines = new Map<string, GameEngine>();
  /** ws → 速率桶 */
  private rates = new Map<WebSocket, RateBucket>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // ── 启动 ───────────────────────────────────────

  constructor(wss?: WebSocketServer) {
    if (wss) {
      this.init(wss);
    }
  }

  /** 将已有的 WebSocketServer 绑定到 MahjongWSServer。 */
  init(wss: WebSocketServer): void {
    this.wss = wss;

    this.wss.on('connection', (ws, req: IncomingMessage) => {
      this.onConnection(ws, req);
    });

    // 定时心跳检查
    this.heartbeatTimer = setInterval(() => this.checkHeartbeats(), HEARTBEAT_INTERVAL_MS);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  /** 创建独立的 WebSocketServer（独立端口，测试用）。 */
  listen(port: number): WebSocketServer {
    const wss = new WebSocketServer({ port });
    this.init(wss);
    return this.wss;
  }

  close(cb?: () => void): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.wss.close(cb);
  }

  // ── 测试用 ─────────────────────────────────────

  /** 测试辅助：清空所有内部状态。 */
  async _reset(): Promise<void> {
    this.conns.clear();
    this.engines.clear();
    this.rates.clear();
    await roomManager._reset();
    authService._reset();
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    this.rates.set(ws, { count: 0, resetAt: Date.now() + RATE_LIMIT_WINDOW_MS });

    // 从 URL query 提取并校验 sessionToken
    let authenticatedPlayerId: string | null = null;
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const token = url.searchParams.get('token') ?? '';
      authenticatedPlayerId = authService.verifyToken(token);
    } catch {
      // 解析失败，保持未认证状态
    }

    // 预绑定 playerId（已认证的）
    if (authenticatedPlayerId) {
      const profile = authService.getProfile(authenticatedPlayerId);
      (ws as any).__authPlayerId = authenticatedPlayerId;
      (ws as any).__authNickname = profile?.nickname ?? '';
      (ws as any).__authAvatarUrl = profile?.avatarUrl ?? '';
    }

    ws.on('message', (raw) => {
      try {
        this.onMessage(ws, raw.toString());
      } catch {
        this.sendTo(ws, { type: 'HEARTBEAT', requestId: '', serverTime: Date.now(), error: { code: ErrorCode.INTERNAL, msg: 'server error' } } as ServerMessage);
      }
    });

    ws.on('close', () => {
      this.onDisconnect(ws);
    });

    ws.on('error', () => {
      // 忽略传输层错误，close 事件随后触发
    });
  }

  // ── 消息路由 ───────────────────────────────────

  private onMessage(ws: WebSocket, raw: string): void {
    // 速率检查
    if (!this.checkRate(ws)) return;

    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      this.sendTo(ws, {
        type: 'HEARTBEAT', requestId: '', serverTime: Date.now(),
        error: { code: ErrorCode.INVALID_MESSAGE, msg: parsed.error },
      } as ServerMessage);
      return;
    }

    const msg = parsed.value;
    switch (msg.type) {
      case 'CREATE_ROOM':   void this.handleCreateRoom(ws, msg); break;
      case 'JOIN_ROOM':     void this.handleJoinRoom(ws, msg); break;
      case 'READY':         void this.handleReady(ws, msg); break;
      case 'START_GAME':    void this.handleStartGame(ws, msg); break;
      case 'PLAY_TILE':     void this.handlePlayTile(ws, msg); break;
      case 'CHI':           void this.handleChi(ws, msg); break;
      case 'PENG':          void this.handlePeng(ws, msg); break;
      case 'GANG':          void this.handleGang(ws, msg); break;
      case 'HU':            void this.handleHu(ws, msg); break;
      case 'PASS':          void this.handlePass(ws, msg); break;
      case 'RECONNECT':     void this.handleReconnect(ws, msg); break;
      case 'HEARTBEAT':     void this.handleHeartbeat(ws, msg); break;
      case 'LOGIN':         void this.handleLogin(ws, msg); break;
      default:
        this.sendError(ws, msg.type, msg.requestId, ErrorCode.INVALID_MESSAGE, `unknown type: ${(msg as any).type}`);
    }
  }

  // ── 各消息处理器 ───────────────────────────────

  private async handleCreateRoom(ws: WebSocket, msg: ClientMessage & { type: 'CREATE_ROOM' }): Promise<void> {
    // 优先用已认证的 playerId，否则生成新的
    let playerId = (ws as any).__authPlayerId as string | undefined;
    let nickname = (ws as any).__authNickname as string | undefined;
    let avatarUrl = (ws as any).__authAvatarUrl as string | undefined;

    if (playerId) {
      nickname = msg.payload.nickname || nickname || '玩家';
    } else {
      playerId = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      nickname = msg.payload.nickname || nickname || '玩家';
      avatarUrl = '';
      authService.updateProfile(playerId, { nickname, avatarUrl });
    }

    const token = authService.signToken(playerId);
    const room = await roomManager.createRoom(playerId, nickname);

    this.conns.set(ws, {
      playerId,
      roomId: room.roomId,
      ws,
      lastHeartbeat: Date.now(),
      alive: true,
    });

    this.sendTo(ws, {
      type: 'CREATE_ROOM',
      requestId: msg.requestId,
      serverTime: Date.now(),
      payload: { room, playerId, sessionToken: token },
    });
  }

  /** 已认证连接绑定到已有 playerId（带 token 重连时使用）。 */
  private handleLogin(ws: WebSocket, msg: ClientMessage & { type: 'LOGIN' }): void {
    // 已通过 URL token 认证，回复确认
    const playerId = (ws as any).__authPlayerId as string | undefined;
    if (!playerId) {
      this.sendError(ws, msg.type, msg.requestId, ErrorCode.AUTH_FAILED, '未提供有效 session token');
      return;
    }

    const profile = authService.getProfile(playerId);
    this.sendTo(ws, {
      type: 'LOGIN',
      requestId: msg.requestId,
      serverTime: Date.now(),
      payload: {
        playerId,
        nickname: profile?.nickname ?? '',
        avatarUrl: profile?.avatarUrl ?? '',
      },
    });
  }

  private async handleJoinRoom(ws: WebSocket, msg: ClientMessage & { type: 'JOIN_ROOM' }): Promise<void> {
    let playerId = (ws as any).__authPlayerId as string | undefined;
    let nickname = (ws as any).__authNickname as string | undefined;

    if (playerId) {
      nickname = msg.payload.nickname || nickname || '玩家';
    } else {
      playerId = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      nickname = msg.payload.nickname || '玩家';
    }

    const room = await roomManager.joinRoom(msg.payload.roomCode, playerId, nickname);

    if (!room) {
      this.sendError(ws, msg.type, msg.requestId, ErrorCode.ROOM_NOT_FOUND, '房间不存在或已满');
      return;
    }

    this.conns.set(ws, {
      playerId,
      roomId: room.roomId,
      ws,
      lastHeartbeat: Date.now(),
      alive: true,
    });

    // 回复加入者
    this.sendTo(ws, {
      type: 'JOIN_ROOM',
      requestId: msg.requestId,
      serverTime: Date.now(),
      payload: { room, playerId },
    });

    // 广播房间更新给其他人
    this.broadcastToRoom(room.roomId, {
      type: 'JOIN_ROOM',
      requestId: msg.requestId,
      serverTime: Date.now(),
      payload: { room, playerId },
    }, ws);
  }

  private async handleReady(ws: WebSocket, msg: ClientMessage & { type: 'READY' }): Promise<void> {
    const conn = this.getConn(ws, msg);
    if (!conn) return;

    const room = await roomManager.setReady(conn.roomId, conn.playerId, true);
    if (!room) {
      this.sendError(ws, msg.type, msg.requestId, ErrorCode.INTERNAL, '设置准备状态失败');
      return;
    }

    // 找到刚设置的玩家状态
    const player = room.players.find((p) => p.playerId === conn.playerId);
    this.broadcastToRoom(conn.roomId, {
      type: 'READY',
      requestId: msg.requestId,
      serverTime: Date.now(),
      payload: { playerId: conn.playerId, ready: player?.ready ?? true },
      broadcast: 'all',
    });
  }

  private async handleStartGame(ws: WebSocket, msg: ClientMessage & { type: 'START_GAME' }): Promise<void> {
    const conn = this.getConn(ws, msg);
    if (!conn) return;

    const room = await roomManager.getRoom(conn.roomId);
    if (!room) {
      this.sendError(ws, msg.type, msg.requestId, ErrorCode.ROOM_NOT_FOUND, '房间不存在');
      return;
    }

    if (room.hostPlayerId !== conn.playerId) {
      this.sendError(ws, msg.type, msg.requestId, ErrorCode.ILLEGAL_ACTION, '只有房主可以开始游戏');
      return;
    }

    if (!(await roomManager.canStart(conn.roomId))) {
      this.sendError(ws, msg.type, msg.requestId, ErrorCode.ILLEGAL_ACTION, '等待所有玩家准备');
      return;
    }

    const started = await roomManager.startGame(conn.roomId);
    if (!started) {
      this.sendError(ws, msg.type, msg.requestId, ErrorCode.INTERNAL, '开始游戏失败');
      return;
    }

    const engine = new GameEngine();
    engine.initGame(room);
    this.engines.set(conn.roomId, engine);

    // 给每个玩家发送各自的 PlayerViewState
    await this.broadcastPlayerViews(conn.roomId, 'START_GAME');
  }

  private async handlePlayTile(ws: WebSocket, msg: ClientMessage & { type: 'PLAY_TILE' }): Promise<void> {
    const { conn, engine, seat } = await this.resolveGameAction(ws, msg);
    if (!conn || !engine || seat === undefined) return;

    // 客户端传 tileRef（suit+rank），构造 Tile 对象
    const discardTile = tile(msg.payload.tile.suit, msg.payload.tile.rank);

    const result = engine.playTile(conn.playerId, seat, discardTile);
    if (!result.ok) {
      this.sendError(ws, msg.type, msg.requestId, result.code, result.msg);
      return;
    }

    // 检查游戏是否已结束（流局）
    const state = engine.getState();
    if (state.phase === 'settled') {
      await roomManager.finishGame(conn.roomId);
      this.broadcastToRoom(conn.roomId, {
        type: 'ROUND_END',
        requestId: '',
        serverTime: Date.now(),
        payload: {
          reason: 'draw',
          winner: null,
          winType: null,
          from: null,
          scores: { ...state.scores },
          scoreChanges: { 0: 0, 1: 0, 2: 0, 3: 0 },
          events: engine.getEventSummary(),
        },
        broadcast: 'all',
      });
      return;
    }

    // 广播出牌
    this.broadcastToRoom(conn.roomId, {
      type: 'PLAY_TILE',
      requestId: msg.requestId,
      serverTime: Date.now(),
      payload: { seat, tile: discardTile },
      broadcast: 'others',
    }, ws);

    // 给出牌者发送确认 + 最新视图
    await this.sendPlayerView(conn.roomId, seat, 'PLAY_TILE', msg.requestId);

    // 如果进入了响应窗口，广播各玩家可操作列表
    if (engine.turnPhase === 'response') {
      await this.broadcastPlayerViews(conn.roomId, 'PLAY_TILE');
    } else {
      // 无人可响应，已自动推进
      await this.broadcastPlayerViews(conn.roomId, 'PLAY_TILE');
    }
  }

  private async handleChi(ws: WebSocket, msg: ClientMessage & { type: 'CHI' }): Promise<void> {
    const { conn, engine, seat } = await this.resolveGameAction(ws, msg);
    if (!conn || !engine || seat === undefined) return;

    const chiLow = tile(msg.payload.chiLow.suit, msg.payload.chiLow.rank);
    const result = engine.chi(conn.playerId, seat, chiLow);
    if (!result.ok) {
      this.sendError(ws, msg.type, msg.requestId, result.code, result.msg);
      return;
    }

    this.broadcastToRoom(conn.roomId, {
      type: 'CHI',
      requestId: msg.requestId,
      serverTime: Date.now(),
      payload: {
        seat,
        kind: 'chi' as const,
        from: engine.getState().hands[seat]?.melds[engine.getState().hands[seat]!.melds.length - 1]?.from ?? null,
        meld: [],
        consumed: chiLow,
      },
      broadcast: 'others',
    }, ws);

    await this.sendPlayerView(conn.roomId, seat, 'CHI', msg.requestId);
    await this.broadcastPlayerViews(conn.roomId, 'CHI');
  }

  private async handlePeng(ws: WebSocket, msg: ClientMessage & { type: 'PENG' }): Promise<void> {
    const { conn, engine, seat } = await this.resolveGameAction(ws, msg);
    if (!conn || !engine || seat === undefined) return;

    const result = engine.peng(conn.playerId, seat);
    if (!result.ok) {
      this.sendError(ws, msg.type, msg.requestId, result.code, result.msg);
      return;
    }

    const hand = engine.getState().hands[seat];
    const meld = hand?.melds[hand.melds.length - 1];

    this.broadcastToRoom(conn.roomId, {
      type: 'PENG',
      requestId: msg.requestId,
      serverTime: Date.now(),
      payload: {
        seat,
        kind: 'pong' as const,
        from: meld?.from ?? null,
        meld: meld?.tiles ?? [],
        consumed: msg.payload.tile,
      },
      broadcast: 'others',
    }, ws);

    await this.sendPlayerView(conn.roomId, seat, 'PENG', msg.requestId);
    await this.broadcastPlayerViews(conn.roomId, 'PENG');
  }

  private async handleGang(ws: WebSocket, msg: ClientMessage & { type: 'GANG' }): Promise<void> {
    const { conn, engine, seat } = await this.resolveGameAction(ws, msg);
    if (!conn || !engine || seat === undefined) return;

    const result = engine.gang(conn.playerId, seat, msg.payload.gangKind);
    if (!result.ok) {
      this.sendError(ws, msg.type, msg.requestId, result.code, result.msg);
      return;
    }

    const hand = engine.getState().hands[seat];
    const meld = hand?.melds[hand.melds.length - 1];

    this.broadcastToRoom(conn.roomId, {
      type: 'GANG',
      requestId: msg.requestId,
      serverTime: Date.now(),
      payload: {
        seat,
        kind: meld?.kind ?? 'ming_kong',
        from: meld?.from ?? null,
        meld: meld?.tiles ?? [],
        consumed: msg.payload.tile,
      },
      broadcast: 'others',
    }, ws);

    await this.sendPlayerView(conn.roomId, seat, 'GANG', msg.requestId);
    await this.broadcastPlayerViews(conn.roomId, 'GANG');
  }

  private async handleHu(ws: WebSocket, msg: ClientMessage & { type: 'HU' }): Promise<void> {
    const { conn, engine, seat } = await this.resolveGameAction(ws, msg);
    if (!conn || !engine || seat === undefined) return;

    const result = engine.hu(conn.playerId, seat);
    if (!result.ok) {
      this.sendError(ws, msg.type, msg.requestId, result.code, result.msg);
      return;
    }

    const state = engine.getState();
    const winnerHand = state.hands[seat]!;

    // 找到 HU 事件来确定 source 和 from
    const huEvent = result.events.find((e) => e.type === 'HU');
    const source = (huEvent?.data?.source as 'self' | 'discard') ?? 'discard';
    const from = huEvent?.data?.from as Seat | null ?? null;

    this.broadcastToRoom(conn.roomId, {
      type: 'HU',
      requestId: msg.requestId,
      serverTime: Date.now(),
      payload: {
        winner: seat,
        source,
        from: from ?? seat,
        hand: winnerHand.concealed,
        score: { winner: seat, source, baseScore: 1, pattern: [] },
      },
      broadcast: 'all',
    });

    // 持久化分数 + 结束游戏
    await roomManager.updateScores(conn.roomId, state.scores);

    // 计算分数变化（当前局）
    const scoreChanges: Record<number, number> = {};
    if (source === 'self') {
      scoreChanges[seat] = 3;
      for (let i = 0; i < 4; i++) {
        if (i !== seat) scoreChanges[i] = -1;
      }
    } else {
      scoreChanges[seat] = 3;
      if (from != null) scoreChanges[from] = -3;
    }

    // 广播结算消息
    this.broadcastToRoom(conn.roomId, {
      type: 'ROUND_END',
      requestId: '',
      serverTime: Date.now(),
      payload: {
        reason: 'win',
        winner: seat,
        winType: source,
        from,
        scores: { ...state.scores },
        scoreChanges,
        events: engine.getEventSummary(),
      },
      broadcast: 'all',
    });
  }

  private async handlePass(ws: WebSocket, msg: ClientMessage & { type: 'PASS' }): Promise<void> {
    const { conn, engine, seat } = await this.resolveGameAction(ws, msg);
    if (!conn || !engine || seat === undefined) return;

    const result = engine.pass(conn.playerId, seat);
    if (!result.ok) {
      this.sendError(ws, msg.type, msg.requestId, result.code, result.msg);
      return;
    }

    // 检查是否触发了流局
    const state = engine.getState();
    if (state.phase === 'settled') {
      // 流局：结算
      await roomManager.finishGame(conn.roomId);

      this.broadcastToRoom(conn.roomId, {
        type: 'ROUND_END',
        requestId: '',
        serverTime: Date.now(),
        payload: {
          reason: 'draw',
          winner: null,
          winType: null,
          from: null,
          scores: { ...state.scores },
          scoreChanges: { 0: 0, 1: 0, 2: 0, 3: 0 },
          events: engine.getEventSummary(),
        },
        broadcast: 'all',
      });
      return;
    }

    // 发送确认
    this.sendTo(ws, {
      type: 'HEARTBEAT',
      requestId: msg.requestId,
      serverTime: Date.now(),
      payload: {},
    });

    // 广播最新视图（可能已推进到下一回合）
    await this.broadcastPlayerViews(conn.roomId, 'PASS');
  }

  private async handleReconnect(ws: WebSocket, msg: ClientMessage & { type: 'RECONNECT' }): Promise<void> {
    const { roomId, playerId, sessionToken } = msg.payload;
    const uid = authService.verifyToken(sessionToken);
    if (!uid || uid !== playerId) {
      this.sendError(ws, msg.type, msg.requestId, ErrorCode.AUTH_FAILED, 'session 无效或已过期');
      return;
    }

    const room = await roomManager.getRoom(roomId);
    if (!room) {
      this.sendError(ws, msg.type, msg.requestId, ErrorCode.ROOM_NOT_FOUND, '房间不存在');
      return;
    }

    const player = room.players.find((p) => p.playerId === playerId);
    if (!player) {
      this.sendError(ws, msg.type, msg.requestId, ErrorCode.ILLEGAL_ACTION, '你不在该房间中');
      return;
    }

    // 更新在线状态
    await roomManager.setOnline(playerId, true);

    this.conns.set(ws, {
      playerId,
      roomId,
      ws,
      lastHeartbeat: Date.now(),
      alive: true,
    });

    const engine = this.engines.get(roomId);
    if (engine) {
      // 对局中：发送完整视图
      const state = engine.getState();
      const view = toPlayerView(state, player.seat, this.buildPlayerInfo(room));
      this.sendTo(ws, {
        type: 'RECONNECT',
        requestId: msg.requestId,
        serverTime: Date.now(),
        payload: { playerView: view, missedEvents: engine.events.length },
      });
    } else {
      // 等待中：简单回传
      this.sendTo(ws, {
        type: 'RECONNECT',
        requestId: msg.requestId,
        serverTime: Date.now(),
        payload: {
          playerView: {
            mySeat: player.seat,
            roundNo: 0,
            phase: room.phase,
            dealer: 0,
            turn: 0,
            allowedActions: [],
            myHand: [],
            myMelds: [],
            players: room.players.map((p) => ({
              seat: p.seat,
              nickname: p.nickname,
              score: p.score,
              online: p.online,
              melds: [],
              discards: [],
              concealedCount: 0,
            })),
            lastDiscard: null,
            lastDiscardBy: null,
            wallRemaining: 0,
            scores: {},
            eventSeq: 0,
          },
          missedEvents: 0,
        },
      });
    }
  }

  private async handleHeartbeat(ws: WebSocket, _msg: ClientMessage & { type: 'HEARTBEAT' }): Promise<void> {
    const conn = this.conns.get(ws);
    if (conn) {
      conn.lastHeartbeat = Date.now();
      conn.alive = true;
      await roomManager.setOnline(conn.playerId, true);
    }
    this.sendTo(ws, {
      type: 'HEARTBEAT',
      requestId: _msg.requestId,
      serverTime: Date.now(),
      payload: {},
    });
  }

  // ── 连接管理辅助 ───────────────────────────────

  private onDisconnect(ws: WebSocket): void {
    this.rates.delete(ws);
    const conn = this.conns.get(ws);
    if (!conn) return;

    roomManager.setOnline(conn.playerId, false).catch(() => {});

    // 通知同房间玩家
    if (conn.roomId) {
      this.broadcastToRoom(conn.roomId, {
        type: 'READY',
        requestId: '',
        serverTime: Date.now(),
        payload: { playerId: conn.playerId, ready: false },
        broadcast: 'all',
      } as ServerMessage);
    }

    this.conns.delete(ws);
  }

  /** 获取已认证的连接（匿名消息如 CREATE_ROOM/JOIN_ROOM 不走此路径）。 */
  private getConn(ws: WebSocket, msg: ClientMessage): ConnState | null {
    const conn = this.conns.get(ws);
    if (!conn) {
      this.sendError(ws, msg.type, msg.requestId, ErrorCode.AUTH_FAILED, '请先创建或加入房间');
      return null;
    }
    conn.lastHeartbeat = Date.now();
    return conn;
  }

  /** 解析游戏动作的公共上下文。 */
  private async resolveGameAction(ws: WebSocket, msg: ClientMessage): Promise<{
    conn: ConnState | null;
    engine: GameEngine | undefined;
    seat: Seat | undefined;
  }> {
    const conn = this.getConn(ws, msg);
    if (!conn) return { conn: null, engine: undefined, seat: undefined };

    const engine = this.engines.get(conn.roomId);
    if (!engine) {
      this.sendError(ws, msg.type, msg.requestId, ErrorCode.ILLEGAL_ACTION, '游戏尚未开始');
      return { conn, engine: undefined, seat: undefined };
    }

    const room = await roomManager.getRoom(conn.roomId);
    const player = room?.players.find((p) => p.playerId === conn.playerId);
    if (!player) {
      this.sendError(ws, msg.type, msg.requestId, ErrorCode.ILLEGAL_ACTION, '你不在房间中');
      return { conn, engine: undefined, seat: undefined };
    }

    // 对局已结束：拒绝所有游戏动作
    if (engine.getState().phase === 'settled') {
      this.sendError(ws, msg.type, msg.requestId, ErrorCode.ILLEGAL_ACTION, '对局已结束');
      return { conn, engine: undefined, seat: undefined };
    }

    return { conn, engine, seat: player.seat };
  }

  // ── 广播与发送 ─────────────────────────────────

  private sendTo(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private sendError(ws: WebSocket, type: string, requestId: string, code: string, msg: string): void {
    this.sendTo(ws, makeError({ type, requestId } as any, code, msg));
  }

  private broadcastToRoom(roomId: string, msg: ServerMessage, exceptWs?: WebSocket): void {
    for (const [ws, conn] of this.conns) {
      if (conn.roomId !== roomId) continue;
      if (ws === exceptWs) continue;
      if (ws.readyState !== ws.OPEN) continue;
      ws.send(JSON.stringify(msg));
    }
  }

  /** 为房间中每个玩家发送各自的 PlayerViewState。 */
  private async broadcastPlayerViews(roomId: string, replyType: string): Promise<void> {
    const engine = this.engines.get(roomId);
    if (!engine) return;

    const state = engine.getState();
    const room = await roomManager.getRoom(roomId);
    if (!room) return;

    const playerInfo = this.buildPlayerInfo(room);

    for (const [ws, conn] of this.conns) {
      if (conn.roomId !== roomId) continue;
      if (ws.readyState !== ws.OPEN) continue;

      const player = room.players.find((p) => p.playerId === conn.playerId);
      if (!player) continue;

      const view = toPlayerView(state, player.seat, playerInfo);
      this.sendTo(ws, {
        type: 'START_GAME', // Reusing GameStartedMsg envelope for state sync
        requestId: '',
        serverTime: Date.now(),
        payload: { view },
      });
    }
  }

  /** 给单个玩家发送最新视图。 */
  private async sendPlayerView(
    roomId: string,
    seat: Seat,
    replyType: string,
    requestId: string,
  ): Promise<void> {
    const engine = this.engines.get(roomId);
    if (!engine) return;

    const state = engine.getState();
    const room = await roomManager.getRoom(roomId);
    if (!room) return;

    const playerInfo = this.buildPlayerInfo(room);
    const view = toPlayerView(state, seat, playerInfo);

    for (const [ws, conn] of this.conns) {
      if (conn.roomId === roomId && conn.playerId === room.players.find((p) => p.seat === seat)?.playerId) {
        this.sendTo(ws, {
          type: 'START_GAME',
          requestId,
          serverTime: Date.now(),
          payload: { view },
        });
        return;
      }
    }
  }

  private buildPlayerInfo(room: Room): Map<Seat, { nickname: string; online: boolean; score: number }> {
    const m = new Map<Seat, { nickname: string; online: boolean; score: number }>();
    for (const p of room.players) {
      m.set(p.seat, { nickname: p.nickname, online: p.online, score: p.score });
    }
    return m;
  }

  // ── 速率限制 ───────────────────────────────────

  private checkRate(ws: WebSocket): boolean {
    const now = Date.now();
    let bucket = this.rates.get(ws);
    if (!bucket) {
      bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
      this.rates.set(ws, bucket);
    }

    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
    }

    bucket.count++;
    if (bucket.count > RATE_LIMIT_MAX) {
      this.sendTo(ws, makeError({ type: 'HEARTBEAT', requestId: '' } as any, 'RATE_LIMIT', '消息过于频繁'));
      ws.close(1008, 'rate limited');
      this.rates.delete(ws);
      return false;
    }

    return true;
  }

  // ── 心跳检查 ───────────────────────────────────

  private checkHeartbeats(): void {
    const now = Date.now();
    for (const [ws, conn] of this.conns) {
      if (now - conn.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        conn.alive = false;
        roomManager.setOnline(conn.playerId, false).catch(() => {});
        ws.close(1001, 'heartbeat timeout');
      }
    }
  }
}

// ─── 工厂函数 ────────────────────────────────────

export function createWSServer(port: number): MahjongWSServer {
  const server = new MahjongWSServer();
  server.listen(port);
  return server;
}

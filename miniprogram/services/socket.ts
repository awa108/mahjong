/**
 * socket.ts — 微信小程序 WebSocket 主连接封装。
 *
 * 设计原则：
 * - 单例：整个小程序只维护一个游戏连接。
 * - 权威服务器：前端不判断规则，只展示服务端下发的 PlayerViewState。
 * - 连接安全：token 通过 URL query 传递，不在消息体内裸传。
 * - 断线恢复：指数退避重连，最多 5 次；重连成功后发 RECONNECT。
 *
 * 用法：
 *   import { mahjongSocket, SocketEvent } from '../../services/socket';
 *
 *   // 订阅
 *   mahjongSocket.on(SocketEvent.MESSAGE, (msg) => { ... });
 *   mahjongSocket.on(SocketEvent.ERROR, (err) => { ... });
 *
 *   // 连接
 *   await mahjongSocket.connect('wss://host:8080', sessionToken);
 *
 *   // 加入房间后绑定身份（用于重连）
 *   mahjongSocket.setIdentity(roomId, playerId);
 *
 *   // 发送（自动补 requestId）
 *   mahjongSocket.send({ type: 'PLAY_TILE', payload: { tile: { suit:'m', rank:1 } } });
 */
import type { ClientMessage, ServerMessage, Tile } from '@mahjong/shared';

// ─── 类型 ─────────────────────────────────────────

/** 服务端消息处理器。 */
export type MessageHandler = (msg: ServerMessage) => void;

/** 统一错误事件载荷。 */
export interface SocketError {
  /** 错误来源 */
  source: 'connect' | 'send' | 'heartbeat' | 'reconnect' | 'close' | 'protocol';
  /** 原始错误信息 */
  message: string;
  /** 服务端返回的错误码（仅 protocol 类错误有值） */
  code?: string;
}

/** 连接状态（调试用）。 */
export type SocketState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

/** 事件类型枚举。 */
export const SocketEvent = {
  /** 收到服务端消息，data: ServerMessage */
  MESSAGE: 'message',
  /** 连接已建立（首次或重连成功），data: undefined */
  OPEN: 'open',
  /** 连接已关闭，data: { code: number; reason: string } */
  CLOSE: 'close',
  /** 统一错误事件，data: SocketError */
  ERROR: 'error',
  /** 重连次数耗尽，data: SocketError */
  FATAL: 'fatal',
  /** 连接状态变化，data: SocketState */
  STATE_CHANGE: 'state_change',
} as const;

type EventData = {
  [SocketEvent.MESSAGE]: ServerMessage;
  [SocketEvent.OPEN]: void;
  [SocketEvent.CLOSE]: { code: number; reason: string };
  [SocketEvent.ERROR]: SocketError;
  [SocketEvent.FATAL]: SocketError;
  [SocketEvent.STATE_CHANGE]: SocketState;
};

type EventHandler<E extends keyof EventData> = (data: EventData[E]) => void;

// ─── 常量 ─────────────────────────────────────────

/** 心跳间隔（毫秒）。 */
const HEARTBEAT_INTERVAL_MS = 30_000;
/** 最大重试次数。 */
const MAX_RECONNECT_ATTEMPTS = 5;
/** 重连基础延迟（毫秒）。 */
const RECONNECT_BASE_DELAY_MS = 1_000;
/** 重连最大延迟（毫秒）。 */
const RECONNECT_MAX_DELAY_MS = 30_000;

// ─── MahjongSocket ────────────────────────────────

export class MahjongSocket {
  // 连接相关
  private socket: WechatMiniprogram.SocketTask | null = null;
  private url: string = '';
  private token: string = '';
  private state: SocketState = 'idle';
  private reconnectCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // 身份（重连用）
  private roomId: string = '';
  private playerId: string = '';

  // 消息队列（连接未就绪时积压）
  private pendingQueue: ClientMessage[] = [];

  // 请求 ID 序号
  private requestSeq = 0;

  // 事件订阅者
  private listeners = new Map<string, Set<EventHandler<any>>>();

  // ── 事件订阅 ─────────────────────────────────

  /**
   * 订阅事件。
   *
   * @example
   *   socket.on(SocketEvent.MESSAGE, (msg) => {
   *     if (msg.type === 'START_GAME') this.applyView(msg.payload.view);
   *   });
   */
  on<E extends keyof EventData>(event: E, handler: EventHandler<E>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  /** 取消订阅。 */
  off<E extends keyof EventData>(event: E, handler: EventHandler<E>): void {
    this.listeners.get(event)?.delete(handler);
  }

  // ── 连接管理 ─────────────────────────────────

  /**
   * 连接到游戏服务器。
   *
   * @param url    WebSocket 基地址，如 `wss://your-server.com`
   * @param token  登录后获得的 sessionToken
   *
   * 实际连接地址为 `{url}/ws?token={token}`。
   * 如果已有连接，先关闭旧连接。
   */
  connect(url: string, token: string): void {
    this.url = url;
    this.token = token;
    this.reconnectCount = 0;
    this.doConnect();
  }

  /**
   * 绑定房间身份。加入/创建房间成功后调用，用于断线重连时发送 RECONNECT。
   *
   * @param roomId   当前房间 ID
   * @param playerId 当前玩家 ID
   */
  setIdentity(roomId: string, playerId: string): void {
    this.roomId = roomId;
    this.playerId = playerId;
  }

  /** 清除房间身份（离开房间时调用）。 */
  clearIdentity(): void {
    this.roomId = '';
    this.playerId = '';
  }

  /** 关闭连接并清理所有状态。 */
  close(): void {
    this.cancelReconnect();
    this.stopHeartbeat();
    this.state = 'closed';
    this.emit(SocketEvent.STATE_CHANGE, 'closed');
    this.socket?.close({ code: 1000, reason: 'client close' });
    this.socket = null;
  }

  // ── 发送 ─────────────────────────────────────

  /**
   * 发送一条游戏消息。自动补 `requestId`、`serverTime`。
   *
   * @param msg  不带 requestId/serverTime 的消息体
   *
   * 如果连接未打开，消息进入待发送队列，连接建立后自动发出。
   */
  send(
    msg: Omit<ClientMessage, 'requestId' | 'serverTime'> & { requestId?: never; serverTime?: never },
  ): void {
    const full: ClientMessage = {
      ...msg,
      requestId: this.nextRequestId(),
      serverTime: 0,
    } as unknown as ClientMessage;

    if (this.state === 'connected' && this.socket) {
      this.doSend(full);
    } else {
      this.pendingQueue.push(full);
    }
  }

  // ── 查询 ─────────────────────────────────────

  /** 当前连接状态。 */
  getState(): SocketState {
    return this.state;
  }

  /** 是否已连接。 */
  get isConnected(): boolean {
    return this.state === 'connected';
  }

  // ── 内部：建连 ───────────────────────────────

  private doConnect(): void {
    if (this.state === 'connecting' || this.state === 'connected') return;

    this.state = this.reconnectCount > 0 ? 'reconnecting' : 'connecting';
    this.emit(SocketEvent.STATE_CHANGE, this.state);

    const wsUrl = `${this.url}/ws?token=${encodeURIComponent(this.token)}`;
    this.socket = wx.connectSocket({
      url: wsUrl,
      success: () => { /* onOpen 回调处理 */ },
      fail: (err) => {
        this.emit(SocketEvent.ERROR, {
          source: 'connect',
          message: `wx.connectSocket 失败: ${err.errMsg}`,
        });
        this.handleConnectFail();
      },
    });

    this.socket.onOpen(() => {
      this.state = 'connected';
      this.emit(SocketEvent.STATE_CHANGE, 'connected');
      this.emit(SocketEvent.OPEN, undefined);

      // 如果是重连，先发 RECONNECT
      if (this.reconnectCount > 0 && this.roomId && this.playerId && this.token) {
        const reconnectMsg: ClientMessage = {
          type: 'RECONNECT',
          requestId: this.nextRequestId(),
          serverTime: 0,
          payload: {
            roomId: this.roomId,
            playerId: this.playerId,
            sessionToken: this.token,
          },
        } as ClientMessage;
        this.doSend(reconnectMsg);
      }

      this.reconnectCount = 0;
      this.startHeartbeat();
      this.flushQueue();
    });

    this.socket.onMessage((res) => {
      try {
        const msg = JSON.parse(res.data as string) as ServerMessage;
        this.emit(SocketEvent.MESSAGE, msg);
      } catch {
        this.emit(SocketEvent.ERROR, {
          source: 'protocol',
          message: `非法 JSON 消息: ${String(res.data).slice(0, 100)}`,
        });
      }
    });

    this.socket.onClose((res) => {
      this.stopHeartbeat();
      this.state = 'idle';
      this.emit(SocketEvent.STATE_CHANGE, 'idle');
      this.emit(SocketEvent.CLOSE, { code: res.code, reason: res.reason });
      this.socket = null;

      // 非主动关闭，尝试重连
      if (res.code !== 1000) {
        this.scheduleReconnect();
      }
    });

    this.socket.onError((err) => {
      this.emit(SocketEvent.ERROR, {
        source: 'connect',
        message: `WebSocket 传输错误: ${err.errMsg}`,
      });
    });
  }

  // ── 内部：发送 & 队列 ─────────────────────────

  private doSend(msg: ClientMessage): void {
    try {
      this.socket?.send({ data: JSON.stringify(msg) });
    } catch (e: any) {
      this.emit(SocketEvent.ERROR, {
        source: 'send',
        message: `发送失败: ${e?.message ?? String(e)}`,
      });
      // 发送失败的消息放回队列头，等待重连后重发
      this.pendingQueue.unshift(msg);
    }
  }

  /** 连接就绪后清空积压队列。非游戏动作类型的消息（HEARTBEAT/RECONNECT）不重放。 */
  private flushQueue(): void {
    const queue = this.pendingQueue;
    this.pendingQueue = [];

    for (const msg of queue) {
      // 心跳和重连消息不重放（重连已发过新的，心跳会自动重启）
      if (msg.type === 'HEARTBEAT' || msg.type === 'RECONNECT') continue;
      this.doSend(msg);
    }
  }

  // ── 内部：心跳 ───────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.state !== 'connected') return;

      this.send({
        type: 'HEARTBEAT',
        payload: {},
      } as unknown as Omit<ClientMessage, 'requestId' | 'serverTime'>);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── 内部：重连 ───────────────────────────────

  private handleConnectFail(): void {
    this.socket = null;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectCount >= MAX_RECONNECT_ATTEMPTS) {
      this.state = 'closed';
      this.emit(SocketEvent.STATE_CHANGE, 'closed');
      this.emit(SocketEvent.FATAL, {
        source: 'reconnect',
        message: `重连失败：已达最大重试次数 ${MAX_RECONNECT_ATTEMPTS}`,
      });
      return;
    }

    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectCount,
      RECONNECT_MAX_DELAY_MS,
    );

    this.reconnectCount++;
    this.emit(SocketEvent.ERROR, {
      source: 'reconnect',
      message: `将在 ${(delay / 1000).toFixed(1)}s 后重连（第 ${this.reconnectCount}/${MAX_RECONNECT_ATTEMPTS} 次）`,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectCount = 0;
  }

  // ── 内部：辅助 ───────────────────────────────

  private nextRequestId(): string {
    this.requestSeq++;
    return `req_${Date.now().toString(36)}_${this.requestSeq}_${Math.random().toString(36).slice(2, 6)}`;
  }

  private emit<E extends keyof EventData>(event: E, data: EventData[E]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const fn of handlers) {
      try {
        fn(data);
      } catch (e: any) {
        console.error(`[socket] ${event} handler error:`, e?.message ?? e);
      }
    }
  }
}

/** 全局单例。 */
export const mahjongSocket = new MahjongSocket();

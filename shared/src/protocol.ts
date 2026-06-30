/**
 * @file protocol.ts
 * WebSocket 消息协议（前后端共用）。
 * 每条客户端消息都有 requestId；每条服务端响应都有 serverTime。
 * 支持房间广播、单人私发、错误响应、断线重连。
 */
import type { ActionType, MeldKind, Player, PlayerViewState, Room, Seat, Tile } from './types.js';

export type { ActionType, MeldKind, Player, PlayerViewState, Room, Seat, Tile };

// ─── 信封 ─────────────────────────────

export interface Envelope {
  type: ActionType;
  /** 客户端请求 id，服务端响应/错误时回填 */
  requestId: string;
  /** 服务端时间戳 */
  serverTime: number;
}

// ─── 客户端消息 ────────────────────────

export interface CreateRoomMsg {
  type: 'CREATE_ROOM';
  requestId: string;
  serverTime: 0;
  payload: { nickname: string };
}

export interface JoinRoomMsg {
  type: 'JOIN_ROOM';
  requestId: string;
  serverTime: 0;
  payload: { roomCode: string; nickname: string };
}

export interface ReadyMsg {
  type: 'READY';
  requestId: string;
  serverTime: 0;
  payload: Record<string, never>;
}

export interface DrawTileMsg {
  type: 'DRAW_TILE';
  requestId: string;
  serverTime: 0;
  payload: Record<string, never>;
}

export interface PlayTileMsg {
  type: 'PLAY_TILE';
  requestId: string;
  serverTime: 0;
  payload: { tile: Tile };
}

export interface ChiMsg {
  type: 'CHI';
  requestId: string;
  serverTime: 0;
  payload: { tile: Tile; chiLow: Tile };
}

export interface PengMsg {
  type: 'PENG';
  requestId: string;
  serverTime: 0;
  payload: { tile: Tile };
}

export interface GangMsg {
  type: 'GANG';
  requestId: string;
  serverTime: 0;
  payload: { tile: Tile; gangKind: MeldKind };
}

export interface HuMsg {
  type: 'HU';
  requestId: string;
  serverTime: 0;
  payload: { source: 'self' | 'discard' };
}

export interface PassMsg {
  type: 'PASS';
  requestId: string;
  serverTime: 0;
  payload: Record<string, never>;
}

export interface ReconnectMsg {
  type: 'RECONNECT';
  requestId: string;
  serverTime: 0;
  payload: { roomId: string; playerId: string; sessionToken: string };
}

export interface LoginMsg {
  type: 'LOGIN';
  requestId: string;
  serverTime: 0;
  payload: { sessionToken: string };
}

export interface HeartbeatMsg {
  type: 'HEARTBEAT';
  requestId: string;
  serverTime: 0;
  payload: Record<string, never>;
}

export interface StartGameMsg {
  type: 'START_GAME';
  requestId: string;
  serverTime: 0;
  payload: Record<string, never>;
}

export type ClientMessage =
  | CreateRoomMsg
  | JoinRoomMsg
  | ReadyMsg
  | StartGameMsg
  | DrawTileMsg
  | PlayTileMsg
  | ChiMsg
  | PengMsg
  | GangMsg
  | HuMsg
  | PassMsg
  | ReconnectMsg
  | LoginMsg
  | HeartbeatMsg;

// ─── 服务端消息 ────────────────────────

/** 广播模式 */
export type BroadcastTarget = 'all' | 'others';

export interface RoomCreatedMsg extends Envelope {
  type: 'CREATE_ROOM';
  payload: { room: Room; playerId: string; sessionToken: string };
}

export interface RoomJoinedMsg extends Envelope {
  type: 'JOIN_ROOM';
  payload: { room: Room; playerId: string };
}

export interface ReadyChangedMsg extends Envelope {
  type: 'READY';
  payload: { playerId: string; ready: boolean };
  /** 'all'：广播给房间所有人 */
  broadcast: BroadcastTarget;
}

export interface GameStartedMsg extends Envelope {
  type: 'START_GAME';
  payload: { view: PlayerViewState };
}

export interface TileDrawnMsg extends Envelope {
  type: 'DRAW_TILE';
  payload: { seat: Seat; tile?: Tile; wallRemaining: number };
  broadcast: BroadcastTarget;
}

export interface TilePlayedMsg extends Envelope {
  type: 'PLAY_TILE';
  payload: { seat: Seat; tile: Tile };
  broadcast: BroadcastTarget;
}

export interface ActionCommittedMsg extends Envelope {
  type: 'CHI' | 'PENG' | 'GANG';
  payload: { seat: Seat; kind: MeldKind; from: Seat | null; meld: Tile[]; consumed: Tile };
  broadcast: BroadcastTarget;
}

export interface HuDeclaredMsg extends Envelope {
  type: 'HU';
  payload: {
    winner: Seat;
    source: 'self' | 'discard';
    from?: Seat;
    hand: Tile[];
    score: { winner: Seat; source: 'self' | 'discard'; baseScore: number; pattern: string[] };
  };
  broadcast: 'all';
}

export interface RoundEndMsg extends Envelope {
  type: 'ROUND_END';
  payload: {
    reason: 'win' | 'draw';
    winner: number | null;
    winType: 'self' | 'discard' | null;
    from: number | null;
    scores: Record<number, number>;
    scoreChanges: Record<number, number>;
    events: { type: string; seat: number; timestamp: number }[];
  };
  broadcast: 'all';
}

export interface ReconnectOkMsg extends Envelope {
  type: 'RECONNECT';
  payload: { playerView: PlayerViewState; missedEvents: number };
}

export interface LoginOkMsg extends Envelope {
  type: 'LOGIN';
  payload: { playerId: string; nickname: string; avatarUrl: string };
}

export interface HeartbeatAck extends Envelope {
  type: 'HEARTBEAT';
  payload: Record<string, never>;
}

export interface ErrorMsg extends Envelope {
  type: 'CREATE_ROOM' | 'JOIN_ROOM' | 'READY' | 'DRAW_TILE' | 'PLAY_TILE' | 'CHI' | 'PENG' | 'GANG' | 'HU' | 'PASS' | 'RECONNECT' | 'LOGIN' | 'HEARTBEAT' | 'ROUND_END';
  error: { code: string; msg: string };
}

export type ServerMessage =
  | RoomCreatedMsg
  | RoomJoinedMsg
  | ReadyChangedMsg
  | GameStartedMsg
  | TileDrawnMsg
  | TilePlayedMsg
  | ActionCommittedMsg
  | HuDeclaredMsg
  | RoundEndMsg
  | ReconnectOkMsg
  | LoginOkMsg
  | HeartbeatAck
  | ErrorMsg;

// ─── 错误码 ────────────────────────────

export const ErrorCode = {
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  AUTH_FAILED: 'AUTH_FAILED',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  ILLEGAL_ACTION: 'ILLEGAL_ACTION',
  ROOM_FULL: 'ROOM_FULL',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  INTERNAL: 'INTERNAL',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
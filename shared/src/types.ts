/**
 * @file types.ts
 * 跨端共享的领域类型：Tile、Player、Room、GameState、PlayerViewState、ActionType。
 * 仅类型定义 + Zod schema，不含业务逻辑。
 */
import { z } from 'zod/v4';
import { type Tile, tileSchema } from './tiles.js';

export type { Tile };

// ─── 基础 ────────────────────────────────────────────

export type Seat = 0 | 1 | 2 | 3;
export const seatSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export type RoomPhase = 'waiting' | 'dealing' | 'playing' | 'settled' | 'closed';
export const roomPhaseSchema = z.enum(['waiting', 'dealing', 'playing', 'settled', 'closed']);

export type MeldKind = 'chi' | 'pong' | 'ming_kong' | 'an_kong' | 'bu_kong';
export const meldKindSchema = z.enum(['chi', 'pong', 'ming_kong', 'an_kong', 'bu_kong']);

// ─── Player ──────────────────────────────────────────

export interface Player {
  playerId: string;
  nickname: string;
  avatar?: string;
  seat: Seat;
  ready: boolean;
  online: boolean;
  score: number;
}
export const playerSchema = z.object({
  playerId: z.string().min(1),
  nickname: z.string().min(1),
  avatar: z.string().optional(),
  seat: seatSchema,
  ready: z.boolean(),
  online: z.boolean(),
  score: z.number().int().default(0),
});

// ─── Room ────────────────────────────────────────────

export interface Room {
  roomId: string;
  roomCode: string;
  phase: RoomPhase;
  ruleset: string;
  players: Player[];
  hostPlayerId: string;
  createdAt: number;
  updatedAt: number;
}
export const roomSchema = z.object({
  roomId: z.string().min(1),
  roomCode: z.string().length(6),
  phase: roomPhaseSchema,
  ruleset: z.string().min(1),
  players: z.array(playerSchema).min(0).max(4),
  hostPlayerId: z.string().min(1),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

// ─── Meld ────────────────────────────────────────────

export interface Meld {
  kind: MeldKind;
  tiles: Tile[];
  /** 来源座位；暗杠时 null */
  from: Seat | null;
}
export const meldSchema = z.object({
  kind: meldKindSchema,
  tiles: z.array(tileSchema).min(2).max(4),
  from: seatSchema.nullable(),
});

// ─── PlayerHand (服务端内部) ─────────────────────────

export interface PlayerHand {
  seat: Seat;
  concealed: Tile[];
  melds: Meld[];
  discards: Tile[];
}

// ─── GameState (权威态) ──────────────────────────────

export interface GameState {
  roundNo: number;
  phase: RoomPhase;
  dealer: Seat;
  turn: Seat;
  /** 当前可做的动作 */
  allowedActions: ActionType[];
  hands: PlayerHand[];
  /** 牌墙（不从序列化下发，仅服务端可访问） */
  wall: Tile[];
  /** 杠后岭上牌索引偏移 */
  deadWallIndex: number;
  lastDiscard: Tile | null;
  lastDiscardBy: Seat | null;
  scores: Record<number, number>;
  eventSeq: number;
}
export const gameStateSchema = z.object({
  roundNo: z.number().int().nonnegative(),
  phase: roomPhaseSchema,
  dealer: seatSchema,
  turn: seatSchema,
  allowedActions: z.array(z.string()).default([]),
  hands: z.array(z.object({
    seat: seatSchema,
    concealed: z.array(tileSchema),
    melds: z.array(meldSchema),
    discards: z.array(tileSchema),
  })),
  wall: z.array(tileSchema),
  deadWallIndex: z.number().int().nonnegative().default(0),
  lastDiscard: tileSchema.nullable(),
  lastDiscardBy: seatSchema.nullable(),
  scores: z.record(z.string(), z.number()),
  eventSeq: z.number().int().nonnegative().default(0),
});

// ─── PlayerViewState (单玩家视图，安全裁剪) ──────────

export interface PlayerViewState {
  mySeat: Seat;
  roundNo: number;
  phase: RoomPhase;
  dealer: Seat;
  turn: Seat;
  allowedActions: ActionType[];
  /** 本家手牌 */
  myHand: Tile[];
  /** 本家副露 */
  myMelds: Meld[];
  /** 各家公开信息 */
  players: {
    seat: Seat;
    nickname: string;
    score: number;
    online: boolean;
    melds: Meld[];
    discards: Tile[];
    concealedCount: number;
  }[];
  lastDiscard: Tile | null;
  lastDiscardBy: Seat | null;
  wallRemaining: number;
  scores: Record<number, number>;
  eventSeq: number;
}
export const playerViewStateSchema = z.object({
  mySeat: seatSchema,
  roundNo: z.number().int().nonnegative(),
  phase: roomPhaseSchema,
  dealer: seatSchema,
  turn: seatSchema,
  allowedActions: z.array(z.string()),
  myHand: z.array(tileSchema),
  myMelds: z.array(meldSchema),
  players: z.array(z.object({
    seat: seatSchema,
    nickname: z.string(),
    score: z.number().int(),
    online: z.boolean(),
    melds: z.array(meldSchema),
    discards: z.array(tileSchema),
    concealedCount: z.number().int().min(0).max(14),
  })),
  lastDiscard: tileSchema.nullable(),
  lastDiscardBy: seatSchema.nullable(),
  wallRemaining: z.number().int().nonnegative(),
  scores: z.record(z.string(), z.number()),
  eventSeq: z.number().int().nonnegative(),
});

// ─── ActionType ──────────────────────────────────────

export const ActionType = {
  CREATE_ROOM: 'CREATE_ROOM',
  JOIN_ROOM: 'JOIN_ROOM',
  READY: 'READY',
  START_GAME: 'START_GAME',
  DRAW_TILE: 'DRAW_TILE',
  PLAY_TILE: 'PLAY_TILE',
  CHI: 'CHI',
  PENG: 'PENG',
  GANG: 'GANG',
  HU: 'HU',
  PASS: 'PASS',
  RECONNECT: 'RECONNECT',
  LOGIN: 'LOGIN',
  HEARTBEAT: 'HEARTBEAT',
  SYNC: 'SYNC',
  ROUND_END: 'ROUND_END',
} as const;
export type ActionType = (typeof ActionType)[keyof typeof ActionType];

// ─── 工具函数 ────────────────────────────────────────

/** 从 GameState 生成某个座位的玩家视图（隐藏其他玩家手牌）。 */
export function toPlayerView(
  state: GameState,
  seat: Seat,
  playerInfo?: Map<Seat, { nickname: string; online: boolean; score: number }>,
): PlayerViewState {
  const myHand = state.hands.find((h) => h.seat === seat);
  return {
    mySeat: seat,
    roundNo: state.roundNo,
    phase: state.phase,
    dealer: state.dealer,
    turn: state.turn,
    allowedActions: state.allowedActions,
    myHand: myHand?.concealed ?? [],
    myMelds: myHand?.melds ?? [],
    players: state.hands.map((h) => {
      const info = playerInfo?.get(h.seat);
      return {
        seat: h.seat,
        nickname: info?.nickname ?? '',
        score: info?.score ?? state.scores[h.seat] ?? 0,
        online: info?.online ?? true,
        melds: h.melds,
        discards: h.discards,
        concealedCount: h.seat === seat ? h.concealed.length : h.concealed.length,
      };
    }),
    lastDiscard: state.lastDiscard,
    lastDiscardBy: state.lastDiscardBy,
    wallRemaining: state.wall.length,
    scores: { ...state.scores },
    eventSeq: state.eventSeq,
  };
}
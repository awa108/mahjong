/**
 * IStorage — 数据持久化接口。
 *
 * 所有业务模块（RoomManager、GameEngine、WSServer）只依赖此接口，
 * 不直接访问具体数据库实现。
 *
 * 集合：
 * 1. users             — 玩家档案（nickname、avatar）
 * 2. rooms             — 房间状态（CRUD、按 code 查找）
 * 3. games             — 游戏快照（save/load for replay）
 * 4. gameEvents        — append-only 事件日志（不可变、支持回放）
 * 5. reconnectSessions — 断线重连 session
 */
import type { Room, RoomPhase } from '@mahjong/shared';

// ─── 记录类型 ──────────────────────────────────────

export interface UserRecord {
  playerId: string;
  nickname: string;
  avatarUrl: string;
  lastLoginAt: number;
}

export interface GameRecord {
  gameId: string;
  roomId: string;
  roundNo: number;
  phase: RoomPhase;
  dealer: number;
  turn: number;
  scores: Record<number, number>;
  /** JSON-serialized GameState snapshot (hands/wall hidden for security). */
  stateSnapshot: string;
  createdAt: number;
  finishedAt: number | null;
}

export interface GameEventRecord {
  eventId: string;
  gameId: string;
  seq: number;
  type: string;
  seat: number;
  timestamp: number;
  /** JSON-serialized event data. */
  data: string;
}

export interface ReconnectSession {
  sessionId: string;
  playerId: string;
  roomId: string;
  seat: number;
  token: string;
  expiresAt: number;
}

// ─── IStorage 接口 ─────────────────────────────────

export interface IStorage {
  // ── Users ────────────────────────────────────

  findUser(playerId: string): Promise<UserRecord | null>;
  saveUser(user: UserRecord): Promise<void>;
  deleteUser(playerId: string): Promise<void>;

  // ── Rooms ────────────────────────────────────

  findRoom(roomId: string): Promise<Room | null>;
  findRoomByCode(code: string): Promise<Room | null>;
  saveRoom(room: Room): Promise<void>;
  deleteRoom(roomId: string): Promise<void>;
  listActiveRooms(): Promise<Room[]>;

  // ── Games ────────────────────────────────────

  findGame(gameId: string): Promise<GameRecord | null>;
  /** 查找某房间最新一局游戏。 */
  findLatestGameByRoom(roomId: string): Promise<GameRecord | null>;
  saveGame(game: GameRecord): Promise<void>;
  deleteGame(gameId: string): Promise<void>;
  /** 列出某房间所有游戏记录（按创建时间倒序）。 */
  listGamesByRoom(roomId: string): Promise<GameRecord[]>;

  // ── GameEvents (append-only, immutable) ───────

  /** 追加一条事件（幂等：同一 eventId 不重复写入）。 */
  appendGameEvent(event: GameEventRecord): Promise<void>;
  /** 按 gameId 读取事件列表（按 seq 升序）。 */
  getGameEvents(gameId: string): Promise<GameEventRecord[]>;

  // ── ReconnectSessions ────────────────────────

  saveReconnectSession(session: ReconnectSession): Promise<void>;
  findReconnectSession(playerId: string): Promise<ReconnectSession | null>;
  deleteReconnectSession(playerId: string): Promise<void>;

  // ── 管理 ──────────────────────────────────────

  /** 清空所有数据（仅测试用）。 */
  _reset(): void;
}

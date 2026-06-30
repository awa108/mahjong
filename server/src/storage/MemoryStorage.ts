/**
 * MemoryStorage — IStorage 的内存在实现。
 *
 * - 所有数据存在 Map 中，进程重启丢失。
 * - GameEvents 按 gameId 分组，append-only 保证不可变性。
 * - 适合 MVP 开发和测试；生产环境替换为 CloudBaseStorage。
 */
import type { Room } from '@mahjong/shared';
import type {
  IStorage,
  UserRecord,
  GameRecord,
  GameEventRecord,
  ReconnectSession,
} from './types.js';

export class MemoryStorage implements IStorage {
  private users = new Map<string, UserRecord>();
  private rooms = new Map<string, Room>();
  /** roomCode → roomId 索引 */
  private codeIndex = new Map<string, string>();
  private games = new Map<string, GameRecord>();
  /** roomId → 最新 gameId */
  private latestGameIdx = new Map<string, string>();
  /** gameId → GameEventRecord[] */
  private events = new Map<string, GameEventRecord[]>();
  private reconnectSessions = new Map<string, ReconnectSession>();

  // ── Users ──────────────────────────────────────

  async findUser(playerId: string): Promise<UserRecord | null> {
    return this.users.get(playerId) ?? null;
  }

  async saveUser(user: UserRecord): Promise<void> {
    this.users.set(user.playerId, { ...user });
  }

  async deleteUser(playerId: string): Promise<void> {
    this.users.delete(playerId);
  }

  // ── Rooms ──────────────────────────────────────

  async findRoom(roomId: string): Promise<Room | null> {
    const r = this.rooms.get(roomId);
    return r ? this.cloneRoom(r) : null;
  }

  async findRoomByCode(code: string): Promise<Room | null> {
    const id = this.codeIndex.get(code);
    if (!id) return null;
    return this.findRoom(id);
  }

  async saveRoom(room: Room): Promise<void> {
    this.rooms.set(room.roomId, this.cloneRoom(room));
    this.codeIndex.set(room.roomCode, room.roomId);
  }

  async deleteRoom(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (room) {
      this.codeIndex.delete(room.roomCode);
    }
    this.rooms.delete(roomId);
    this.latestGameIdx.delete(roomId);
  }

  async listActiveRooms(): Promise<Room[]> {
    return Array.from(this.rooms.values())
      .filter((r) => r.phase !== 'closed')
      .map((r) => this.cloneRoom(r));
  }

  // ── Games ──────────────────────────────────────

  async findGame(gameId: string): Promise<GameRecord | null> {
    const g = this.games.get(gameId);
    return g ? { ...g } : null;
  }

  async findLatestGameByRoom(roomId: string): Promise<GameRecord | null> {
    const gameId = this.latestGameIdx.get(roomId);
    if (!gameId) return null;
    return this.findGame(gameId);
  }

  async saveGame(game: GameRecord): Promise<void> {
    this.games.set(game.gameId, { ...game });
    this.latestGameIdx.set(game.roomId, game.gameId);
  }

  async deleteGame(gameId: string): Promise<void> {
    this.games.delete(gameId);
    // 清理 latestGameIdx（如果被删除的游戏是最新）
    for (const [roomId, gid] of this.latestGameIdx) {
      if (gid === gameId) {
        this.latestGameIdx.delete(roomId);
        break;
      }
    }
  }

  async listGamesByRoom(roomId: string): Promise<GameRecord[]> {
    return Array.from(this.games.values())
      .filter((g) => g.roomId === roomId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((g) => ({ ...g }));
  }

  // ── GameEvents (append-only) ────────────────────

  async appendGameEvent(event: GameEventRecord): Promise<void> {
    let list = this.events.get(event.gameId);
    if (!list) {
      list = [];
      this.events.set(event.gameId, list);
    }
    // 幂等：同一 eventId 不重复写入
    const exists = list.some((e) => e.eventId === event.eventId);
    if (!exists) {
      list.push({ ...event });
    }
  }

  async getGameEvents(gameId: string): Promise<GameEventRecord[]> {
    const list = this.events.get(gameId);
    if (!list) return [];
    return list
      .slice()
      .sort((a, b) => a.seq - b.seq)
      .map((e) => ({ ...e }));
  }

  // ── ReconnectSessions ──────────────────────────

  async saveReconnectSession(session: ReconnectSession): Promise<void> {
    this.reconnectSessions.set(session.playerId, { ...session });
  }

  async findReconnectSession(playerId: string): Promise<ReconnectSession | null> {
    const s = this.reconnectSessions.get(playerId);
    if (!s) return null;
    if (Date.now() > s.expiresAt) {
      this.reconnectSessions.delete(playerId);
      return null;
    }
    return { ...s };
  }

  async deleteReconnectSession(playerId: string): Promise<void> {
    this.reconnectSessions.delete(playerId);
  }

  // ── 管理 ──────────────────────────────────────

  _reset(): void {
    this.users.clear();
    this.rooms.clear();
    this.codeIndex.clear();
    this.games.clear();
    this.latestGameIdx.clear();
    this.events.clear();
    this.reconnectSessions.clear();
  }

  // ── 内部 ──────────────────────────────────────

  private cloneRoom(room: Room): Room {
    return JSON.parse(JSON.stringify(room)) as Room;
  }
}

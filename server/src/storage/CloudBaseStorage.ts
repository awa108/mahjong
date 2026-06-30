/**
 * CloudBaseStorage — IStorage 的 CloudBase 实现（骨架）。
 *
 * 生产环境替换 MemoryStorage 为此实现。
 * CloudBase 提供：
 *   1. 云数据库（类似 MongoDB）
 *   2. 集合自动索引
 *   3. Server SDK (@cloudbase/node-sdk) 在云托管环境自动鉴权
 *
 * 当前骨架：方法签名完整，逻辑标注 CloudBase SDK 调用点。
 * 实际接入时取消注释并填入正确的集合名和 API 调用。
 */
import type { Room } from '@mahjong/shared';
import type {
  IStorage,
  UserRecord,
  GameRecord,
  GameEventRecord,
  ReconnectSession,
} from './types.js';

export class CloudBaseStorage implements IStorage {
  // CloudBase SDK 实例（接入时初始化）
  // private db: CloudBase.Database;

  constructor() {
    // TODO: 初始化 CloudBase
    // const tcb = require('@cloudbase/node-sdk');
    // const app = tcb.init({ env: process.env.TCB_ENV_ID });
    // this.db = app.database();
  }

  // ── Users ───────────────────────────────────────

  async findUser(playerId: string): Promise<UserRecord | null> {
    // TODO: this.db.collection('users').where({ playerId }).get()
    //   .then(res => res.data[0] ?? null)
    throw new Error('CloudBaseStorage.findUser not implemented');
  }

  async saveUser(user: UserRecord): Promise<void> {
    // TODO: this.db.collection('users').doc(user.playerId).set(user)
    throw new Error('CloudBaseStorage.saveUser not implemented');
  }

  async deleteUser(playerId: string): Promise<void> {
    // TODO: this.db.collection('users').doc(playerId).remove()
    throw new Error('CloudBaseStorage.deleteUser not implemented');
  }

  // ── Rooms ───────────────────────────────────────

  async findRoom(roomId: string): Promise<Room | null> {
    // TODO: this.db.collection('rooms').doc(roomId).get()
    throw new Error('CloudBaseStorage.findRoom not implemented');
  }

  async findRoomByCode(code: string): Promise<Room | null> {
    // TODO: this.db.collection('rooms').where({ roomCode: code }).get()
    throw new Error('CloudBaseStorage.findRoomByCode not implemented');
  }

  async saveRoom(room: Room): Promise<void> {
    // TODO: this.db.collection('rooms').doc(room.roomId).set(room)
    throw new Error('CloudBaseStorage.saveRoom not implemented');
  }

  async deleteRoom(roomId: string): Promise<void> {
    // TODO: this.db.collection('rooms').doc(roomId).remove()
    throw new Error('CloudBaseStorage.deleteRoom not implemented');
  }

  async listActiveRooms(): Promise<Room[]> {
    // TODO: this.db.collection('rooms')
    //   .where({ phase: this.db.command.neq('closed') })
    //   .get()
    //   .then(res => res.data)
    throw new Error('CloudBaseStorage.listActiveRooms not implemented');
  }

  // ── Games ───────────────────────────────────────

  async findGame(gameId: string): Promise<GameRecord | null> {
    // TODO: this.db.collection('games').doc(gameId).get()
    throw new Error('CloudBaseStorage.findGame not implemented');
  }

  async findLatestGameByRoom(roomId: string): Promise<GameRecord | null> {
    // TODO: this.db.collection('games')
    //   .where({ roomId })
    //   .orderBy('createdAt', 'desc')
    //   .limit(1)
    //   .get()
    //   .then(res => res.data[0] ?? null)
    throw new Error('CloudBaseStorage.findLatestGameByRoom not implemented');
  }

  async saveGame(game: GameRecord): Promise<void> {
    // TODO: this.db.collection('games').add(game)
    throw new Error('CloudBaseStorage.saveGame not implemented');
  }

  async deleteGame(gameId: string): Promise<void> {
    // TODO: this.db.collection('games').doc(gameId).remove()
    throw new Error('CloudBaseStorage.deleteGame not implemented');
  }

  async listGamesByRoom(roomId: string): Promise<GameRecord[]> {
    // TODO: this.db.collection('games')
    //   .where({ roomId })
    //   .orderBy('createdAt', 'desc')
    //   .get()
    //   .then(res => res.data)
    throw new Error('CloudBaseStorage.listGamesByRoom not implemented');
  }

  // ── GameEvents (append-only) ────────────────────

  async appendGameEvent(event: GameEventRecord): Promise<void> {
    // TODO: this.db.collection('gameEvents').add(event)
    // 幂等保护：先检查 eventId 是否已存在
    // const existing = await this.db.collection('gameEvents')
    //   .where({ eventId: event.eventId }).count();
    // if (existing.total > 0) return;
    // await this.db.collection('gameEvents').add(event);
    throw new Error('CloudBaseStorage.appendGameEvent not implemented');
  }

  async getGameEvents(gameId: string): Promise<GameEventRecord[]> {
    // TODO: this.db.collection('gameEvents')
    //   .where({ gameId })
    //   .orderBy('seq', 'asc')
    //   .get()
    //   .then(res => res.data)
    throw new Error('CloudBaseStorage.getGameEvents not implemented');
  }

  // ── ReconnectSessions ───────────────────────────

  async saveReconnectSession(session: ReconnectSession): Promise<void> {
    // TODO: this.db.collection('reconnectSessions').add(session)
    // 使用 TTL 索引自动过期（CloudBase 支持 expiresAt 字段的 TTL）
    throw new Error('CloudBaseStorage.saveReconnectSession not implemented');
  }

  async findReconnectSession(playerId: string): Promise<ReconnectSession | null> {
    // TODO: this.db.collection('reconnectSessions')
    //   .where({ playerId })
    //   .get()
    //   .then(res => res.data[0] ?? null)
    throw new Error('CloudBaseStorage.findReconnectSession not implemented');
  }

  async deleteReconnectSession(playerId: string): Promise<void> {
    // TODO: this.db.collection('reconnectSessions')
    //   .where({ playerId }).remove()
    throw new Error('CloudBaseStorage.deleteReconnectSession not implemented');
  }

  // ── 管理 ───────────────────────────────────────

  /** 清空所有数据（仅测试用）。 */
  _reset(): void {
    // CloudBase 不支持 truncate，仅测试用空实现
    throw new Error('CloudBaseStorage._reset not available (non-destructive)');
  }
}

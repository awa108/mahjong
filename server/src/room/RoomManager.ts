/**
 * RoomManager — 房间管理核心模块。
 *
 * 所有持久化通过 IStorage 接口，不直接依赖具体数据库实现。
 * 构造时注入 storage，默认使用 MemoryStorage。
 */
import type { Room, RoomPhase, Player, Seat } from '@mahjong/shared';
import type { IStorage } from '../storage/types.js';
import { MemoryStorage } from '../storage/MemoryStorage.js';
import { uid } from '../utils/id.js';

export interface PlayerView {
  room: Room;
  myPlayerId: string;
}

export class RoomManager {
  private storage: IStorage;

  constructor(storage?: IStorage) {
    this.storage = storage ?? new MemoryStorage();
  }

  /** 仅供测试：获取内部 storage 实例。 */
  _storage(): IStorage {
    return this.storage;
  }

  // ── 工厂 ─────────────────────────────────────────

  /** 创建房间，房主自动加入。 */
  async createRoom(ownerId: string, ownerNickname: string): Promise<Room> {
    const roomId = uid();
    const roomCode = await this.generateUniqueCode();
    const now = Date.now();

    const owner: Player = {
      playerId: ownerId,
      nickname: ownerNickname,
      seat: 0 as Seat,
      ready: false,
      online: true,
      score: 0,
    };

    const room: Room = {
      roomId,
      roomCode,
      phase: 'waiting',
      ruleset: 'simple4',
      players: [owner],
      hostPlayerId: ownerId,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.saveRoom(room);
    return room;
  }

  // ── 加入 / 离开 ─────────────────────────────────

  /** 通过房间码加入。满员/重复/非等待阶段返回 null。 */
  async joinRoom(roomCode: string, playerId: string, nickname: string): Promise<Room | null> {
    const room = await this.storage.findRoomByCode(roomCode);
    if (!room) return null;
    if (room.phase !== 'waiting') return null;
    if (room.players.length >= 4) return null;
    if (room.players.some((p) => p.playerId === playerId)) return null;

    const seat = room.players.length as Seat;
    const player: Player = {
      playerId,
      nickname,
      seat,
      ready: false,
      online: true,
      score: 0,
    };
    room.players.push(player);
    room.updatedAt = Date.now();

    await this.storage.saveRoom(room);
    return room;
  }

  /** 玩家离开。房主离开时转移给第一个剩余玩家。所有人都离开时删除房间。 */
  async leaveRoom(playerId: string): Promise<Room | null> {
    const room = await this.findRoomByPlayer(playerId);
    if (!room) return null;

    // 非等待阶段不允许离开
    if (room.phase !== 'waiting') return null;

    const idx = room.players.findIndex((p) => p.playerId === playerId);
    if (idx < 0) return null;

    room.players.splice(idx, 1);
    room.updatedAt = Date.now();

    if (room.players.length === 0) {
      await this.storage.deleteRoom(room.roomId);
      return null;
    }

    // 房主离开时转移
    if (room.hostPlayerId === playerId && room.players.length > 0) {
      room.hostPlayerId = room.players[0]!.playerId;
      room.players.forEach((p, i) => { p.seat = i as Seat; });
    }

    await this.storage.saveRoom(room);
    return room;
  }

  /** 标记玩家断线。 */
  async setOnline(playerId: string, online: boolean): Promise<Room | null> {
    const room = await this.findRoomByPlayer(playerId);
    if (!room) return null;
    const p = room.players.find((pl) => pl.playerId === playerId);
    if (!p) return null;
    p.online = online;
    room.updatedAt = Date.now();
    await this.storage.saveRoom(room);
    return room;
  }

  // ── 准备 / 开始 / 结束 ─────────────────────────

  /** 切换准备状态。 */
  async setReady(roomId: string, playerId: string, ready: boolean): Promise<Room | null> {
    const room = await this.storage.findRoom(roomId);
    if (!room || room.phase !== 'waiting') return null;
    const p = room.players.find((pl) => pl.playerId === playerId);
    if (!p) return null;
    p.ready = ready;
    room.updatedAt = Date.now();
    await this.storage.saveRoom(room);
    return room;
  }

  /** 所有人准备后可开始。 */
  async canStart(roomId: string): Promise<boolean> {
    const room = await this.storage.findRoom(roomId);
    if (!room) return false;
    return room.players.length === 4 && room.players.every((p) => p.ready);
  }

  /** 开始游戏（切换到 playing 阶段）。 */
  async startGame(roomId: string): Promise<Room | null> {
    const room = await this.storage.findRoom(roomId);
    if (!room || room.phase !== 'waiting') return null;
    const ready = room.players.length === 4 && room.players.every((p) => p.ready);
    if (!ready) return null;

    room.phase = 'playing';
    room.updatedAt = Date.now();
    await this.storage.saveRoom(room);
    return room;
  }

  /** 结束游戏（切换到 settled 阶段）。 */
  async finishGame(roomId: string): Promise<Room | null> {
    const room = await this.storage.findRoom(roomId);
    if (!room || room.phase !== 'playing') return null;
    room.phase = 'settled';
    room.updatedAt = Date.now();
    await this.storage.saveRoom(room);
    return room;
  }

  /** 更新房间分数（胡牌后持久化）。 */
  async updateScores(roomId: string, scores: Record<number, number>): Promise<Room | null> {
    const room = await this.storage.findRoom(roomId);
    if (!room) return null;
    for (const p of room.players) {
      p.score = scores[p.seat] ?? p.score;
    }
    room.updatedAt = Date.now();
    await this.storage.saveRoom(room);
    return room;
  }

  // ── 查询 ─────────────────────────────────────────

  async getRoom(roomId: string): Promise<Room | undefined> {
    return (await this.storage.findRoom(roomId)) ?? undefined;
  }

  async findByCode(roomCode: string): Promise<Room | undefined> {
    return (await this.storage.findRoomByCode(roomCode)) ?? undefined;
  }

  /** 获取某玩家视角的房间信息。 */
  async getPlayerView(roomId: string, playerId: string): Promise<PlayerView | null> {
    const room = await this.storage.findRoom(roomId);
    if (!room) return null;
    if (!room.players.some((p) => p.playerId === playerId)) return null;
    return { room, myPlayerId: playerId };
  }

  // ── 内部 ─────────────────────────────────────────

  private async findRoomByPlayer(playerId: string): Promise<Room | undefined> {
    // 对于 MemoryStorage：遍历所有活跃房间
    const activeRooms = await this.storage.listActiveRooms();
    return activeRooms.find((r) => r.players.some((p) => p.playerId === playerId));
  }

  private async generateUniqueCode(): Promise<string> {
    const chars = '0123456789';
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      const existing = await this.storage.findRoomByCode(code);
      if (!existing) return code;
    }
    return String(Date.now()).slice(-6);
  }

  /** 测试用：清空所有房间。 */
  async _reset(): Promise<void> {
    this.storage._reset();
  }
}

/** 单例（默认 MemoryStorage）。 */
export const roomManager = new RoomManager();

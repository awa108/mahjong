/**
 * MemoryStorage 单元测试 — 覆盖全部 5 个集合。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStorage } from '../src/storage/MemoryStorage.js';
import type { Room } from '@mahjong/shared';
import type { UserRecord, GameRecord, GameEventRecord, ReconnectSession } from '../src/storage/types.js';

let s: MemoryStorage;

beforeEach(() => {
  s = new MemoryStorage();
});

// ─── Users ──────────────────────────────────────────

describe('users', () => {
  it('saveUser and findUser', async () => {
    const u: UserRecord = { playerId: 'u1', nickname: 'Alice', avatarUrl: '', lastLoginAt: 1000 };
    await s.saveUser(u);
    const found = await s.findUser('u1');
    expect(found).toEqual(u);
  });

  it('findUser returns null for missing', async () => {
    expect(await s.findUser('no-one')).toBeNull();
  });

  it('deleteUser removes user', async () => {
    await s.saveUser({ playerId: 'u1', nickname: 'A', avatarUrl: '', lastLoginAt: 0 });
    await s.deleteUser('u1');
    expect(await s.findUser('u1')).toBeNull();
  });

  it('saveUser overwrites existing', async () => {
    await s.saveUser({ playerId: 'u1', nickname: 'A', avatarUrl: '', lastLoginAt: 0 });
    await s.saveUser({ playerId: 'u1', nickname: 'B', avatarUrl: 'x', lastLoginAt: 999 });
    const found = await s.findUser('u1');
    expect(found!.nickname).toBe('B');
    expect(found!.avatarUrl).toBe('x');
    expect(found!.lastLoginAt).toBe(999);
  });
});

// ─── Rooms ──────────────────────────────────────────

describe('rooms', () => {
  function createRoom(id: string, code: string, phase = 'waiting' as const): Room {
    return {
      roomId: id,
      roomCode: code,
      phase,
      ruleset: 'simple4',
      players: [{ playerId: 'p1', nickname: 'N1', seat: 0, ready: false, online: true, score: 0 }],
      hostPlayerId: 'p1',
      createdAt: 1000,
      updatedAt: 1000,
    };
  }

  it('saveRoom and findRoom', async () => {
    const room = createRoom('r1', '111111');
    await s.saveRoom(room);
    const found = await s.findRoom('r1');
    expect(found!.roomId).toBe('r1');
    expect(found!.roomCode).toBe('111111');
  });

  it('findRoom returns null for missing', async () => {
    expect(await s.findRoom('bad')).toBeNull();
  });

  it('findRoomByCode', async () => {
    await s.saveRoom(createRoom('r1', '123456'));
    const found = await s.findRoomByCode('123456');
    expect(found!.roomId).toBe('r1');
  });

  it('findRoomByCode returns null for unknown code', async () => {
    expect(await s.findRoomByCode('000000')).toBeNull();
  });

  it('saveRoom is idempotent (updates existing)', async () => {
    await s.saveRoom(createRoom('r1', 'aaaaaa'));
    await s.saveRoom(createRoom('r1', 'bbbbbb'));
    const found = await s.findRoom('r1');
    expect(found!.roomCode).toBe('bbbbbb');
    // Both codes resolve (saveRoom updates but doesn't clear old code index entries)
    expect(await s.findRoomByCode('aaaaaa')).not.toBeNull();
    expect(await s.findRoomByCode('bbbbbb')).not.toBeNull();
  });

  it('deleteRoom removes room and code index', async () => {
    await s.saveRoom(createRoom('r1', '999999'));
    await s.deleteRoom('r1');
    expect(await s.findRoom('r1')).toBeNull();
    expect(await s.findRoomByCode('999999')).toBeNull();
  });

  it('deleteRoom is idempotent', async () => {
    await expect(s.deleteRoom('nope')).resolves.toBeUndefined();
  });

  it('listActiveRooms filters out closed rooms', async () => {
    await s.saveRoom(createRoom('r1', '111111', 'waiting'));
    await s.saveRoom(createRoom('r2', '222222', 'playing'));
    await s.saveRoom(createRoom('r3', '333333', 'settled'));
    // manually mark as closed — room.phase = 'closed'
    const closedRoom = createRoom('r4', '444444', 'closed' as any);
    await s.saveRoom(closedRoom);

    const active = await s.listActiveRooms();
    expect(active).toHaveLength(3);
    expect(active.map((r) => r.roomId).sort()).toEqual(['r1', 'r2', 'r3']);
  });

  it('returns safe clones (mutating result does not affect store)', async () => {
    const room = createRoom('r1', '111111');
    await s.saveRoom(room);
    const found = await s.findRoom('r1');
    found!.phase = 'playing' as any;
    const again = await s.findRoom('r1');
    expect(again!.phase).toBe('waiting');
  });
});

// ─── Games ──────────────────────────────────────────

describe('games', () => {
  function createGame(gameId: string, roomId: string, createdAt: number): GameRecord {
    return {
      gameId,
      roomId,
      roundNo: 1,
      phase: 'playing',
      dealer: 0,
      turn: 0,
      scores: { 0: 0, 1: 0, 2: 0, 3: 0 },
      stateSnapshot: '{}',
      createdAt,
      finishedAt: null,
    };
  }

  it('saveGame and findGame', async () => {
    const g = createGame('g1', 'r1', 1000);
    await s.saveGame(g);
    const found = await s.findGame('g1');
    expect(found!.gameId).toBe('g1');
    expect(found!.roomId).toBe('r1');
  });

  it('findGame returns null for missing', async () => {
    expect(await s.findGame('bad')).toBeNull();
  });

  it('findLatestGameByRoom', async () => {
    await s.saveGame(createGame('g1', 'r1', 1000));
    await s.saveGame(createGame('g2', 'r1', 2000));
    const latest = await s.findLatestGameByRoom('r1');
    expect(latest!.gameId).toBe('g2');
  });

  it('findLatestGameByRoom returns null if none', async () => {
    expect(await s.findLatestGameByRoom('r99')).toBeNull();
  });

  it('deleteGame removes game and latest index', async () => {
    await s.saveGame(createGame('g1', 'r1', 1000));
    await s.deleteGame('g1');
    expect(await s.findGame('g1')).toBeNull();
    expect(await s.findLatestGameByRoom('r1')).toBeNull();
  });

  it('listGamesByRoom returns sorted by createdAt desc', async () => {
    await s.saveGame(createGame('g1', 'r1', 1000));
    await s.saveGame(createGame('g2', 'r1', 3000));
    await s.saveGame(createGame('g3', 'r1', 2000));
    const list = await s.listGamesByRoom('r1');
    expect(list).toHaveLength(3);
    expect(list.map((g) => g.gameId)).toEqual(['g2', 'g3', 'g1']);
  });

  it('listGamesByRoom filters by roomId', async () => {
    await s.saveGame(createGame('g1', 'r1', 1000));
    await s.saveGame(createGame('g2', 'r2', 2000));
    expect(await s.listGamesByRoom('r1')).toHaveLength(1);
    expect(await s.listGamesByRoom('r2')).toHaveLength(1);
  });
});

// ─── GameEvents ─────────────────────────────────────

describe('gameEvents', () => {
  function mkEvent(eventId: string, gameId: string, seq: number, type = 'DEAL'): GameEventRecord {
    return { eventId, gameId, seq, type, seat: 0, timestamp: 1000, data: '{}' };
  }

  it('appendGameEvent stores and retrieves in seq order', async () => {
    await s.appendGameEvent(mkEvent('e2', 'g1', 2));
    await s.appendGameEvent(mkEvent('e1', 'g1', 1));
    await s.appendGameEvent(mkEvent('e3', 'g1', 3));

    const events = await s.getGameEvents('g1');
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.eventId)).toEqual(['e1', 'e2', 'e3']);
  });

  it('getGameEvents returns empty for unknown game', async () => {
    expect(await s.getGameEvents('no-such-game')).toEqual([]);
  });

  it('appendGameEvent is idempotent by eventId', async () => {
    const e = mkEvent('e1', 'g1', 1);
    await s.appendGameEvent(e);
    await s.appendGameEvent(e);
    expect(await s.getGameEvents('g1')).toHaveLength(1);
  });

  it('events are scoped by gameId', async () => {
    await s.appendGameEvent(mkEvent('e1', 'g1', 1));
    await s.appendGameEvent(mkEvent('e2', 'g2', 1));
    expect(await s.getGameEvents('g1')).toHaveLength(1);
    expect(await s.getGameEvents('g2')).toHaveLength(1);
  });
});

// ─── ReconnectSessions ──────────────────────────────

describe('reconnectSessions', () => {
  function mkSession(playerId: string, expiresAt: number): ReconnectSession {
    return { sessionId: 's1', playerId, roomId: 'r1', seat: 0, token: 'tok', expiresAt };
  }

  it('saveReconnectSession and findReconnectSession', async () => {
    const session = mkSession('p1', Date.now() + 60_000);
    await s.saveReconnectSession(session);
    const found = await s.findReconnectSession('p1');
    expect(found!.playerId).toBe('p1');
    expect(found!.roomId).toBe('r1');
  });

  it('findReconnectSession returns null for missing', async () => {
    expect(await s.findReconnectSession('nope')).toBeNull();
  });

  it('findReconnectSession returns null and removes expired', async () => {
    await s.saveReconnectSession(mkSession('p1', Date.now() - 1000));
    const found = await s.findReconnectSession('p1');
    expect(found).toBeNull();
    // Double-check it was removed
    expect(await s.findReconnectSession('p1')).toBeNull();
  });

  it('deleteReconnectSession clears session', async () => {
    await s.saveReconnectSession(mkSession('p1', Date.now() + 99_999));
    await s.deleteReconnectSession('p1');
    expect(await s.findReconnectSession('p1')).toBeNull();
  });

  it('deleteReconnectSession is idempotent', async () => {
    await expect(s.deleteReconnectSession('no-one')).resolves.toBeUndefined();
  });
});

// ─── _reset ──────────────────────────────────────────

describe('_reset', () => {
  it('clears all data', async () => {
    await s.saveUser({ playerId: 'u1', nickname: 'A', avatarUrl: '', lastLoginAt: 0 });
    await s.saveRoom({
      roomId: 'r1', roomCode: '111111', phase: 'waiting', ruleset: 'simple4',
      players: [], hostPlayerId: '', createdAt: 0, updatedAt: 0,
    });
    await s.saveGame({ gameId: 'g1', roomId: 'r1', roundNo: 1, phase: 'playing', dealer: 0, turn: 0, scores: {}, stateSnapshot: '{}', createdAt: 0, finishedAt: null });
    await s.appendGameEvent({ eventId: 'e1', gameId: 'g1', seq: 1, type: 'DEAL', seat: 0, timestamp: 0, data: '{}' });
    await s.saveReconnectSession({ sessionId: 's1', playerId: 'p1', roomId: 'r1', seat: 0, token: 't', expiresAt: 99999 });

    s._reset();

    expect(await s.findUser('u1')).toBeNull();
    expect(await s.findRoom('r1')).toBeNull();
    expect(await s.findGame('g1')).toBeNull();
    expect(await s.getGameEvents('g1')).toEqual([]);
    expect(await s.findReconnectSession('p1')).toBeNull();
  });
});

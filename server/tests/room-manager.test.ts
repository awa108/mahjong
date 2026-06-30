import { describe, it, expect, beforeEach } from 'vitest';
import { RoomManager } from '../src/room/RoomManager.js';

let rm: RoomManager;

beforeEach(() => {
  rm = new RoomManager();
});

// ─── createRoom ─────────────────────────────────────

describe('createRoom', () => {
  it('creates a room with WAITING phase', async () => {
    const room = await rm.createRoom('u1', 'Alice');
    expect(room.phase).toBe('waiting');
    expect(room.hostPlayerId).toBe('u1');
    expect(room.players).toHaveLength(1);
    expect(room.players[0]!.nickname).toBe('Alice');
    expect(room.players[0]!.seat).toBe(0);
    expect(room.players[0]!.ready).toBe(false);
    expect(room.players[0]!.online).toBe(true);
  });

  it('generates a 6-digit numeric room code', async () => {
    const room = await rm.createRoom('u1', 'Alice');
    expect(room.roomCode).toHaveLength(6);
    expect(/^\d{6}$/.test(room.roomCode)).toBe(true);
  });

  it('generates unique room codes', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) {
      codes.add((await rm.createRoom(`u${i}`, `Player${i}`)).roomCode);
    }
    expect(codes.size).toBe(50);
  });

  it('returns a different roomId each time', async () => {
    const r1 = await rm.createRoom('u1', 'A');
    const r2 = await rm.createRoom('u2', 'B');
    expect(r1.roomId).not.toBe(r2.roomId);
  });
});

// ─── joinRoom ───────────────────────────────────────

describe('joinRoom', () => {
  it('second player joins successfully', async () => {
    const room = await rm.createRoom('u1', 'Alice');
    const updated = await rm.joinRoom(room.roomCode, 'u2', 'Bob');
    expect(updated).not.toBeNull();
    expect(updated!.players).toHaveLength(2);
    expect(updated!.players[1]!.nickname).toBe('Bob');
    expect(updated!.players[1]!.seat).toBe(1);
  });

  it('fills up to 4 players', async () => {
    const room = await rm.createRoom('u1', 'P1');
    await rm.joinRoom(room.roomCode, 'u2', 'P2');
    await rm.joinRoom(room.roomCode, 'u3', 'P3');
    const updated = await rm.joinRoom(room.roomCode, 'u4', 'P4');
    expect(updated!.players).toHaveLength(4);
  });

  it('rejects 5th player', async () => {
    const room = await rm.createRoom('u1', 'P1');
    await rm.joinRoom(room.roomCode, 'u2', 'P2');
    await rm.joinRoom(room.roomCode, 'u3', 'P3');
    await rm.joinRoom(room.roomCode, 'u4', 'P4');
    const result = await rm.joinRoom(room.roomCode, 'u5', 'P5');
    expect(result).toBeNull();
  });

  it('rejects duplicate playerId', async () => {
    const room = await rm.createRoom('u1', 'Alice');
    const result = await rm.joinRoom(room.roomCode, 'u1', 'AliceAgain');
    expect(result).toBeNull();
  });

  it('rejects join when room is in PLAYING phase', async () => {
    const room = await rm.createRoom('u1', 'P1');
    await rm.joinRoom(room.roomCode, 'u2', 'P2');
    await rm.joinRoom(room.roomCode, 'u3', 'P3');
    await rm.joinRoom(room.roomCode, 'u4', 'P4');
    await rm.setReady(room.roomId, 'u1', true);
    await rm.setReady(room.roomId, 'u2', true);
    await rm.setReady(room.roomId, 'u3', true);
    await rm.setReady(room.roomId, 'u4', true);
    await rm.startGame(room.roomId);
    expect(await rm.joinRoom(room.roomCode, 'u6', 'P6')).toBeNull();
  });

  it('rejects join with non-existent room code', async () => {
    expect(await rm.joinRoom('999999', 'u1', 'Alice')).toBeNull();
  });
});

// ─── leaveRoom ──────────────────────────────────────

describe('leaveRoom', () => {
  it('player leaves, room remains with fewer players', async () => {
    const room = await rm.createRoom('u1', 'Alice');
    await rm.joinRoom(room.roomCode, 'u2', 'Bob');
    const updated = await rm.leaveRoom('u2');
    expect(updated).not.toBeNull();
    expect(updated!.players).toHaveLength(1);
    expect(updated!.players[0]!.nickname).toBe('Alice');
  });

  it('last player leaves, room is deleted', async () => {
    const room = await rm.createRoom('u1', 'Alice');
    const result = await rm.leaveRoom('u1');
    expect(result).toBeNull();
    expect(await rm.getRoom(room.roomId)).toBeUndefined();
  });

  it('host leaves, ownership transfers to next player', async () => {
    const room = await rm.createRoom('u1', 'Host');
    await rm.joinRoom(room.roomCode, 'u2', 'Player2');
    await rm.joinRoom(room.roomCode, 'u3', 'Player3');

    const updated = await rm.leaveRoom('u1');
    expect(updated!.hostPlayerId).toBe('u2');
    expect(updated!.players).toHaveLength(2);
    expect(updated!.players[0]!.seat).toBe(0);
    expect(updated!.players[1]!.seat).toBe(1);
  });

  it('non-existent player leave returns null', async () => {
    const room = await rm.createRoom('u1', 'Alice');
    expect(await rm.leaveRoom('u999')).toBeNull();
  });

  it('cannot leave during PLAYING phase', async () => {
    const room = await rm.createRoom('u1', 'P1');
    await rm.joinRoom(room.roomCode, 'u2', 'P2');
    await rm.joinRoom(room.roomCode, 'u3', 'P3');
    await rm.joinRoom(room.roomCode, 'u4', 'P4');
    for (const p of ['u1', 'u2', 'u3', 'u4']) await rm.setReady(room.roomId, p, true);
    await rm.startGame(room.roomId);

    expect(await rm.leaveRoom('u1')).toBeNull();
  });
});

// ─── setReady ───────────────────────────────────────

describe('setReady', () => {
  it('toggles ready state', async () => {
    const room = await rm.createRoom('u1', 'Alice');
    expect(room.players[0]!.ready).toBe(false);

    const r1 = await rm.setReady(room.roomId, 'u1', true);
    expect(r1!.players[0]!.ready).toBe(true);

    const r2 = await rm.setReady(room.roomId, 'u1', false);
    expect(r2!.players[0]!.ready).toBe(false);
  });

  it('canStart returns false after a player toggles ready off', async () => {
    const room = await rm.createRoom('u1', 'P1');
    await rm.joinRoom(room.roomCode, 'u2', 'P2');
    await rm.joinRoom(room.roomCode, 'u3', 'P3');
    await rm.joinRoom(room.roomCode, 'u4', 'P4');

    // All 4 players ready
    for (const p of ['u1', 'u2', 'u3', 'u4']) await rm.setReady(room.roomId, p, true);
    expect(await rm.canStart(room.roomId)).toBe(true);

    // One player toggles ready off
    await rm.setReady(room.roomId, 'u2', false);
    expect(await rm.canStart(room.roomId)).toBe(false);
  });

  it('only affects the specified player', async () => {
    const room = await rm.createRoom('u1', 'Alice');
    await rm.joinRoom(room.roomCode, 'u2', 'Bob');

    const updated = await rm.setReady(room.roomId, 'u1', true);
    expect(updated!.players[0]!.ready).toBe(true);
    expect(updated!.players[1]!.ready).toBe(false);
  });

  it('returns null for non-existent player', async () => {
    const room = await rm.createRoom('u1', 'Alice');
    expect(await rm.setReady(room.roomId, 'u999', true)).toBeNull();
  });

  it('returns null for non-existent room', async () => {
    expect(await rm.setReady('bad-id', 'u1', true)).toBeNull();
  });
});

// ─── startGame / finishGame ─────────────────────────

describe('game lifecycle', () => {
  async function fillAndReady(rm: RoomManager) {
    const room = await rm.createRoom('u1', 'P1');
    await rm.joinRoom(room.roomCode, 'u2', 'P2');
    await rm.joinRoom(room.roomCode, 'u3', 'P3');
    await rm.joinRoom(room.roomCode, 'u4', 'P4');
    for (const p of ['u1', 'u2', 'u3', 'u4']) await rm.setReady(room.roomId, p, true);
    return room;
  }

  it('canStart returns false when not full', async () => {
    const room = await rm.createRoom('u1', 'P1');
    await rm.joinRoom(room.roomCode, 'u2', 'P2');
    for (const p of ['u1', 'u2']) await rm.setReady(room.roomId, p, true);
    expect(await rm.canStart(room.roomId)).toBe(false);
  });

  it('canStart returns false when not all ready', async () => {
    const room = await rm.createRoom('u1', 'P1');
    await rm.joinRoom(room.roomCode, 'u2', 'P2');
    await rm.joinRoom(room.roomCode, 'u3', 'P3');
    await rm.joinRoom(room.roomCode, 'u4', 'P4');
    await rm.setReady(room.roomId, 'u1', true);
    await rm.setReady(room.roomId, 'u2', true);
    await rm.setReady(room.roomId, 'u3', true);
    expect(await rm.canStart(room.roomId)).toBe(false);
  });

  it('canStart returns true when 4 players all ready', async () => {
    const room = await fillAndReady(rm);
    expect(await rm.canStart(room.roomId)).toBe(true);
  });

  it('startGame transitions to PLAYING', async () => {
    const room = await fillAndReady(rm);
    const started = await rm.startGame(room.roomId);
    expect(started!.phase).toBe('playing');
  });

  it('startGame fails if not all ready', async () => {
    const room = await rm.createRoom('u1', 'P1');
    await rm.joinRoom(room.roomCode, 'u2', 'P2');
    await rm.joinRoom(room.roomCode, 'u3', 'P3');
    await rm.joinRoom(room.roomCode, 'u4', 'P4');
    await rm.setReady(room.roomId, 'u1', true);
    expect(await rm.startGame(room.roomId)).toBeNull();
  });

  it('finishGame transitions to settled', async () => {
    const room = await fillAndReady(rm);
    await rm.startGame(room.roomId);
    const finished = await rm.finishGame(room.roomId);
    expect(finished!.phase).toBe('settled');
  });

  it('finishGame fails if not PLAYING', async () => {
    const room = await rm.createRoom('u1', 'P1');
    expect(await rm.finishGame(room.roomId)).toBeNull();
  });
});

// ─── online/offline ─────────────────────────────────

describe('online status', () => {
  it('sets player offline', async () => {
    const room = await rm.createRoom('u1', 'Alice');
    await rm.joinRoom(room.roomCode, 'u2', 'Bob');
    const updated = await rm.setOnline('u2', false);
    expect(updated!.players[1]!.online).toBe(false);
  });

  it('sets player back online', async () => {
    const room = await rm.createRoom('u1', 'Alice');
    await rm.setOnline('u1', false);
    const updated = await rm.setOnline('u1', true);
    expect(updated!.players[0]!.online).toBe(true);
  });

  it('returns null for non-existent player', async () => {
    expect(await rm.setOnline('nobody', false)).toBeNull();
  });
});

// ─── queries ────────────────────────────────────────

describe('queries', () => {
  it('getRoom returns room by id', async () => {
    const room = await rm.createRoom('u1', 'Alice');
    const found = await rm.getRoom(room.roomId);
    expect(found).toBeDefined();
    expect(found!.roomCode).toBe(room.roomCode);
  });

  it('getRoom returns undefined for unknown id', async () => {
    expect(await rm.getRoom('non-existent')).toBeUndefined();
  });

  it('findByCode returns room by code', async () => {
    const room = await rm.createRoom('u1', 'Alice');
    const found = await rm.findByCode(room.roomCode);
    expect(found).toBeDefined();
    expect(found!.roomId).toBe(room.roomId);
  });

  it('findByCode returns undefined for unknown code', async () => {
    expect(await rm.findByCode('000000')).toBeUndefined();
  });

  it('getPlayerView returns room + myPlayerId', async () => {
    const room = await rm.createRoom('u1', 'Alice');
    const view = await rm.getPlayerView(room.roomId, 'u1');
    expect(view).not.toBeNull();
    expect(view!.myPlayerId).toBe('u1');
    expect(view!.room.roomId).toBe(room.roomId);
  });

  it('getPlayerView returns null for non-member', async () => {
    const room = await rm.createRoom('u1', 'Alice');
    expect(await rm.getPlayerView(room.roomId, 'u2')).toBeNull();
  });

  it('getPlayerView returns null for bad room', async () => {
    expect(await rm.getPlayerView('bad', 'u1')).toBeNull();
  });
});

// ─── immutability ───────────────────────────────────

describe('immutability (safe clone)', () => {
  it('mutating returned room does not affect internal state', async () => {
    const room = await rm.createRoom('u1', 'Alice');
    room.phase = 'playing' as any;
    const internal = await rm.getRoom(room.roomId);
    expect(internal!.phase).toBe('waiting');
  });

  it('mutating returned player does not affect internal state', async () => {
    const room = await rm.createRoom('u1', 'Alice');
    room.players[0]!.nickname = 'Hacked';
    const internal = await rm.getRoom(room.roomId);
    expect(internal!.players[0]!.nickname).toBe('Alice');
  });
});

import { describe, it, expect } from 'vitest';
import { generateRoomCode, uid } from '../src/utils/id.js';
import { signToken, verifyToken } from '../src/auth/token.js';
import { RoomManager } from '../src/room/RoomManager.js';
import { getActiveRuleset } from '../src/game/index.js';

describe('server smoke', () => {
  it('room codes are 6 chars', () => {
    const code = generateRoomCode();
    expect(code).toHaveLength(6);
    expect(/^[A-Z0-9]+$/.test(code)).toBe(true);
    expect(code).not.toMatch(/[IO01]/);
  });

  it('token round-trip', () => {
    const tok = signToken('user-1');
    expect(verifyToken(tok)).toBe('user-1');
    expect(verifyToken('bogus')).toBeNull();
  });

  it('create room + join + ready', async () => {
    const rm = new RoomManager();
    const room = await rm.createRoom('u1', 'Alice');
    expect(room.phase).toBe('waiting');
    expect(room.players).toHaveLength(1);

    const r2 = await rm.joinRoom(room.roomCode, 'u2', 'Bob');
    expect(r2!.players).toHaveLength(2);
    const r3 = await rm.joinRoom(room.roomCode, 'u3', 'Carol');
    expect(r3!.players).toHaveLength(3);
    const r4 = await rm.joinRoom(room.roomCode, 'u4', 'Dave');
    expect(r4!.players).toHaveLength(4);

    expect(r4!.players[2]!.ready).toBe(false);
    const r5 = await rm.setReady(room.roomId, 'u3', true);
    expect(r5!.players[2]!.ready).toBe(true);

    expect(await rm.canStart(room.roomId)).toBe(false);

    for (const p of ['u1', 'u2', 'u3', 'u4']) await rm.setReady(room.roomId, p, true);
    expect(await rm.canStart(room.roomId)).toBe(true);
  });

  it('join full room returns null', async () => {
    const rm = new RoomManager();
    const room = await rm.createRoom('h1', 'Host');
    await rm.joinRoom(room.roomCode, 'p2', 'P2');
    await rm.joinRoom(room.roomCode, 'p3', 'P3');
    const r4 = await rm.joinRoom(room.roomCode, 'p4', 'P4');
    expect(r4!.players).toHaveLength(4);
    expect(await rm.joinRoom(room.roomCode, 'p5', 'P5')).toBeNull();
  });

  it('ruleset is available', () => {
    const r = getActiveRuleset();
    expect(r.name).toBe('simple4');
  });
});

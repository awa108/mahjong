/**
 * protocol / validation / PlayerViewState 测试：
 *   合法消息、非法消息、手牌隐藏、断线重连格式。
 */
import { describe, it, expect } from 'vitest';
import { parseClientMessage, assertServerMessage, makeError } from '../src/validation.js';
import { toPlayerView, ActionType } from '../src/types.js';
import { tile, sameTile } from '../src/tiles.js';
import type { GameState, PlayerViewState, Seat } from '../src/types.js';
import type { ClientMessage, ServerMessage } from '../src/protocol.js';
import { ErrorCode } from '../src/protocol.js';

// ─── 辅助: 构造最小 GameState ─────────────────────────

function makeTestState(): GameState {
  return {
    roundNo: 1,
    phase: 'playing',
    dealer: 0 as Seat,
    turn: 0 as Seat,
    allowedActions: ['PLAY_TILE' as any],
    hands: [
      {
        seat: 0 as Seat,
        concealed: [tile('m', 1), tile('m', 2), tile('m', 3), tile('m', 4),
                     tile('m', 5), tile('m', 6), tile('p', 7), tile('p', 8),
                     tile('p', 9), tile('s', 1), tile('s', 1), tile('s', 1),
                     tile('z', 7), tile('z', 7)],
        melds: [],
        discards: [tile('m', 9)],
      },
      {
        seat: 1 as Seat,
        concealed: [tile('p', 1), tile('p', 1), tile('p', 1), tile('z', 1),
                     tile('z', 1), tile('z', 1), tile('z', 2), tile('z', 2),
                     tile('z', 2), tile('m', 9), tile('m', 9), tile('m', 9),
                     tile('s', 9)],
        melds: [{ kind: 'pong', tiles: [tile('s', 5), tile('s', 5), tile('s', 5)], from: 1 as Seat }],
        discards: [tile('p', 2)],
      },
      {
        seat: 2 as Seat,
        concealed: [tile('m', 1), tile('m', 1), tile('m', 1), tile('m', 2),
                     tile('m', 2), tile('m', 2), tile('m', 3), tile('m', 3),
                     tile('m', 3), tile('m', 4), tile('m', 4), tile('m', 4),
                     tile('m', 5)],
        melds: [],
        discards: [],
      },
      {
        seat: 3 as Seat,
        concealed: [tile('z', 3), tile('z', 3), tile('z', 3), tile('z', 4),
                     tile('z', 4), tile('z', 4), tile('z', 5), tile('z', 5),
                     tile('z', 5), tile('z', 6), tile('z', 6), tile('z', 6),
                     tile('z', 7)],
        melds: [],
        discards: [tile('s', 1), tile('s', 2), tile('s', 3)],
      },
    ],
    wall: [tile('m', 6), tile('m', 7), tile('m', 8)],
    deadWallIndex: 0,
    lastDiscard: tile('m', 9),
    lastDiscardBy: 0 as Seat,
    scores: { '0': 0, '1': 0, '2': 0, '3': 0 },
    eventSeq: 42,
  };
}

// ─── PlayerViewState ─────────────────────────────────

describe('PlayerViewState (hand hiding)', () => {
  const state = makeTestState();

  it('my seat sees own hand fully', () => {
    const view = toPlayerView(state, 0);
    expect(view.mySeat).toBe(0);
    expect(view.myHand).toHaveLength(14);
    expect(sameTile(view.myHand[0]!, tile('m', 1))).toBe(true);
  });

  it('other seats hand is hidden (only melds + discards + count)', () => {
    const view = toPlayerView(state, 0);
    // 4 players in view
    expect(view.players).toHaveLength(4);

    // seat 0 is myself — concealedCount is 14
    const me = view.players.find(p => p.seat === 0)!;
    expect(me.concealedCount).toBe(14);

    // seat 1 — has meld pong, concealedCount is hand length, no raw tiles exposed
    const p1 = view.players.find(p => p.seat === 1)!;
    expect(p1.concealedCount).toBe(13);
    expect(p1.melds).toHaveLength(1);
    expect(p1.discards.length).toBe(1); expect(sameTile(p1.discards[0]!, tile('p', 2))).toBe(true);
    // no 'concealed' field on other players
    expect((p1 as any).concealed).toBeUndefined();
  });

  it('wall remaining is exposed as count only', () => {
    const view = toPlayerView(state, 0);
    expect(view.wallRemaining).toBe(3);
    // wall array should not be in view
    expect((view as any).wall).toBeUndefined();
  });

  it('eventSeq is preserved', () => {
    const view = toPlayerView(state, 2);
    expect(view.eventSeq).toBe(42);
  });

  it('scores are copied (not shared ref)', () => {
    const view = toPlayerView(state, 0);
    expect(view.scores).toEqual({ '0': 0, '1': 0, '2': 0, '3': 0 });
    view.scores['0'] = 100;
    expect(state.scores['0']).toBe(0); // original untouched
  });
});

// ─── Client message parsing ──────────────────────────

describe('parseClientMessage', () => {
  it('valid CREATE_ROOM', () => {
    const r = parseClientMessage(JSON.stringify({
      type: 'CREATE_ROOM', requestId: 'r1', serverTime: 0,
      payload: { nickname: 'Alice' },
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe('CREATE_ROOM');
      expect(r.value.payload).toEqual({ nickname: 'Alice' });
    }
  });

  it('valid RECONNECT', () => {
    const r = parseClientMessage(JSON.stringify({
      type: 'RECONNECT', requestId: 'r2', serverTime: 0,
      payload: { roomId: 'abc', playerId: 'p1', sessionToken: 'tok' },
    }));
    expect(r.ok).toBe(true);
  });

  it('valid PLAY_TILE', () => {
    const r = parseClientMessage(JSON.stringify({
      type: 'PLAY_TILE', requestId: 'r3', serverTime: 0,
      payload: { tile: { suit: 'm', rank: 1 } },
    }));
    expect(r.ok).toBe(true);
  });

  it('valid GANG (ming_kong)', () => {
    const r = parseClientMessage(JSON.stringify({
      type: 'GANG', requestId: 'r4', serverTime: 0,
      payload: { tile: { suit: 'z', rank: 1 }, gangKind: 'ming_kong' },
    }));
    expect(r.ok).toBe(true);
  });

  it('valid HU', () => {
    const r = parseClientMessage(JSON.stringify({
      type: 'HU', requestId: 'r5', serverTime: 0,
      payload: { source: 'self' },
    }));
    expect(r.ok).toBe(true);
  });

  it('valid PASS', () => {
    const r = parseClientMessage(JSON.stringify({
      type: 'PASS', requestId: 'r6', serverTime: 0,
      payload: {},
    }));
    expect(r.ok).toBe(true);
  });
});

// ─── Invalid client messages ─────────────────────────

describe('parseClientMessage — invalid', () => {
  it('rejects unknown type', () => {
    const r = parseClientMessage(JSON.stringify({
      type: 'BOGUS', requestId: 'r1', serverTime: 0, payload: {},
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('unknown message type');
  });

  it('rejects missing requestId', () => {
    const r = parseClientMessage(JSON.stringify({
      type: 'PASS', serverTime: 0, payload: {},
    }));
    expect(r.ok).toBe(false);
  });

  it('rejects malformed JSON', () => {
    const r = parseClientMessage('{not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid json');
  });

  it('rejects CREATE_ROOM with empty nickname', () => {
    const r = parseClientMessage(JSON.stringify({
      type: 'CREATE_ROOM', requestId: 'r1', serverTime: 0,
      payload: { nickname: '' },
    }));
    expect(r.ok).toBe(false);
  });

  it('rejects PLAY_TILE with invalid suit', () => {
    const r = parseClientMessage(JSON.stringify({
      type: 'PLAY_TILE', requestId: 'r2', serverTime: 0,
      payload: { tile: { suit: 'x', rank: 1 } },
    }));
    expect(r.ok).toBe(false);
  });

  it('rejects PLAY_TILE with rank 0', () => {
    const r = parseClientMessage(JSON.stringify({
      type: 'PLAY_TILE', requestId: 'r3', serverTime: 0,
      payload: { tile: { suit: 'm', rank: 0 } },
    }));
    expect(r.ok).toBe(false);
  });

  it('rejects HU with bad source', () => {
    const r = parseClientMessage(JSON.stringify({
      type: 'HU', requestId: 'r5', serverTime: 0,
      payload: { source: 'magic' },
    }));
    expect(r.ok).toBe(false);
  });

  it('rejects RECONNECT with missing fields', () => {
    const r = parseClientMessage(JSON.stringify({
      type: 'RECONNECT', requestId: 'r6', serverTime: 0,
      payload: { roomId: 'abc' },
    }));
    expect(r.ok).toBe(false);
  });

  it('rejects JOIN_ROOM with short roomCode', () => {
    const r = parseClientMessage(JSON.stringify({
      type: 'JOIN_ROOM', requestId: 'r7', serverTime: 0,
      payload: { roomCode: 'AB', nickname: 'Bob' },
    }));
    expect(r.ok).toBe(false);
  });

  it('rejects GANG with invalid gangKind', () => {
    const r = parseClientMessage(JSON.stringify({
      type: 'GANG', requestId: 'r8', serverTime: 0,
      payload: { tile: { suit: 'm', rank: 1 }, gangKind: 'super_kong' },
    }));
    expect(r.ok).toBe(false);
  });
});

// ─── Error response ──────────────────────────────────

describe('error response', () => {
  it('makeError creates a proper error message', () => {
    const err = makeError(
      { type: 'PLAY_TILE' as any, requestId: 'x1' },
      ErrorCode.NOT_YOUR_TURN,
      'not your turn',
    );
    expect(err.type).toBe('PLAY_TILE');
    expect(err.requestId).toBe('x1');
    expect(err.error).toEqual({ code: 'NOT_YOUR_TURN', msg: 'not your turn' });
    expect(err.serverTime).toBeGreaterThan(0);
  });
});

// ─── Server message assertion ────────────────────────

describe('assertServerMessage', () => {
  it('passes valid server message', () => {
    const msg = {
      type: 'HEARTBEAT',
      requestId: '',
      serverTime: Date.now(),
      payload: {},
    } as ServerMessage;
    expect(() => assertServerMessage(msg)).not.toThrow();
  });

  it('throws on missing serverTime', () => {
    const msg = { type: 'HEARTBEAT' } as any;
    expect(() => assertServerMessage(msg)).toThrow('missing serverTime');
  });
});
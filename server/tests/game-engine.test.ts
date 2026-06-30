/**
 * GameEngine 测试：模拟完整对局片段。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../src/game/GameEngine.js';
import {
  type Tile, type Seat,
  type Room,
  fullDeck, shuffleTiles, sortTiles,
  tile,
} from '@mahjong/shared';

const m = (r: number): Tile => tile('m', r as Tile['rank']);
const p = (r: number): Tile => tile('p', r as Tile['rank']);
const s = (r: number): Tile => tile('s', r as Tile['rank']);
const z = (r: number): Tile => tile('z', r as Tile['rank']);

function makeRoom(): Room {
  return {
    roomId: 'test-room',
    roomCode: '123456',
    phase: 'waiting',
    ruleset: 'simple4',
    players: [
      { playerId: 'p1', nickname: '东', seat: 0, ready: true, online: true, score: 0 },
      { playerId: 'p2', nickname: '南', seat: 1, ready: true, online: true, score: 0 },
      { playerId: 'p3', nickname: '西', seat: 2, ready: true, online: true, score: 0 },
      { playerId: 'p4', nickname: '北', seat: 3, ready: true, online: true, score: 0 },
    ],
    hostPlayerId: 'p1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** 满牌墙确保摸牌时不耗尽（测试常规流程用）。 */
const FULL_WALL = Array.from({ length: 70 }, (_, i) => m((i % 9 + 1) as Tile['rank']));

// ─── initGame ────────────────────────────────────────

describe('GameEngine initGame', () => {
  it('初始化后 dealer=0, phase=playing, turn=0', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    const state = engine.getState();
    expect(state.phase).toBe('playing');
    expect(state.dealer).toBe(0);
    expect(state.turn).toBe(0);
    expect(state.hands).toHaveLength(4);
  });

  it('庄家 14 张，其他 13 张', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    const state = engine.getState();
    expect(state.hands[0]!.concealed).toHaveLength(14);
    expect(state.hands[1]!.concealed).toHaveLength(13);
    expect(state.hands[2]!.concealed).toHaveLength(13);
    expect(state.hands[3]!.concealed).toHaveLength(13);
  });

  it('牌墙剩余 83 张', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    expect(engine.getState().wall).toHaveLength(83);
  });

  it('初始阶段是 play（庄家直接出牌）', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    expect(engine.turnPhase).toBe('play');
  });

  it('用预洗牌序初始化（可复现）', () => {
    const deck = shuffleTiles(fullDeck(), 42);
    const e1 = new GameEngine();
    e1.initGame(makeRoom(), deck);
    const e2 = new GameEngine();
    e2.initGame(makeRoom(), deck);
    const h1 = e1.getState().hands.map((h) => h.concealed.map((t) => t.id));
    const h2 = e2.getState().hands.map((h) => h.concealed.map((t) => t.id));
    expect(h1).toEqual(h2);
  });

  it('事件日志包含 DEAL 事件', () => {
    const engine = new GameEngine();
    const events = engine.initGame(makeRoom());
    expect(events[0]!.type).toBe('DEAL');
  });
});

// ─── playTile ────────────────────────────────────────

describe('playTile', () => {
  it('庄家出牌成功，切换到 response 阶段（有玩家可响应时）', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    engine._setHands([
      [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5)],
      [m(1), m(1), p(2), p(3), p(4), p(5), p(6), p(7), p(8), p(9), s(1), s(2), s(3)],
      [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4)],
      [m(9), m(8), m(7), m(6), m(5), m(4), m(3), m(2), m(1), p(9), p(8), p(7), p(6)],
    ]);
    engine._setWall(FULL_WALL);

    const result = engine.playTile('p1', 0, m(1));
    expect(result.ok).toBe(true);
    expect(engine.turnPhase).toBe('response');
    expect(engine.getState().lastDiscard).not.toBeNull();
  });

  it('出牌后无人可响应时自动推进到下一回合', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    engine._setHands([
      [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5)],
      [m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5), p(6), p(7), p(8), p(9)],
      [s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8), s(9), z(1), z(2), z(3), z(4)],
      [z(5), z(6), z(7), s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8), s(9), p(1)],
    ]);
    engine._setWall(FULL_WALL);

    const result = engine.playTile('p1', 0, m(1));
    expect(result.ok).toBe(true);
    // 无人可响应 → 直接推进到下一回合
    expect(engine.turnPhase).toBe('play');
    expect(engine.getState().turn).toBe(1);
  });

  it('非当前玩家出牌被拒绝', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    const hand1 = engine.getHand(1)!;
    const result = engine.playTile('p2', 1, hand1.concealed[0]!);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_YOUR_TURN');
  });

  it('出手牌中不存在的牌被拒绝', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    // Use _setHands to guarantee m(9) is NOT in seat 0's hand
    engine._setHands([
      [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), p(1), p(2), p(3), p(4), p(5)],
      [m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5), p(6), p(7)],
      [s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8), s(9), z(1), z(2), z(3), z(4)],
      [p(8), p(9), s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8), s(9), z(5), z(6)],
    ]);
    engine._setWall(FULL_WALL);
    const result = engine.playTile('p1', 0, m(9));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ILLEGAL_ACTION');
  });
});

// ─── response window + pass ─────────────────────────

describe('response window lifecycle', () => {
  let engine: GameEngine;

  beforeEach(() => {
    engine = new GameEngine();
    engine.initGame(makeRoom());
    engine._setHands([
      [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5)],
      [m(1), m(1), p(2), p(3), p(4), p(5), p(6), p(7), p(8), p(9), s(1), s(2), s(3)],
      [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4)],
      [m(9), m(8), m(7), m(6), m(5), m(4), m(3), m(2), m(1), p(9), p(8), p(7), p(6)],
    ]);
    engine._setWall(FULL_WALL);
  });

  it('弃牌后所有玩家 PASS，推进到下一回合', () => {
    engine.playTile('p1', 0, m(1));

    engine.pass('p2', 1);
    engine.pass('p3', 2);
    const r3 = engine.pass('p4', 3);
    expect(r3.ok).toBe(true);
    expect(engine.turnPhase).toBe('play');
    expect(engine.getState().turn).toBe(1);
  });

  it('重复 PASS 被拒绝', () => {
    engine.playTile('p1', 0, m(1));
    engine.pass('p2', 1);
    const r2 = engine.pass('p2', 1);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('ILLEGAL_ACTION');
  });

  it('获取响应窗口操作列表', () => {
    engine.playTile('p1', 0, m(1));
    const responders = engine.getResponders();
    expect(responders).toHaveLength(3);
    const seat1 = responders.find((r) => r.seat === 1);
    expect(seat1!.canPeng).toBe(true);
  });
});

// ─── 碰牌 ───────────────────────────────────────────

describe('peng', () => {
  it('响应窗口内成功碰牌', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    engine._setHands([
      [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5)],
      [m(1), m(1), p(2), p(3), p(4), p(5), p(6), p(7), p(8), p(9), s(1), s(2), s(3)],
      [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4)],
      [m(9), m(8), m(7), m(6), m(5), m(4), m(3), m(2), m(1), p(9), p(8), p(7), p(6)],
    ]);
    engine._setWall(FULL_WALL);

    engine.playTile('p1', 0, m(1));
    const result = engine.peng('p2', 1);
    expect(result.ok).toBe(true);
    expect(engine.getState().turn).toBe(1);
    expect(engine.turnPhase).toBe('play');
    expect(engine.getHand(1)!.melds).toHaveLength(1);
    expect(engine.getHand(1)!.melds[0]!.kind).toBe('pong');
    expect(engine.getHand(1)!.concealed).toHaveLength(11);
  });

  it('不能在响应窗口外碰', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    const result = engine.peng('p2', 1);
    expect(result.ok).toBe(false);
  });
});

// ─── 吃牌 ───────────────────────────────────────────

describe('chi', () => {
  it('下家可在响应窗口吃牌', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    engine._setHands([
      [m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5), p(6), p(7)],
      [m(1), m(2), p(2), p(3), p(4), p(5), p(6), p(7), p(8), p(9), s(1), s(2), s(3)],
      [p(1), p(2), p(3), p(4), p(5), p(6), p(7), p(8), p(9), s(1), s(2), s(3), s(4)], /* no m tiles → no peng */
      [s(5), s(6), s(7), s(8), s(9), z(1), z(2), z(3), z(4), z(5), z(6), z(7), p(1)], /* no m tiles → no peng */
    ]);
    engine._setWall(FULL_WALL);

    engine.playTile('p1', 0, m(3));
    const result = engine.chi('p2', 1, m(1));
    expect(result.ok).toBe(true);
    expect(engine.getState().turn).toBe(1);
    expect(engine.getHand(1)!.melds[0]!.kind).toBe('chi');
  });

  it('上家或对家不能吃', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    // seat 3 discards m(3). seat 2 is the 上家 (not 下家 — (3+1)%4=0, not 2).
    // seat 2 has m(1),m(2) which would form a chi if chi were allowed.
    engine._setHands([
      [m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5), p(6), p(7)],
      [s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8), s(9), z(1), z(2), z(3), z(4)],
      [m(1), m(2), p(2), p(3), p(4), p(5), p(6), p(7), p(8), p(9), s(1), s(2), s(3)],
      [m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5), p(6), p(7)],
    ]);
    engine._setWall(FULL_WALL);
    engine['state'].turn = 3;

    engine.playTile('p4', 3, m(3));
    // seat 2 is NOT 下家 of seat 3 ((3+1)%4=0), so chi should be rejected
    const result = engine.chi('p3', 2, m(1));
    expect(result.ok).toBe(false);
  });
});

// ─── 杠牌 ───────────────────────────────────────────

describe('gang', () => {
  it('明杠成功', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    engine._setHands([
      [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5)],
      [m(1), m(1), m(1), p(2), p(3), p(4), p(5), p(6), p(7), p(8), p(9), s(1), s(2)],
      [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4)],
      [m(9), m(8), m(7), m(6), m(5), m(4), m(3), m(2), m(1), p(9), p(8), p(7), p(6)],
    ]);
    engine._setWall(FULL_WALL);

    engine.playTile('p1', 0, m(1));
    const result = engine.gang('p2', 1, 'ming_kong');
    expect(result.ok).toBe(true);
    expect(engine.getHand(1)!.melds[0]!.kind).toBe('ming_kong');
    expect(engine.getHand(1)!.concealed).toHaveLength(11);
  });

  it('暗杠成功', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    engine._setHands([
      [m(1), m(1), m(1), m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2)],
      [m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5), p(6), p(7)],
      [s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8), s(9), z(1), z(2), z(3), z(4)],
      [p(8), p(9), s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8), s(9), z(5), z(6)],
    ]);
    engine._setWall(FULL_WALL);

    const result = engine.gang('p1', 0, 'an_kong');
    expect(result.ok).toBe(true);
    expect(engine.getHand(0)!.melds[0]!.kind).toBe('an_kong');
    expect(engine.getHand(0)!.melds[0]!.from).toBeNull();
    expect(engine.getHand(0)!.concealed).toHaveLength(11);
  });

  it('补杠成功', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    engine._setHands([
      [m(9), m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), p(1), p(2)],
      [m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5), p(6), p(7)],
      [s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8), s(9), z(1), z(2), z(3), z(4)],
      [p(8), p(9), s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8), s(9), z(5), z(6)],
    ]);
    engine._setWall(FULL_WALL);
    // add existing pong meld
    engine['state'].hands[0]!.melds = [{ kind: 'pong', tiles: [m(9), m(9), m(9)], from: 1 }];

    const result = engine.gang('p1', 0, 'bu_kong');
    expect(result.ok).toBe(true);
    const meld = engine.getHand(0)!.melds[0];
    expect(meld!.kind).toBe('bu_kong');
  });

  it('不能明杠：不是响应窗口', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    const result = engine.gang('p2', 1, 'ming_kong');
    expect(result.ok).toBe(false);
  });
});

// ─── 胡牌 ───────────────────────────────────────────

describe('hu', () => {
  it('点炮胡成功', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    engine._setHands([
      [m(9), m(2), m(3), m(4), m(5), m(6), m(7), m(8), p(1), p(2), p(3), p(4), p(5), p(6)],
      [m(1), m(2), m(3), p(4), p(5), p(6), s(7), s(8), s(9), z(1), z(1), z(1), m(9)],
      [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4)],
      [m(9), m(8), m(7), m(6), m(5), m(4), m(3), m(2), m(1), p(9), p(8), p(7), p(6)],
    ]);
    engine._setWall(FULL_WALL);

    engine.playTile('p1', 0, m(9));
    const result = engine.hu('p2', 1);
    expect(result.ok).toBe(true);
    expect(engine.getState().phase).toBe('settled');
  });

  it('自摸胡成功', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    engine._setHands([
      [m(1), m(2), m(3), p(4), p(5), p(6), s(7), s(8), s(9), z(1), z(1), z(1), m(9), m(9)],
      [m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5), p(6), p(7)],
      [s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8), s(9), z(1), z(2), z(3), z(4)],
      [p(8), p(9), s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8), s(9), z(5), z(6)],
    ]);
    engine._setWall(FULL_WALL);

    const result = engine.hu('p1', 0);
    expect(result.ok).toBe(true);
    expect(engine.getState().phase).toBe('settled');
  });

  it('未听牌不能胡', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    engine._setHands([
      [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5)],
      [m(1), m(3), m(5), p(2), p(4), p(6), s(1), s(3), s(5), z(1), z(2), z(3), z(4)],
      [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4)],
      [m(9), m(8), m(7), m(6), m(5), m(4), m(3), m(2), m(1), p(9), p(8), p(7), p(6)],
    ]);
    engine._setWall(FULL_WALL);

    engine.playTile('p1', 0, m(1));
    const result = engine.hu('p2', 1);
    expect(result.ok).toBe(false);
  });
});

// ─── 流局 ───────────────────────────────────────────

describe('draw game (流局)', () => {
  it('牌墙耗尽导致流局', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    engine._setHands([
      [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5)],
      [m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5), p(6), p(7)],
      [s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8), s(9), z(1), z(2), z(3), z(4)],
      [p(8), p(9), s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8), s(9), z(5), z(6)],
    ]);
    // empty wall
    engine._setWall([]);

    const result = engine.playTile('p1', 0, m(1));
    expect(result.ok).toBe(true);
    expect(engine.getState().phase).toBe('settled');
  });
});

// ─── 事件日志 ───────────────────────────────────────

describe('event log', () => {
  it('每步操作产生事件', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    engine._setHands([
      [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5)],
      [m(1), m(1), p(2), p(3), p(4), p(5), p(6), p(7), p(8), p(9), s(1), s(2), s(3)],
      [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4)],
      [m(9), m(8), m(7), m(6), m(5), m(4), m(3), m(2), m(1), p(9), p(8), p(7), p(6)],
    ]);
    engine._setWall(FULL_WALL);

    engine.playTile('p1', 0, m(1));
    engine.pass('p2', 1);
    engine.pass('p3', 2);
    engine.pass('p4', 3);

    expect(engine.events.length).toBeGreaterThanOrEqual(2);
    expect(engine.events[0]!.type).toBe('DEAL');
  });
});

// ─── 对局结束后拒绝动作 ──────────────────────────

describe('post-game rejection', () => {
  function createSettledHuEngine(): GameEngine {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    engine._setHands([
      [m(9), m(2), m(3), m(4), m(5), m(6), m(7), m(8), p(1), p(2), p(3), p(4), p(5), p(6)],
      [m(1), m(2), m(3), p(4), p(5), p(6), s(7), s(8), s(9), z(1), z(1), z(1), m(9)],
      [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4)],
      [m(9), m(8), m(7), m(6), m(5), m(4), m(3), m(2), m(1), p(9), p(8), p(7), p(6)],
    ]);
    engine._setWall(FULL_WALL);
    engine.playTile('p1', 0, m(9));
    const r = engine.hu('p2', 1);
    expect(r.ok).toBe(true);
    expect(engine.getState().phase).toBe('settled');
    return engine;
  }

  function createSettledDrawEngine(): GameEngine {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    engine._setHands([
      [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5)],
      [m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5), p(6), p(7)],
      [s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8), s(9), z(1), z(2), z(3), z(4)],
      [p(8), p(9), s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8), s(9), z(5), z(6)],
    ]);
    engine._setWall([]); // empty wall → draw
    engine.playTile('p1', 0, m(1));
    expect(engine.getState().phase).toBe('settled');
    return engine;
  }

  it('胡牌后 PLAY_TILE 被拒绝', () => {
    const engine = createSettledHuEngine();
    const hand = engine.getHand(2)!;
    const result = engine.playTile('p3', 2, hand.concealed[0]!);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('WRONG_PHASE');
  });

  it('胡牌后 CHI 被拒绝', () => {
    const engine = createSettledHuEngine();
    const result = engine.chi('p3', 2, m(1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('WRONG_PHASE');
  });

  it('胡牌后 PENG 被拒绝', () => {
    const engine = createSettledHuEngine();
    const result = engine.peng('p3', 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('WRONG_PHASE');
  });

  it('胡牌后 GANG 被拒绝', () => {
    const engine = createSettledHuEngine();
    const result = engine.gang('p3', 2, 'ming_kong');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('WRONG_PHASE');
  });

  it('胡牌后 HU 被拒绝', () => {
    const engine = createSettledHuEngine();
    const result = engine.hu('p2', 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('WRONG_PHASE');
  });

  it('胡牌后 PASS 被拒绝', () => {
    const engine = createSettledHuEngine();
    const result = engine.pass('p3', 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('WRONG_PHASE');
  });

  it('流局后 PLAY_TILE 被拒绝', () => {
    const engine = createSettledDrawEngine();
    const hand = engine.getHand(2)!;
    const result = engine.playTile('p3', 2, hand.concealed[0]!);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('WRONG_PHASE');
  });
});

// ─── 计分 ────────────────────────────────────────

describe('scoring', () => {
  it('自摸胡：赢家 +3，其余各 -1', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    engine._setHands([
      [m(1), m(2), m(3), p(4), p(5), p(6), s(7), s(8), s(9), z(1), z(1), z(1), m(9), m(9)],
      [m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5), p(6), p(7)],
      [s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8), s(9), z(1), z(2), z(3), z(4)],
      [p(8), p(9), s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8), s(9), z(5), z(6)],
    ]);
    engine._setWall(FULL_WALL);

    const result = engine.hu('p1', 0);
    expect(result.ok).toBe(true);
    const scores = engine.getState().scores;
    expect(scores[0]).toBe(3);
    expect(scores[1]).toBe(-1);
    expect(scores[2]).toBe(-1);
    expect(scores[3]).toBe(-1);
  });

  it('点炮胡：赢家 +3，放炮者 -3', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    engine._setHands([
      [m(9), m(2), m(3), m(4), m(5), m(6), m(7), m(8), p(1), p(2), p(3), p(4), p(5), p(6)],
      [m(1), m(2), m(3), p(4), p(5), p(6), s(7), s(8), s(9), z(1), z(1), z(1), m(9)],
      [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4)],
      [m(9), m(8), m(7), m(6), m(5), m(4), m(3), m(2), m(1), p(9), p(8), p(7), p(6)],
    ]);
    engine._setWall(FULL_WALL);

    engine.playTile('p1', 0, m(9));
    const result = engine.hu('p2', 1);
    expect(result.ok).toBe(true);
    const scores = engine.getState().scores;
    expect(scores[1]).toBe(3);   // winner
    expect(scores[0]).toBe(-3);  // discarder
    expect(scores[2]).toBe(0);
    expect(scores[3]).toBe(0);
  });

  it('流局：所有玩家分数不变', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    engine._setHands([
      [m(1), m(2), m(3), m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5)],
      [m(4), m(5), m(6), m(7), m(8), m(9), p(1), p(2), p(3), p(4), p(5), p(6), p(7)],
      [s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8), s(9), z(1), z(2), z(3), z(4)],
      [p(8), p(9), s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8), s(9), z(5), z(6)],
    ]);
    engine._setWall([]);

    engine.playTile('p1', 0, m(1));
    const scores = engine.getState().scores;
    expect(scores[0]).toBe(0);
    expect(scores[1]).toBe(0);
    expect(scores[2]).toBe(0);
    expect(scores[3]).toBe(0);
    expect(engine.getState().phase).toBe('settled');
  });

  it('getEventSummary 返回摘要事件列表', () => {
    const engine = new GameEngine();
    engine.initGame(makeRoom());
    const summary = engine.getEventSummary();
    expect(summary.length).toBeGreaterThanOrEqual(1);
    expect(summary[0]!.type).toBe('DEAL');
    expect(summary[0]!.seat).toBe(0);
    expect(typeof summary[0]!.timestamp).toBe('number');
  });
});

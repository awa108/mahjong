import { describe, expect, it } from 'vitest';
import {
  checkHu,
  sortHand,
  removeTile,
  simple4Rules,
  canChi,
  canPeng,
  canMingGang,
  canAnGang,
  canBuGang,
  canHuWithDiscard,
  canHuSelfDraw,
} from '../src/rules.js';
import { tile } from '../src/tiles.js';
import type { Tile } from '../src/tiles.js';
import type { MeldKind } from '../src/types.js';

// shorthand helpers
const m = (r: number): Tile => tile('m', r as Tile['rank']);
const p = (r: number): Tile => tile('p', r as Tile['rank']);
const s = (r: number): Tile => tile('s', r as Tile['rank']);
const z = (r: number): Tile => tile('z', r as Tile['rank']);

// ─── checkHu ─────────────────────────────────────────

describe('checkHu', () => {
  describe('winning hands', () => {
    it('standard: 顺子×3 + 刻子×1 + 雀头×1 (平胡)', () => {
      const hand = [m(1), m(2), m(3), p(4), p(5), p(6), s(7), s(8), s(9), z(2), z(2), z(2), z(1), z(1)];
      const r = checkHu(hand);
      expect(r.canHu).toBe(true);
      expect(r.pattern).toContain('平胡');
      expect(r.pair).toBe('z1');
      expect(r.melds).toHaveLength(4);
    });

    it('碰碰胡: all pongs', () => {
      const hand = [m(1), m(1), m(1), p(3), p(3), p(3), s(5), s(5), s(5), z(4), z(4), z(4), m(9), m(9)];
      const r = checkHu(hand);
      expect(r.canHu).toBe(true);
      expect(r.pattern).toContain('碰碰胡');
      expect(r.melds).toHaveLength(4);
      expect(r.melds!.every((m) => m.kind === 'pong')).toBe(true);
    });

    it('mixed: 顺子×2 + 刻子×2 + 雀头', () => {
      const hand = [m(1), m(2), m(3), m(7), m(8), m(9), p(1), p(1), p(1), s(9), s(9), s(9), z(4), z(4)];
      const r = checkHu(hand);
      expect(r.canHu).toBe(true);
    });

    it('边缘顺子: 123 和 789', () => {
      const hand = [m(1), m(2), m(3), m(7), m(8), m(9), p(2), p(3), p(4), s(5), s(6), s(7), z(1), z(1)];
      const r = checkHu(hand);
      expect(r.canHu).toBe(true);
    });

    it('字牌刻子 + 顺子', () => {
      const hand = [m(1), m(2), m(3), p(4), p(5), p(6), z(1), z(1), z(1), z(2), z(2), z(2), s(3), s(3)];
      const r = checkHu(hand);
      expect(r.canHu).toBe(true);
    });

    it('multiple valid decompositions (ambiguous)', () => {
      const hand = [
        m(1), m(1), m(1), m(2), m(2), m(2), m(3), m(3), m(3), m(4), m(5), m(6), m(8), m(8),
      ];
      const r = checkHu(hand);
      expect(r.canHu).toBe(true);
      expect(r.melds).toHaveLength(4);
    });

    it('pair of honor tiles works', () => {
      const hand = [m(1), m(2), m(3), p(2), p(3), p(4), s(3), s(4), s(5), m(6), m(6), m(6), z(4), z(4)];
      const r = checkHu(hand);
      expect(r.canHu).toBe(true);
    });
  });

  describe('non-winning hands', () => {
    it('missing a pair (all melds but no head)', () => {
      const hand = [m(1), m(2), m(3), p(4), p(5), p(6), s(7), s(8), s(9), z(1), z(1), z(1), m(2), m(3)];
      const r = checkHu(hand);
      expect(r.canHu).toBe(false);
    });

    it('one tile short of a meld', () => {
      const hand = [m(1), m(2), m(3), p(4), p(5), s(7), s(8), s(9), z(2), z(2), z(2), z(1), z(1), m(9)];
      const r = checkHu(hand);
      expect(r.canHu).toBe(false);
    });

    it('word tiles cannot form chi', () => {
      const hand = [z(1), z(1), z(2), z(2), z(3), z(3), z(4), z(4), z(5), z(5), z(6), z(6), z(7), z(7)];
      expect(checkHu(hand).canHu).toBe(false);
    });

    it('honor tiles as chi — must fail', () => {
      const hand = [m(1), m(2), m(3), p(4), p(5), p(6), s(7), s(8), s(9), z(1), z(2), z(3), z(5), z(5)];
      const r = checkHu(hand);
      expect(r.canHu).toBe(false);
    });

    it('random scatter', () => {
      const hand = [m(1), m(3), m(5), p(2), p(4), p(6), s(1), s(3), s(5), z(1), z(3), z(5), z(7), m(7)];
      expect(checkHu(hand).canHu).toBe(false);
    });

    it('too many of one kind (>4) is rejected', () => {
      const hand = [m(1), m(1), m(1), m(1), m(1), m(2), m(3), p(4), p(5), p(6), s(7), s(8), s(9), z(1)];
      const r = checkHu(hand);
      expect(r.canHu).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('empty array → false', () => {
      expect(checkHu([]).canHu).toBe(false);
    });

    it('13 tiles → false', () => {
      const hand = [m(1), m(2), m(3), p(4), p(5), p(6), s(7), s(8), s(9), z(1), z(1), z(1), m(9)];
      expect(checkHu(hand).canHu).toBe(false);
    });

    it('15 tiles → false', () => {
      const hand = [m(1), m(2), m(3), p(4), p(5), p(6), s(7), s(8), s(9), z(1), z(1), z(1), z(1), z(2), z(2)];
      expect(checkHu(hand).canHu).toBe(false);
    });

    it('14 identical tiles → >4 rejected', () => {
      const hand = Array.from({ length: 14 }, () => m(1));
      expect(checkHu(hand).canHu).toBe(false);
    });
  });
});

// ─── canChi ──────────────────────────────────────────

describe('canChi', () => {
  it('下家可以吃: (r-2, r-1) + r', () => {
    const hand = [m(1), m(2), p(5), p(6), s(9)]; // 1m,2m 在手中
    const result = canChi(hand, m(3), 2, 1); // seat 2 is next from seat 1
    expect(result.canChi).toBe(true);
    expect(result.options).toHaveLength(1);
    expect(result.options[0]!.tiles.map((t) => `${t.suit}${t.rank}`)).toEqual(['m1', 'm2']);
  });

  it('下家可以吃: (r-1, r+1) + r', () => {
    const hand = [m(1), m(3), z(1)];
    const result = canChi(hand, m(2), 2, 1);
    expect(result.canChi).toBe(true);
    expect(result.options).toHaveLength(1);
    expect(result.options[0]!.tiles.map((t) => `${t.suit}${t.rank}`)).toEqual(['m1', 'm3']);
  });

  it('下家可以吃: (r+1, r+2) + r', () => {
    const hand = [m(2), m(3), z(1)];
    const result = canChi(hand, m(1), 2, 1);
    expect(result.canChi).toBe(true);
    expect(result.options).toHaveLength(1);
  });

  it('multiple chi options', () => {
    // discard m5, hand has m3,m4 (r-2,r-1), m4,m6 (r-1,r+1), m6,m7 (r+1,r+2)
    const hand = [m(3), m(4), m(6), m(7), z(1)];
    const result = canChi(hand, m(5), 2, 1);
    expect(result.canChi).toBe(true);
    expect(result.options.length).toBeGreaterThanOrEqual(2);
  });

  it('非下家不能吃 (对家)', () => {
    const hand = [m(1), m(2), z(1), z(2)];
    const result = canChi(hand, m(3), 2, 0); // seat 0 discard, seat 2 is opposite
    expect(result.canChi).toBe(false);
  });

  it('非下家不能吃 (上家)', () => {
    const hand = [m(1), m(2), z(1)];
    const result = canChi(hand, m(3), 1, 2); // seat 2 discard, seat 1 is 上家 of 2
    expect(result.canChi).toBe(false);
  });

  it('字牌不能吃', () => {
    const hand = [z(1), z(2), m(1)];
    const result = canChi(hand, z(3), 2, 1);
    expect(result.canChi).toBe(false);
  });

  it('缺牌不能吃', () => {
    const hand = [m(1), m(5), z(1)];
    const result = canChi(hand, m(3), 2, 1);
    expect(result.canChi).toBe(false);
  });

  it('不传座位时不检查座位', () => {
    const hand = [m(1), m(2), z(1)];
    const result = canChi(hand, m(3)); // no seat check
    expect(result.canChi).toBe(true);
  });
});

// ─── canPeng ─────────────────────────────────────────

describe('canPeng', () => {
  it('手中有两张相同牌可碰', () => {
    const hand = [m(1), m(1), m(2), m(3), p(4)];
    const result = canPeng(hand, m(1));
    expect(result.canPeng).toBe(true);
    expect(result.tiles).toHaveLength(2);
  });

  it('三张同牌也可碰 (返回前两张)', () => {
    const hand = [m(1), m(1), m(1), z(1)];
    const result = canPeng(hand, m(1));
    expect(result.canPeng).toBe(true);
    expect(result.tiles).toHaveLength(2);
  });

  it('只有一张不能碰', () => {
    const hand = [m(1), m(2), m(3)];
    const result = canPeng(hand, m(1));
    expect(result.canPeng).toBe(false);
  });

  it('没有同牌不能碰', () => {
    const hand = [m(1), m(2), m(3)];
    const result = canPeng(hand, p(1));
    expect(result.canPeng).toBe(false);
  });
});

// ─── canMingGang ─────────────────────────────────────

describe('canMingGang', () => {
  it('手中有三张同牌可明杠', () => {
    const hand = [m(1), m(1), m(1), z(1)];
    const result = canMingGang(hand, m(1));
    expect(result.canGang).toBe(true);
    expect(result.tiles).toHaveLength(3);
  });

  it('只有两张不能明杠', () => {
    const hand = [m(1), m(1), z(1)];
    const result = canMingGang(hand, m(1));
    expect(result.canGang).toBe(false);
  });

  it('没有同牌不能明杠', () => {
    const hand = [m(1), m(2), m(3)];
    const result = canMingGang(hand, p(5));
    expect(result.canGang).toBe(false);
  });
});

// ─── canAnGang ───────────────────────────────────────

describe('canAnGang', () => {
  it('手中有四张同牌可暗杠', () => {
    const hand = [m(1), m(1), m(1), m(1), z(2), z(3)];
    const result = canAnGang(hand);
    expect(result.canGang).toBe(true);
    expect(result.tiles).toHaveLength(4);
  });

  it('只有三张不能暗杠', () => {
    const hand = [m(1), m(1), m(1), z(1)];
    const result = canAnGang(hand);
    expect(result.canGang).toBe(false);
  });

  it('空手牌不能暗杠', () => {
    const result = canAnGang([]);
    expect(result.canGang).toBe(false);
  });

  it('多组四张返回第一组', () => {
    // m(1)×4 + m(2)×4
    const hand = [m(1), m(1), m(1), m(1), m(2), m(2), m(2), m(2)];
    const result = canAnGang(hand);
    expect(result.canGang).toBe(true);
    expect(result.tiles).toHaveLength(4);
  });
});

// ─── canBuGang ───────────────────────────────────────

describe('canBuGang', () => {
  it('已有碰副露 + 手牌可补杠', () => {
    const hand = [m(1), m(2), m(3)];
    const melds: { kind: string; tiles: Tile[] }[] = [
      { kind: 'pong', tiles: [m(9), m(9), m(9)] },
    ];
    const result = canBuGang(hand, melds, m(9));
    expect(result.canGang).toBe(true);
  });

  it('副露不是碰不能补杠', () => {
    const hand = [m(1), m(2), m(3)];
    const melds: { kind: string; tiles: Tile[] }[] = [
      { kind: 'chi', tiles: [m(4), m(5), m(6)] },
    ];
    const result = canBuGang(hand, melds, m(4));
    expect(result.canGang).toBe(false);
  });

  it('手牌无对应牌不能补杠', () => {
    const hand = [m(2), m(3), m(4)];
    const melds: { kind: string; tiles: Tile[] }[] = [
      { kind: 'pong', tiles: [m(9), m(9), m(9)] },
    ];
    // No drawnTile: check hand for any match → no m(9) in hand
    const result = canBuGang(hand, melds);
    expect(result.canGang).toBe(false);
  });

  it('drawnTile 不匹配任何碰副露不能补杠', () => {
    const hand = [m(1), m(2), m(3)];
    const melds: { kind: string; tiles: Tile[] }[] = [
      { kind: 'pong', tiles: [m(9), m(9), m(9)] },
    ];
    const result = canBuGang(hand, melds, m(5));
    expect(result.canGang).toBe(false);
  });

  it('不传 drawnTile 时从手牌中找补杠牌', () => {
    const hand = [m(1), m(2), m(9)];
    const melds: { kind: string; tiles: Tile[] }[] = [
      { kind: 'pong', tiles: [m(9), m(9), m(9)] },
    ];
    const result = canBuGang(hand, melds);
    expect(result.canGang).toBe(true);
    expect(result.tile!.suit).toBe('m');
    expect(result.tile!.rank).toBe(9);
  });

  it('无副露不能补杠', () => {
    const hand = [m(1), m(1), m(1), m(1)];
    const result = canBuGang(hand, []);
    expect(result.canGang).toBe(false);
  });
});

// ─── canHuWithDiscard ────────────────────────────────

describe('canHuWithDiscard', () => {
  it('13 张手牌 + 弃牌可胡', () => {
    // Standard 13-tile hand: 123m 456p 789s 111z 99m → wait for m9
    const hand13 = [m(1), m(2), m(3), p(4), p(5), p(6), s(7), s(8), s(9), z(1), z(1), z(1), m(9)];
    const result = canHuWithDiscard(hand13, m(9));
    expect(result.canHu).toBe(true);
  });

  it('13 张手牌 + 不匹配的弃牌不能胡', () => {
    const hand13 = [m(1), m(2), m(3), p(4), p(5), p(6), s(7), s(8), s(9), z(1), z(1), z(1), m(9)];
    const result = canHuWithDiscard(hand13, m(5));
    expect(result.canHu).toBe(false);
  });
});

// ─── canHuSelfDraw ───────────────────────────────────

describe('canHuSelfDraw', () => {
  it('13 张手牌 + 自摸牌可胡', () => {
    const hand13 = [m(1), m(2), m(3), p(4), p(5), p(6), s(7), s(8), s(9), z(1), z(1), z(1), m(9)];
    const result = canHuSelfDraw(hand13, m(9));
    expect(result.canHu).toBe(true);
  });

  it('13 张手牌 + 不匹配的自摸牌不能胡', () => {
    const hand13 = [m(1), m(2), m(3), p(4), p(5), p(6), s(7), s(8), s(9), z(1), z(1), z(1), m(9)];
    const result = canHuSelfDraw(hand13, m(5));
    expect(result.canHu).toBe(false);
  });
});

// ─── Ruleset 兼容性 ──────────────────────────────────

describe('simple4Rules', () => {
  it('canHu — standard 4 melds + 1 pair', () => {
    const hand13 = [m(1), m(2), m(3), p(4), p(5), p(6), s(7), s(8), s(9), m(9), m(9), z(1), z(1)];
    expect(simple4Rules.canHu(hand13, m(9), false)).toBe(true);
  });

  it('canHu — not a winning hand', () => {
    const hand13 = [m(1), m(3), m(5), p(2), p(4), p(6), s(1), s(3), s(5), z(1), z(3), z(5), z(7)];
    expect(simple4Rules.canHu(hand13, m(7), false)).toBe(false);
  });

  it('canChi — can chi with matching tiles', () => {
    expect(simple4Rules.canChi([m(1), m(2)], m(3))).toBe(true);
  });

  it('canChi — cannot chi honor tiles', () => {
    expect(simple4Rules.canChi([m(1), m(2)], z(1))).toBe(false);
  });

  it('canChi — cannot chi without matching tiles', () => {
    expect(simple4Rules.canChi([m(1), m(5)], m(3))).toBe(false);
  });

  it('canPong — can pong when have 2 of the same', () => {
    expect(simple4Rules.canPong([m(1), m(1)], m(1))).toBe(true);
  });

  it('canPong — cannot pong with only 1', () => {
    expect(simple4Rules.canPong([m(1), m(2)], m(1))).toBe(false);
  });

  it('canKong — ming kong: 3 in hand + discard', () => {
    expect(simple4Rules.canKong([m(1), m(1), m(1)], [], m(1))).toBe('ming_kong');
  });

  it('canKong — an kong: 4 in hand', () => {
    expect(simple4Rules.canKong([m(1), m(1), m(1), m(1)], [])).toBe('an_kong');
  });

  it('canKong — bu kong: melded pong + drawn 4th', () => {
    const hand = [m(1)];
    const melds: { kind: MeldKind; tiles: Tile[] }[] = [
      { kind: 'pong', tiles: [m(1), m(1), m(1)] },
    ];
    expect(simple4Rules.canKong(hand, melds)).toBe('bu_kong');
  });

  it('score — returns base score', () => {
    const r = simple4Rules.score(0, 'self', null);
    expect(r.baseScore).toBeGreaterThan(0);
    expect(r.pattern).toContain('基础胡');
  });
});

// ─── helpers ─────────────────────────────────────────

describe('helpers', () => {
  it('sortHand', () => {
    const hand = [z(7), p(2), m(9)];
    expect(sortHand(hand).map((t) => `${t.suit}${t.rank}`)).toEqual(['m9', 'p2', 'z7']);
  });

  it('removeTile', () => {
    const hand = [m(1), m(1), m(2)];
    const r = removeTile(hand, m(1));
    expect(r).not.toBeNull();
    expect(r!.map((t) => `${t.suit}${t.rank}`)).toEqual(['m1', 'm2']);
  });

  it('removeTile returns null when tile not in hand', () => {
    expect(removeTile([m(1), m(2)], m(3))).toBeNull();
  });
});

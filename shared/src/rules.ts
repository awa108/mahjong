/**
 * @file rules.ts
 * 麻将规则引擎核心 — 纯函数，前后端共用。
 * 未来扩展四川/国标只需新增规则实现。
 */
import type { MeldKind, Seat } from './types.js';
import type { Tile } from './tiles.js';
import { compareTile, sameTile, tileKey } from './tiles.js';

// ─── 类型 ────────────────────────────────────────────

/** 一组面子（顺子或刻子）。 */
export interface ResolvedMeld {
  kind: 'chi' | 'pong';
  tiles: Tile[];
}

/** checkHu 的返回结构。 */
export interface HuResult {
  canHu: boolean;
  /** 番型名列表（第一版只有 "平胡" 或 "碰碰胡"）。 */
  pattern: string[];
  /** 雀头的 tileKey。 */
  pair?: string;
  /** 分解出的 4 组面子。 */
  melds?: ResolvedMeld[];
}

/** 吃牌选项。 */
export interface ChiOption {
  /** 手牌中用于吃牌的两张牌。 */
  tiles: Tile[];
  /** 顺子中点数最低的那张牌。 */
  chiLow: Tile;
}

export interface ChiResult {
  canChi: boolean;
  options: ChiOption[];
}

export interface PengResult {
  canPeng: boolean;
  /** 手牌中与弃牌同牌的两张。 */
  tiles?: Tile[];
}

export interface MingGangResult {
  canGang: boolean;
  /** 手牌中与弃牌同牌的三张。 */
  tiles?: Tile[];
}

export interface AnGangResult {
  canGang: boolean;
  /** 手牌中四张相同的牌（取第一组）。 */
  tiles?: Tile[];
}

export interface BuGangResult {
  canGang: boolean;
  /** 手牌中可补杠的那张牌。 */
  tile?: Tile;
}

// ─── 工具 ────────────────────────────────────────────

/** 排序手牌。 */
export function sortHand(h: readonly Tile[]): Tile[] {
  return [...h].sort(compareTile);
}

/** 按 tileKey 移除一张牌，返回新数组（不修改原数组），不存在则返回 null。 */
export function removeTile(hand: readonly Tile[], t: Tile): Tile[] | null {
  const key = tileKey(t);
  const idx = hand.findIndex((c) => tileKey(c) === key);
  if (idx < 0) return null;
  return [...hand.slice(0, idx), ...hand.slice(idx + 1)];
}

/** 从 hand 中按 tileKey 移除一组牌（各一次）。 */
export function removeTiles(hand: readonly Tile[], tiles: Tile[]): Tile[] | null {
  let h = [...hand];
  for (const t of tiles) {
    const next = removeTile(h, t);
    if (!next) return null;
    h = next;
  }
  return h;
}

/** 统计每种牌的数量（按 tileKey）。 */
function countByKey(tiles: readonly Tile[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tiles) {
    const k = tileKey(t);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

// ═══════════════════════════════════════════════════════
//  checkHu — 基础胡牌判定（4 面子 + 1 雀头）
// ═══════════════════════════════════════════════════════

/**
 * 核心胡牌判定。
 * @param hand 14 张牌（未排序也可，内部会排序）。
 * @returns HuResult — 包含 canHu、番型、雀头与面子分解。
 *
 * 规则：4 组面子（顺子或刻子）+ 1 对雀头。
 * 字牌（z）不能组成顺子。
 * 暂不做七对、十三幺。
 */
export function checkHu(hand: readonly Tile[]): HuResult {
  if (hand.length !== 14) {
    return { canHu: false, pattern: [] };
  }

  const counts = countByKey(hand);
  for (const c of counts.values()) {
    if (c > 4) return { canHu: false, pattern: [] };
  }

  const sorted = sortHand(hand);
  const seen = new Set<string>();

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (!sameTile(a, b)) continue;

    const pairKey = tileKey(a);
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);

    const rest = [...sorted.slice(0, i), ...sorted.slice(i + 2)];
    const melds = trySplitWithMelds(rest);
    if (melds) {
      const isAllPong = melds.every((m) => m.kind === 'pong');
      return {
        canHu: true,
        pattern: isAllPong ? ['碰碰胡'] : ['平胡'],
        pair: pairKey,
        melds,
      };
    }
  }

  return { canHu: false, pattern: [] };
}

/**
 * 递归尝试将 12 张牌分解为 4 组面子。
 * 返回面子数组，失败返回 null。
 */
function trySplitWithMelds(tiles: readonly Tile[]): ResolvedMeld[] | null {
  if (tiles.length === 0) return [];
  if (tiles.length < 3) return null;

  const head = tiles[0]!;

  if (
    tiles.length >= 3 &&
    sameTile(head, tiles[1]!) &&
    sameTile(head, tiles[2]!)
  ) {
    const meld: ResolvedMeld = { kind: 'pong', tiles: [head, tiles[1]!, tiles[2]!] };
    const rest = trySplitWithMelds(tiles.slice(3));
    if (rest !== null) return [meld, ...rest];
  }

  if (head.suit !== 'z') {
    const r = head.rank;
    const n1 = _findTile(tiles, head.suit, (r + 1) as Tile['rank']);
    const n2 = _findTile(tiles, head.suit, (r + 2) as Tile['rank']);
    if (n1 && n2) {
      const meld: ResolvedMeld = { kind: 'chi', tiles: [head, n1, n2] };
      const restAfter = removeTiles(tiles, [head, n1, n2]);
      if (restAfter) {
        const result = trySplitWithMelds(restAfter);
        if (result !== null) return [meld, ...result];
      }
    }
  }

  return null;
}

/** 在 tiles 中找到指定花色和点数的牌（取第一个匹配），不在则 null。 */
function _findTile(tiles: readonly Tile[], suit: Tile['suit'], rank: Tile['rank']): Tile | null {
  return tiles.find((t) => t.suit === suit && t.rank === rank) ?? null;
}

// ═══════════════════════════════════════════════════════
//  动作合法性判断（返回可执行组合，不只是 boolean）
// ═══════════════════════════════════════════════════════

/**
 * 吃牌判断。只有下家可以吃。
 * @param hand 当前玩家手牌
 * @param discardTile 上家打出的牌
 * @param playerSeat 当前玩家座位（可选，不传则不检查座位）
 * @param fromSeat 出牌者座位（可选）
 */
export function canChi(
  hand: readonly Tile[],
  discardTile: Tile,
  playerSeat?: Seat,
  fromSeat?: Seat,
): ChiResult {
  if (playerSeat != null && fromSeat != null) {
    if ((fromSeat + 1) % 4 !== playerSeat) {
      return { canChi: false, options: [] };
    }
  }

  if (discardTile.suit === 'z') {
    return { canChi: false, options: [] };
  }

  const suit = discardTile.suit;
  const r = discardTile.rank;
  const options: ChiOption[] = [];

  // (r-2, r-1) + r → chiLow = r-2
  if (r - 2 >= 1) {
    const t1 = _findTileByRank(hand, suit, (r - 2) as Tile['rank']);
    const t2 = _findTileByRankExcluding(hand, suit, (r - 1) as Tile['rank'], t1 ? [t1.id] : []);
    if (t1 && t2) {
      options.push({ tiles: [t1, t2], chiLow: t1 });
    }
  }

  // (r-1, r+1) + r → chiLow = r-1
  if (r - 1 >= 1 && r + 1 <= 9) {
    const t1 = _findTileByRank(hand, suit, (r - 1) as Tile['rank']);
    const t2 = _findTileByRankExcluding(hand, suit, (r + 1) as Tile['rank'], t1 ? [t1.id] : []);
    if (t1 && t2) {
      options.push({ tiles: [t1, t2], chiLow: t1 });
    }
  }

  // (r+1, r+2) + r → chiLow = r
  if (r + 2 <= 9) {
    const t1 = _findTileByRank(hand, suit, (r + 1) as Tile['rank']);
    const t2 = _findTileByRankExcluding(hand, suit, (r + 2) as Tile['rank'], t1 ? [t1.id] : []);
    if (t1 && t2) {
      options.push({ tiles: [t1, t2], chiLow: discardTile });
    }
  }

  return { canChi: options.length > 0, options };
}

function _findTileByRank(tiles: readonly Tile[], suit: Tile['suit'], rank: Tile['rank']): Tile | null {
  return tiles.find((t) => t.suit === suit && t.rank === rank) ?? null;
}

function _findTileByRankExcluding(
  tiles: readonly Tile[],
  suit: Tile['suit'],
  rank: Tile['rank'],
  excludeIds: string[],
): Tile | null {
  return tiles.find((t) => t.suit === suit && t.rank === rank && !excludeIds.includes(t.id)) ?? null;
}

/**
 * 碰牌判断。手里至少有两张与弃牌同种的牌。
 */
export function canPeng(hand: readonly Tile[], discardTile: Tile): PengResult {
  const matches = hand.filter((t) => sameTile(t, discardTile));
  if (matches.length >= 2) {
    return { canPeng: true, tiles: [matches[0]!, matches[1]!] };
  }
  return { canPeng: false };
}

/**
 * 明杠判断。手里有三张与弃牌同种的牌。
 */
export function canMingGang(hand: readonly Tile[], discardTile: Tile): MingGangResult {
  const matches = hand.filter((t) => sameTile(t, discardTile));
  if (matches.length >= 3) {
    return { canGang: true, tiles: [matches[0]!, matches[1]!, matches[2]!] };
  }
  return { canGang: false };
}

/**
 * 暗杠判断。手里有四张相同的牌。
 */
export function canAnGang(hand: readonly Tile[]): AnGangResult {
  const groups = countByKey(hand);
  for (const [key, count] of groups) {
    if (count >= 4) {
      const tiles = hand.filter((t) => tileKey(t) === key).slice(0, 4);
      return { canGang: true, tiles };
    }
  }
  return { canGang: false };
}

/**
 * 补杠判断。已有碰副露，手牌中有一张可补杠的牌。
 * @param hand 当前手牌
 * @param melds 已副露面子列表
 * @param drawnTile 刚摸到的牌（可选，不传则检查手牌任意牌）
 */
export function canBuGang(
  hand: readonly Tile[],
  melds: readonly { kind: string; tiles: Tile[] }[],
  drawnTile?: Tile,
): BuGangResult {
  for (const meld of melds) {
    if (meld.kind !== 'pong') continue;
    const meldTile = meld.tiles[0]!;
    if (drawnTile) {
      if (sameTile(drawnTile, meldTile)) {
        return { canGang: true, tile: drawnTile };
      }
    } else {
      const match = hand.find((t) => sameTile(t, meldTile));
      if (match) {
        return { canGang: true, tile: match };
      }
    }
  }
  return { canGang: false };
}

/**
 * 判断手牌 + 弃牌是否能胡。
 */
export function canHuWithDiscard(hand: readonly Tile[], discardTile: Tile): HuResult {
  return checkHu([...hand, discardTile]);
}

/**
 * 判断手牌 + 自摸牌是否能胡。
 */
export function canHuSelfDraw(hand: readonly Tile[], drawnTile: Tile): HuResult {
  return checkHu([...hand, drawnTile]);
}

// ═══════════════════════════════════════════════════════
//  Ruleset 接口 + Simple4 实现（保持向后兼容）
// ═══════════════════════════════════════════════════════

export interface Ruleset {
  name: string;
  canHu(hand: readonly Tile[], winTile: Tile, isSelfDrawn: boolean): boolean;
  canChi(hand: readonly Tile[], discardTile: Tile): boolean;
  canPong(hand: readonly Tile[], discardTile: Tile): boolean;
  canKong(
    hand: readonly Tile[],
    melds: { kind: MeldKind; tiles: Tile[] }[],
    discardTile?: Tile,
  ): MeldKind | null;
  score(
    winner: Seat,
    source: 'self' | 'discard',
    loser: Seat | null,
  ): { winner: Seat; source: 'self' | 'discard'; baseScore: number; pattern: string[] };
}

export const simple4Rules: Ruleset = {
  name: 'simple4',

  canHu(hand, winTile, _isSelfDrawn): boolean {
    return checkHu([...hand, winTile]).canHu;
  },

  canChi(hand, discardTile): boolean {
    if (discardTile.suit === 'z') return false;
    const r = discardTile.rank;
    const suit = discardTile.suit;
    const has = (n: number): boolean => hand.some((c) => c.suit === suit && c.rank === n);
    return (has(r - 2) && has(r - 1)) || (has(r - 1) && has(r + 1)) || (has(r + 1) && has(r + 2));
  },

  canPong(hand, discardTile): boolean {
    return hand.filter((c) => sameTile(c, discardTile)).length >= 2;
  },

  canKong(hand, melds, discardTile?): MeldKind | null {
    if (discardTile && hand.filter((c) => sameTile(c, discardTile)).length >= 3) {
      return 'ming_kong';
    }
    for (const t of hand) {
      if (hand.filter((c) => sameTile(c, t)).length >= 4) return 'an_kong';
    }
    if (!discardTile) {
      for (const m of melds) {
        if (m.kind === 'pong' && hand.some((c) => sameTile(c, m.tiles[0]!))) {
          return 'bu_kong';
        }
      }
    }
    return null;
  },

  score(winner, source, _loser) {
    const base = 4;
    return { winner, source, baseScore: base, pattern: ['基础胡'] };
  },
};

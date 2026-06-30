/**
 * @file tiles.ts
 * 136 张牌的定义与工具。每张牌有稳定 id。
 * 前后端共用：服务端权威逻辑，前端渲染映射。
 */
import { z } from 'zod/v4';

// ─── 花色 & 点数 ─────────────────────────────────────

export type Suit = 'm' | 'p' | 's' | 'z';
export type TileRank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

// ─── Tile ────────────────────────────────────────────

export interface Tile {
  /** 稳定唯一 id，如 m1_0 / z3_2 。前后端均使用此 id 做 map key。 */
  id: string;
  suit: Suit;
  rank: TileRank;
}

const suitLabels: Record<Suit, string> = { m: '万', p: '筒', s: '条', z: '字' };
const honorLabels = ['东', '南', '西', '北', '中', '发', '白'];

export const tileSchema = z.object({
  id: z.string().min(1),
  suit: z.enum(['m', 'p', 's', 'z']),
  rank: z.union([
    z.literal(1), z.literal(2), z.literal(3),
    z.literal(4), z.literal(5), z.literal(6),
    z.literal(7), z.literal(8), z.literal(9),
  ]),
}) satisfies z.ZodType<Tile>;

/** 客户端出牌引用（不含 id，服务端自行查 id）。 */
export const tileRefSchema = z.object({
  suit: z.enum(['m', 'p', 's', 'z']),
  rank: z.union([
    z.literal(1), z.literal(2), z.literal(3),
    z.literal(4), z.literal(5), z.literal(6),
    z.literal(7), z.literal(8), z.literal(9),
  ]),
});

// ─── 构造 ────────────────────────────────────────────

let idCounter = 0;

/** 创建一个 Tile。id 为空时自动生成流水 id（仅调试用，生产应使用 fullDeck 的稳定 id）。 */
export function tile(suit: Suit, rank: TileRank, id?: string): Tile {
  return { id: id ?? `_auto_${idCounter++}`, suit, rank };
}

// ─── 显示 & 比较 ─────────────────────────────────────

/** 牌的可读名称（UI / 调试）。 */
export function tileName(t: Tile): string {
  if (t.suit === 'z') return honorLabels[t.rank - 1] ?? '?';
  return `${t.rank}${suitLabels[t.suit]}`;
}

/** 两张牌的牌种是否相同（按花色+点数，忽略 id）。 */
export function sameTile(a: Tile, b: Tile): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/** 稳定排序比较器：万 < 筒 < 条 < 字，同花色按点数。 */
export function compareTile(a: Tile, b: Tile): number {
  const order: Record<Suit, number> = { m: 0, p: 1, s: 2, z: 3 };
  if (a.suit !== b.suit) return order[a.suit] - order[b.suit];
  return a.rank - b.rank;
}

/** 牌的"种类"键：suit+rank，用于集合/Map/计数（跟具体 id 无关）。 */
export function tileKey(t: Tile): string {
  return `${t.suit}${t.rank}`;
}

// ─── 牌库 ────────────────────────────────────────────

/**
 * 一套牌的 id 前缀映射：
 *   m → W    (万)
 *   p → P    (筒)
 *   s → S    (条)
 *   z1→ E    (东)  z2→ S (南)  z3→ W (西)  z4→ N (北)
 *   z5→ F    (中)  z6→ G (发)  z7→ H (白)
 */
const idPrefix: Record<string, string> = {
  'm1': 'W1', 'm2': 'W2', 'm3': 'W3', 'm4': 'W4', 'm5': 'W5', 'm6': 'W6', 'm7': 'W7', 'm8': 'W8', 'm9': 'W9',
  'p1': 'P1', 'p2': 'P2', 'p3': 'P3', 'p4': 'P4', 'p5': 'P5', 'p6': 'P6', 'p7': 'P7', 'p8': 'P8', 'p9': 'P9',
  's1': 'S1', 's2': 'S2', 's3': 'S3', 's4': 'S4', 's5': 'S5', 's6': 'S6', 's7': 'S7', 's8': 'S8', 's9': 'S9',
  'z1': 'E',  'z2': 'N',  'z3': 'W',  'z4': 'N2', // 东 E, 南 N, 西 W, 北 N2(避免与万W冲突)
  'z5': 'F',  'z6': 'G',  'z7': 'H',
};

function makeId(suit: Suit, rank: TileRank, copy: number): string {
  const key = suit + String(rank);
  const prefix = idPrefix[key] ?? `${suit}${rank}`;
  return `${prefix}_${copy}`;
}

/** 生成全套 136 张牌（每种 4 张，稳定 id，无花牌）。 */
export function fullDeck(): Tile[] {
  const deck: Tile[] = [];
  const suits: Suit[] = ['m', 'p', 's'];

  for (const suit of suits) {
    for (let rank = 1 as TileRank; rank <= 9; rank = (rank + 1) as TileRank) {
      for (let copy = 0; copy < 4; copy++) {
        deck.push({ id: makeId(suit, rank, copy), suit, rank });
      }
    }
  }

  for (let rank = 1 as TileRank; rank <= 7; rank = (rank + 1) as TileRank) {
    for (let copy = 0; copy < 4; copy++) {
      deck.push({ id: makeId('z', rank, copy), suit: 'z', rank });
    }
  }

  return deck;
}

// ─── 洗牌 ────────────────────────────────────────────

/** Mulberry32 PRNG：给定 seed 产生确定性随机序列。 */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates 洗牌。seed 传入时结果可复现。 */
export function shuffleTiles(tiles: readonly Tile[], seed?: number): Tile[] {
  const arr = [...tiles];
  const rand = seed != null ? mulberry32(seed) : Math.random;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

// ─── 发牌 ────────────────────────────────────────────

export interface DealResult {
  /** 各玩家手牌（未排序），索引 0 为庄家。 */
  hands: Tile[][];
  /** 剩余牌墙（含岭上牌）。 */
  wall: Tile[];
}

/**
 * 模拟 4 人发牌：庄家 14 张，其余各 13 张。
 * tiles 应为洗过的牌序。
 */
export function dealInitialHands(tiles: readonly Tile[], playerCount = 4): DealResult {
  const hands: Tile[][] = Array.from({ length: playerCount }, () => []);
  let cursor = 0;

  // 每人 12 张（东→北，每次 4 张，共 3 轮）
  for (let round = 0; round < 3; round++) {
    for (let p = 0; p < playerCount; p++) {
      for (let i = 0; i < 4; i++) {
        hands[p]!.push(tiles[cursor++]!);
      }
    }
  }

  // 每人 1 张
  for (let p = 0; p < playerCount; p++) {
    hands[p]!.push(tiles[cursor++]!);
  }

  // 庄家多 1 张
  hands[0]!.push(tiles[cursor++]!);

  // 剩余为牌墙
  const wall = tiles.slice(cursor);

  return { hands, wall };
}

// ─── 排序 ────────────────────────────────────────────

/** 排序一组牌（不影响原数组），按 compareTile 升序。 */
export function sortTiles(tiles: readonly Tile[]): Tile[] {
  return [...tiles].sort(compareTile);
}
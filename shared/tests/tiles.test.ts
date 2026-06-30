import { describe, it, expect } from 'vitest';
import {
  fullDeck,
  shuffleTiles,
  dealInitialHands,
  sortTiles,
  tile,
  tileName,
  sameTile,
  compareTile,
  tileKey,
} from '../src/tiles.js';

describe('fullDeck', () => {
  it('returns 136 tiles', () => {
    expect(fullDeck()).toHaveLength(136);
  });

  it('each tile kind has exactly 4 copies', () => {
    const deck = fullDeck();
    const map = new Map<string, number>();
    for (const t of deck) {
      const k = tileKey(t);
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    // 34 种牌 × 4 = 136
    expect(map.size).toBe(34);
    for (const count of map.values()) {
      expect(count).toBe(4);
    }
  });

  it('every tile has a unique stable id', () => {
    const deck = fullDeck();
    const ids = new Set(deck.map((t) => t.id));
    expect(ids.size).toBe(136);

    // Verify id format (e.g., W1_0, E_2)
    for (const t of deck) {
      expect(t.id).toMatch(/^[A-Z0-9]+_\d$/);
    }
  });

  it('produces stable ids across calls', () => {
    const a = fullDeck();
    const b = fullDeck();
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
  });
});

describe('shuffleTiles', () => {
  it('same seed produces same order', () => {
    const deck = fullDeck();
    const a = shuffleTiles(deck, 42);
    const b = shuffleTiles(deck, 42);
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
  });

  it('different seed produces different order', () => {
    const deck = fullDeck();
    const a = shuffleTiles(deck, 1).map((t) => t.id).join(',');
    const b = shuffleTiles(deck, 99999).map((t) => t.id).join(',');
    expect(a).not.toBe(b);
  });

  it('does not mutate input', () => {
    const deck = fullDeck();
    const copy = [...deck];
    shuffleTiles(deck, 7);
    expect(deck.map((t) => t.id)).toEqual(copy.map((t) => t.id));
  });

  it('shuffled deck still has 136 unique tiles', () => {
    const deck = fullDeck();
    const shuffled = shuffleTiles(deck, 123);
    expect(shuffled).toHaveLength(136);
    const ids = new Set(shuffled.map((t) => t.id));
    expect(ids.size).toBe(136);
  });
});

describe('dealInitialHands', () => {
  it('dealer gets 14, others 13', () => {
    const deck = shuffleTiles(fullDeck(), 100);
    const { hands, wall } = dealInitialHands(deck);
    expect(hands).toHaveLength(4);
    expect(hands[0]).toHaveLength(14); // dealer
    expect(hands[1]).toHaveLength(13);
    expect(hands[2]).toHaveLength(13);
    expect(hands[3]).toHaveLength(13);
    // 136 - 14 - 3*13 = 83 remaining in wall
    expect(hands.flat().length + wall.length).toBe(136);
    expect(wall).toHaveLength(83);
  });

  it('all tiles in hands + wall are from the deck', () => {
    const deck = shuffleTiles(fullDeck(), 200);
    const { hands, wall } = dealInitialHands(deck);
    const deckIds = new Set(deck.map((t) => t.id));
    for (const t of [...hands.flat(), ...wall]) {
      expect(deckIds.has(t.id)).toBe(true);
    }
  });

  it('no duplicate tiles between hands', () => {
    const deck = shuffleTiles(fullDeck(), 300);
    const { hands } = dealInitialHands(deck);
    const allIds = hands.flat().map((t) => t.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('returns consistent results from same shuffled deck', () => {
    const deck = shuffleTiles(fullDeck(), 42);
    const a = dealInitialHands(deck);
    const b = dealInitialHands(deck);
    expect(a.hands.map((h) => h.map((t) => t.id))).toEqual(
      b.hands.map((h) => h.map((t) => t.id)),
    );
    expect(a.wall.map((t) => t.id)).toEqual(b.wall.map((t) => t.id));
  });
});

describe('sortTiles', () => {
  it('sorts by suit then rank', () => {
    const hand = [
      tile('z', 1),
      tile('p', 3),
      tile('m', 9),
      tile('m', 1),
    ];
    const sorted = sortTiles(hand);
    expect(sorted.map(tileName)).toEqual(['1万', '9万', '3筒', '东']);
  });

  it('does not mutate input', () => {
    const hand = [tile('z', 7), tile('m', 1)];
    const copy = [...hand];
    sortTiles(hand);
    expect(hand).toEqual(copy);
  });
});

describe('tile helpers', () => {
  it('tileName for m/p/s/z', () => {
    expect(tileName(tile('m', 1))).toBe('1万');
    expect(tileName(tile('p', 5))).toBe('5筒');
    expect(tileName(tile('s', 9))).toBe('9条');
    expect(tileName(tile('z', 1))).toBe('东');
    expect(tileName(tile('z', 7))).toBe('白');
  });

  it('sameTile', () => {
    const a = tile('m', 1);
    const b = tile('m', 1);
    const c = tile('m', 2);
    expect(sameTile(a, b)).toBe(true);
    expect(sameTile(a, c)).toBe(false);
    expect(sameTile(a, tile('p', 1))).toBe(false);
  });

  it('compareTile sorts by suit then rank', () => {
    const hand = [tile('z', 1), tile('p', 3), tile('m', 9), tile('m', 1)];
    hand.sort(compareTile);
    expect(hand.map(tileName)).toEqual(['1万', '9万', '3筒', '东']);
  });

  it('tileKey uses suit+rank only (ignores id)', () => {
    const a = tile('m', 1, 'custom_id');
    const b = tile('m', 1, 'other');
    expect(tileKey(a)).toBe('m1');
    expect(tileKey(a)).toBe(tileKey(b));
  });
});
/**
 * tile 牌组件 — 显示单张麻将牌。
 *
 * 属性：
 * - tile: { suit: 'm'|'p'|'s'|'z', rank: 1-9 } | null
 * - selected: 是否选中（上浮高亮）
 * - disabled: 是否不可点击
 * - small: 是否小尺寸（牌河用）
 * - faceDown: 是否扣置（仅显示背面）
 */
const suitLabels: Record<string, string> = { m: '万', p: '筒', s: '条', z: '字' };
const honorLabels = ['东', '南', '西', '北', '中', '发', '白'];

function tileDisplayName(tile: { suit: string; rank: number } | null): string {
  if (!tile) return '';
  if (tile.suit === 'z') return honorLabels[tile.rank - 1] ?? '?';
  return `${tile.rank}${suitLabels[tile.suit] ?? '?'}`;
}

Component({
  properties: {
    name: { type: String, value: '' },
    suit: { type: String, value: '' },
    rank: { type: Number, value: 0 },
    selected: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    small: { type: Boolean, value: false },
    faceDown: { type: Boolean, value: false },
  },

  observers: {
    'suit, rank'(suit: string, rank: number) {
      if (suit && rank > 0) {
        this.setData({ displayName: tileDisplayName({ suit, rank }) });
      }
    },
    name(name: string) {
      if (name && !this.data.displayName) {
        this.setData({ displayName: name });
      }
    },
  },

  data: {
    displayName: '',
  },
});

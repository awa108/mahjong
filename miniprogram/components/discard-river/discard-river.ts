/**
 * discard-river 弃牌河组件 — 每位玩家打出的牌按顺序展示为小牌。
 *
 * 属性：
 * - tiles: Tile[] — 该玩家已打出的牌
 */
Component({
  properties: {
    tiles: { type: Array, value: [] },
  },
});

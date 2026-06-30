/**
 * player-panel 玩家面板组件 — 显示昵称、座位、在线状态、手牌数、庄家标记。
 *
 * 属性：
 * - nickname: 玩家昵称
 * - seat: 座位号 0-3 (0=东, 1=南, 2=西, 3=北)
 * - score: 分数
 * - online: 是否在线
 * - concealedCount: 暗手牌数量（对不公开手牌数）
 * - isDealer: 是否庄家
 * - isTurn: 是否当前出牌人
 * - isMe: 是否本家
 */
const SEAT_NAMES = ['东', '南', '西', '北'];

Component({
  properties: {
    nickname: { type: String, value: '' },
    seat: { type: Number, value: 0 },
    score: { type: Number, value: 0 },
    ready: { type: Boolean, value: false },
    online: { type: Boolean, value: true },
    concealedCount: { type: Number, value: 0 },
    isDealer: { type: Boolean, value: false },
    isTurn: { type: Boolean, value: false },
    isMe: { type: Boolean, value: false },
  },

  observers: {
    seat(val: number) {
      this.setData({ seatName: SEAT_NAMES[val] ?? '?' });
    },
  },

  data: {
    seatName: '?',
  },
});

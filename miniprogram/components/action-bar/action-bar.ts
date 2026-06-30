/**
 * action-bar 操作栏组件 — 按钮完全由服务端 allowedActions 决定。
 *
 * 属性：
 * - allowedActions: string[] — 来自 PlayerViewState.allowedActions，如 ['PLAY_TILE']、['HU','GANG','PENG','CHI','PASS']
 * - loading: boolean — 是否正在等待服务端响应
 *
 * 事件：
 * - playtile: 出牌
 * - chi: 吃
 * - peng: 碰
 * - gang: 杠
 * - hu: 胡
 * - pass: 过
 */
const ACTION_BUTTONS: { action: string; label: string; class: string }[] = [
  { action: 'PLAY_TILE', label: '出牌', class: 'btn-play' },
  { action: 'DRAW_TILE', label: '摸牌', class: 'btn-draw' },
  { action: 'HU', label: '胡!', class: 'btn-hu' },
  { action: 'GANG', label: '杠', class: 'btn-gang' },
  { action: 'PENG', label: '碰', class: 'btn-peng' },
  { action: 'CHI', label: '吃', class: 'btn-chi' },
  { action: 'PASS', label: '过', class: 'btn-pass' },
];

Component({
  properties: {
    allowedActions: { type: Array, value: [] as string[] },
    loading: { type: Boolean, value: false },
  },

  data: {
    visibleButtons: [] as { action: string; label: string; class: string }[],
  },

  observers: {
    'allowedActions'(actions: string[]) {
      const visible = ACTION_BUTTONS.filter((b) => (actions ?? []).includes(b.action));
      this.setData({ visibleButtons: visible });
    },
  },

  methods: {
    onTap(e: WechatMiniprogram.TouchEvent) {
      const action = e.currentTarget.dataset.action as string;
      switch (action) {
        case 'PLAY_TILE': this.triggerEvent('playtile'); break;
        case 'DRAW_TILE': this.triggerEvent('drawtile'); break;
        case 'CHI': this.triggerEvent('chi'); break;
        case 'PENG': this.triggerEvent('peng'); break;
        case 'GANG': this.triggerEvent('gang'); break;
        case 'HU': this.triggerEvent('hu'); break;
        case 'PASS': this.triggerEvent('pass'); break;
      }
    },
  },
});

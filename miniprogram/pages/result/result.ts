/**
 * result 结算页 — 展示胜者、胡牌方式、分数变化、事件日志。
 *
 * 路由方式：game 页收到 ROUND_END 后 redirectTo 至此，
 * ROUND_END payload 通过全局 data（getApp().globalData.roundResult）传递。
 *
 * 页面功能：
 * 1. 展示胜者 / 流局结果
 * 2. 自摸/点炮方式
 * 3. 每位玩家分数变化
 * 4. 关键事件日志
 * 5. 返回房间 & 退出到大堂按钮
 */

interface ScoreRow {
  nickname: string;
  seat: number;
  seatLabel: string;
  score: number;
  delta: number;
  isWinner: boolean;
}

interface EventRow {
  type: string;
  seat: number;
  seatLabel: string;
  desc: string;
}

const SEAT_LABELS = ['东', '南', '西', '北'];
const EVENT_LABELS: Record<string, string> = {
  DEAL: '发牌',
  DRAW: '摸牌',
  PLAY: '出牌',
  CHI: '吃',
  PENG: '碰',
  MING_KONG: '明杠',
  AN_KONG: '暗杠',
  BU_KONG: '补杠',
  HU: '胡牌',
  PASS: '过',
  ROUND_END: '结束',
  DRAW_GAME: '流局',
};

Page({
  data: {
    reason: '' as string,
    winner: -1,
    winType: '' as string,
    scores: [] as ScoreRow[],
    events: [] as EventRow[],
  },

  onLoad() {
    const app = getApp<IAppOption>();
    const result = app.globalData.roundResult;
    if (!result) {
      wx.showToast({ title: '无结算数据', icon: 'none' });
      return;
    }

    const payload = result.payload;
    const reason = payload.reason;

    // 构建分数行
    const scoreRows: ScoreRow[] = [];
    for (let i = 0; i < 4; i++) {
      const delta = payload.scoreChanges?.[i] ?? 0;
      scoreRows.push({
        nickname: SEAT_LABELS[i]!,
        seat: i,
        seatLabel: SEAT_LABELS[i]!,
        score: payload.scores?.[i] ?? 0,
        delta,
        isWinner: payload.winner === i,
      });
    }

    // 按分数降序排列
    scoreRows.sort((a, b) => b.score - a.score);

    // 构建事件列表
    const eventRows: EventRow[] = (payload.events ?? []).map((e: any) => ({
      type: e.type,
      seat: e.seat,
      seatLabel: SEAT_LABELS[e.seat] ?? '?',
      desc: EVENT_LABELS[e.type] ?? e.type,
    }));

    let winTypeText = '';
    if (reason === 'win') {
      winTypeText = payload.winType === 'self' ? '自摸' : '点炮';
    }

    this.setData({
      reason,
      winner: payload.winner ?? -1,
      winType: winTypeText,
      scores: scoreRows,
      events: eventRows,
    });
  },

  // ── 按钮操作 ─────────────────────────────────────

  /** 返回房间：通知服务端再来一局（重新准备），回到 room 页。 */
  onBackToRoom() {
    // 清理结算结果
    getApp<IAppOption>().globalData.roundResult = null;
    wx.redirectTo({ url: '/pages/room/room' });
  },

  /** 退出到大堂。 */
  onExitToLobby() {
    getApp<IAppOption>().globalData.roundResult = null;
    wx.redirectTo({ url: '/pages/lobby/lobby' });
  },
});

interface IAppOption {
  globalData: {
    WS_BASE_URL: string;
    roundResult: any;
  };
}

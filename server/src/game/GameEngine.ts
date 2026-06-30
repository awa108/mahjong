/**
 * GameEngine — 权威麻将状态机。
 *
 * 客户端不可信原则：所有动作先校验，非法则拒绝并记录，不修改权威状态。
 * 摸牌由引擎自动触发（客户端不得请求 DRAW_TILE）。
 *
 * 状态流转：
 *   initGame → (draw→play→response)* → roundEnd
 *
 * 动作优先级（响应窗口内）：胡 > 杠/碰 > 吃
 */
import {
  type Tile, type Seat, type Room, type MeldKind,
  type GameState, type PlayerHand, type Meld, type ActionType,
  fullDeck, shuffleTiles, dealInitialHands, sortTiles,
  checkHu, canChi, canPeng, canMingGang, canAnGang, canBuGang,
  removeTile, removeTiles, sameTile, tileKey, tile,
  type HuResult, type ChiOption,
} from '@mahjong/shared';

// ─── 引擎内部类型 ───────────────────────────────────

export type TurnPhase = 'draw' | 'play' | 'response';

export interface Responder {
  seat: Seat;
  /** 该玩家在本次响应窗口中可做的动作。 */
  canHu: boolean;
  canMingGang: boolean;
  canPeng: boolean;
  canChi: boolean;
  /** 可用的胡/碰/杠 牌引用（仅服务端用）。 */
  huResult?: HuResult;
  gangResult?: { tiles?: Tile[] };
  pengResult?: { tiles?: Tile[] };
  chiOptions?: ChiOption[];
}

export interface GameEvent {
  seq: number;
  type: 'DEAL' | 'DRAW' | 'PLAY' | 'CHI' | 'PENG'
    | 'MING_KONG' | 'AN_KONG' | 'BU_KONG'
    | 'HU' | 'PASS' | 'ROUND_END' | 'DRAW_GAME';
  seat: Seat;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface ScoreEntry {
  seat: Seat;
  delta: number;
  reason: 'win_self' | 'win_discard' | 'lose_discard';
}

export interface ActionError {
  ok: false;
  code: string;
  msg: string;
}

export interface ActionResult {
  ok: true;
  events: GameEvent[];
}

export type ActionOutcome = ActionResult | ActionError;

// ─── GameEngine ─────────────────────────────────────

export class GameEngine {
  state!: GameState;
  private room!: Room;
  private eventLog: GameEvent[] = [];
  private eventCounter = 0;
  private _turnPhase: TurnPhase = 'draw';
  /** 已响应的座位集合（本轮响应窗口内）。 */
  private respondedSeats = new Set<Seat>();

  // ── 初始化 ──────────────────────────────────────

  /** 用预洗好的牌创建引擎（测试可控制牌序）。 */
  initGame(room: Room, preShuffledDeck?: Tile[]): GameEvent[] {
    this.room = room;
    this.eventLog = [];
    this.eventCounter = 0;
    this.respondedSeats = new Set();

    const dealer: Seat = 0;
    const deck = preShuffledDeck ?? shuffleTiles(fullDeck());
    const { hands: rawHands, wall } = dealInitialHands(deck, 4);

    const hands: PlayerHand[] = rawHands.map((concealed, i) => ({
      seat: i as Seat,
      concealed: sortTiles(concealed),
      melds: [],
      discards: [],
    }));

    this.state = {
      roundNo: 1,
      phase: 'playing',
      dealer,
      turn: dealer,
      allowedActions: ['PLAY_TILE'],
      hands,
      wall,
      deadWallIndex: 0,
      lastDiscard: null,
      lastDiscardBy: null,
      scores: { 0: 0, 1: 0, 2: 0, 3: 0 },
      eventSeq: 0,
    };

    this._turnPhase = 'play'; // 庄家 14 张，直接出牌
    this.eventLog = [];
    const dealEvent = this.emit('DEAL', dealer, {
      hands: rawHands.map((h) => h.map((t) => t.id)),
      wallLen: wall.length,
    });
    return [dealEvent];
  }

  // ── 状态查询 ────────────────────────────────────

  get turnPhase(): TurnPhase {
    return this._turnPhase;
  }

  get events(): readonly GameEvent[] {
    return this.eventLog;
  }

  /** 获取当前响应窗口中各玩家的可操作列表。 */
  getResponders(): Responder[] {
    if (this._turnPhase !== 'response' || !this.state.lastDiscard) return [];
    const discardTile = this.state.lastDiscard;
    const discardBy = this.state.lastDiscardBy!;

    return this.state.hands
      .filter((h) => h.seat !== discardBy)
      .map((h) => {
        const huResult = checkHu([...h.concealed, discardTile]);
        const mingGang = canMingGang(h.concealed, discardTile);
        const peng = canPeng(h.concealed, discardTile);
        const chi = canChi(h.concealed, discardTile, h.seat, discardBy);

        return {
          seat: h.seat,
          canHu: huResult.canHu,
          canMingGang: mingGang.canGang,
          canPeng: peng.canPeng,
          canChi: chi.canChi,
          huResult: huResult.canHu ? huResult : undefined,
          gangResult: mingGang.canGang ? mingGang : undefined,
          pengResult: peng.canPeng ? peng : undefined,
          chiOptions: chi.canChi ? chi.options : undefined,
        };
      });
  }

  /** 获取某玩家的手牌（供测试/视图用）。 */
  getHand(seat: Seat): PlayerHand | undefined {
    return this.state.hands.find((h) => h.seat === seat);
  }

  /** 获取当前状态快照（含事件日志的浅拷贝供 ROUND_END）。 */
  getState(): GameState {
    return structuredClone(this.state);
  }

  /** 获取事件日志摘要（不含详细 data，用于 ROUND_END 消息）。 */
  getEventSummary(): { type: string; seat: Seat; timestamp: number }[] {
    return this.eventLog.map((e) => ({
      type: e.type,
      seat: e.seat,
      timestamp: e.timestamp,
    }));
  }

  /** 测试用：直接替换手牌和牌墙（修改权威状态）。 */
  _setHands(hands: Tile[][]): void {
    for (let i = 0; i < 4; i++) {
      if (hands[i]) this.state.hands[i]!.concealed = sortTiles(hands[i]!);
    }
  }

  _setWall(tiles: Tile[]): void {
    this.state.wall = [...tiles];
  }

  // ── 动作处理 ────────────────────────────────────

  /** 出牌。当前玩家，手牌中存在。 */
  playTile(playerId: string, seat: Seat, discardTile: Tile): ActionOutcome {
    if (this.state.phase !== 'playing') {
      return this.fail('WRONG_PHASE', this.state.phase === 'settled' ? '对局已结束' : '当前不是对局阶段');
    }
    if (seat !== this.state.turn) {
      return this.fail('NOT_YOUR_TURN', `当前是 seat=${this.state.turn} 的回合`);
    }
    if (this._turnPhase !== 'play') {
      return this.fail('WRONG_PHASE', '当前不是出牌阶段');
    }

    const hand = this.state.hands[seat]!;
    const removed = removeTile(hand.concealed, discardTile);
    if (!removed) {
      return this.fail('ILLEGAL_ACTION', `手牌中无 ${discardTile.suit}${discardTile.rank}`);
    }

    hand.concealed = sortTiles(removed);
    hand.discards = [...hand.discards, discardTile];

    this.state.lastDiscard = discardTile;
    this.state.lastDiscardBy = seat;
    this._turnPhase = 'response';
    this.respondedSeats = new Set([seat]); // 出牌者自动视为已响应

    // 检查是否有玩家可以胡/碰/杠/吃
    const responders = this.getResponders();
    const hasResponse = responders.some(
      (r) => r.canHu || r.canMingGang || r.canPeng || r.canChi,
    );

    if (!hasResponse) {
      // 无人可响应，自动跳过响应窗口
      return this.advanceAfterDiscard();
    }

    this.state.allowedActions = this.buildResponseActions(responders) as unknown as ActionType[];
    const ev = this.emit('PLAY', seat, {
      tileId: discardTile.id,
      suit: discardTile.suit,
      rank: discardTile.rank,
    });
    return { ok: true, events: [ev] };
  }

  /** 碰牌。响应窗口内合法操作。 */
  peng(playerId: string, seat: Seat): ActionOutcome {
    if (this.state.phase === 'settled') {
      return this.fail('WRONG_PHASE', '对局已结束');
    }
    if (this._turnPhase !== 'response') {
      return this.fail('WRONG_PHASE', '当前不是响应窗口');
    }
    if (this.respondedSeats.has(seat)) {
      return this.fail('ILLEGAL_ACTION', '你已响应过');
    }
    if (!this.state.lastDiscard || this.state.lastDiscardBy == null) {
      return this.fail('INTERNAL', '无待响应弃牌');
    }

    const hand = this.state.hands[seat]!;
    const result = canPeng(hand.concealed, this.state.lastDiscard);
    if (!result.canPeng || !result.tiles) {
      return this.fail('ILLEGAL_ACTION', '无法碰此牌');
    }

    // 检查高优先级动作：有人可胡则不能碰（引擎不做自动裁决，客户端不应发起；这里作为防护）
    const responders = this.getResponders();
    const hasHu = responders.some((r) => r.canHu && r.seat !== seat);
    if (hasHu) {
      return this.fail('ILLEGAL_ACTION', '有人可胡，需等待胡判定');
    }

    // 移除手牌中的两张
    const after = removeTiles(hand.concealed, result.tiles);
    if (!after) return this.fail('INTERNAL', '碰牌移除手牌失败');
    hand.concealed = sortTiles(after);

    // 副露：3 张（2 手牌 + 1 弃牌）
    const meld: Meld = {
      kind: 'pong',
      tiles: [...result.tiles, this.state.lastDiscard],
      from: this.state.lastDiscardBy!,
    };
    hand.melds = [...hand.melds, meld];

    // 清除弃牌状态
    this.state.lastDiscard = null;
    this.state.lastDiscardBy = null;
    this.state.turn = seat;
    this._turnPhase = 'play';
    this.respondedSeats = new Set();
    this.state.allowedActions = ['PLAY_TILE'];

    const ev = this.emit('PENG', seat, { meld: meld.tiles.map((t) => t.id) });
    return { ok: true, events: [ev] };
  }

  /** 吃牌（仅下家，含座位校验在 canChi 中做）。响应窗口内合法操作。 */
  chi(playerId: string, seat: Seat, chiLow: Tile): ActionOutcome {
    if (this.state.phase === 'settled') {
      return this.fail('WRONG_PHASE', '对局已结束');
    }
    if (this._turnPhase !== 'response') {
      return this.fail('WRONG_PHASE', '当前不是响应窗口');
    }
    if (this.respondedSeats.has(seat)) {
      return this.fail('ILLEGAL_ACTION', '你已响应过');
    }
    if (!this.state.lastDiscard || this.state.lastDiscardBy == null) {
      return this.fail('INTERNAL', '无待响应弃牌');
    }

    const hand = this.state.hands[seat]!;
    const result = canChi(hand.concealed, this.state.lastDiscard, seat, this.state.lastDiscardBy);
    if (!result.canChi) {
      return this.fail('ILLEGAL_ACTION', '无法吃此牌');
    }

    // 找到匹配的吃牌选项
    const option = result.options.find((o) =>
      sameTile(o.chiLow, chiLow) ||
      (o.tiles[0] && sameTile(o.tiles[0], chiLow)),
    );
    if (!option) {
      return this.fail('ILLEGAL_ACTION', `没有 chiLow=${chiLow.suit}${chiLow.rank} 的吃牌组合`);
    }

    // 检查高优先级动作
    const responders = this.getResponders();
    const blocked = responders.some(
      (r) => r.seat !== seat && (r.canHu || r.canMingGang || r.canPeng),
    );
    if (blocked) {
      return this.fail('ILLEGAL_ACTION', '有更高优先级动作等待');
    }

    const after = removeTiles(hand.concealed, option.tiles);
    if (!after) return this.fail('INTERNAL', '吃牌移除手牌失败');
    hand.concealed = sortTiles(after);

    const meld: Meld = {
      kind: 'chi',
      tiles: sortTiles([...option.tiles, this.state.lastDiscard]),
      from: this.state.lastDiscardBy,
    };
    hand.melds = [...hand.melds, meld];

    this.state.lastDiscard = null;
    this.state.lastDiscardBy = null;
    this.state.turn = seat;
    this._turnPhase = 'play';
    this.respondedSeats = new Set();
    this.state.allowedActions = ['PLAY_TILE'];

    const ev = this.emit('CHI', seat, { meld: meld.tiles.map((t) => t.id) });
    return { ok: true, events: [ev] };
  }

  /** 杠牌：明杠/暗杠/补杠。 */
  gang(playerId: string, seat: Seat, gangKind: MeldKind, gangTile?: Tile): ActionOutcome {
    if (this.state.phase === 'settled') {
      return this.fail('WRONG_PHASE', '对局已结束');
    }
    const hand = this.state.hands[seat]!;

    if (gangKind === 'ming_kong') {
      return this.mingKong(seat, hand);
    }
    if (gangKind === 'an_kong') {
      return this.anKong(seat, hand);
    }
    if (gangKind === 'bu_kong') {
      return this.buKong(seat, hand, gangTile);
    }
    return this.fail('ILLEGAL_ACTION', `未知杠类型: ${gangKind}`);
  }

  private mingKong(seat: Seat, hand: PlayerHand): ActionOutcome {
    if (this._turnPhase !== 'response') {
      return this.fail('WRONG_PHASE', '明杠仅在响应窗口可用');
    }
    if (this.respondedSeats.has(seat)) {
      return this.fail('ILLEGAL_ACTION', '你已响应过');
    }
    if (!this.state.lastDiscard || this.state.lastDiscardBy == null) {
      return this.fail('INTERNAL', '无待响应弃牌');
    }

    // 检查更高优先级
    const responders = this.getResponders();
    if (responders.some((r) => r.seat !== seat && r.canHu)) {
      return this.fail('ILLEGAL_ACTION', '有人可胡，需等待胡判定');
    }

    const result = canMingGang(hand.concealed, this.state.lastDiscard);
    if (!result.canGang || !result.tiles) {
      return this.fail('ILLEGAL_ACTION', '无法明杠此牌');
    }

    const after = removeTiles(hand.concealed, result.tiles);
    if (!after) return this.fail('INTERNAL', '明杠移除手牌失败');
    hand.concealed = sortTiles(after);

    const meld: Meld = {
      kind: 'ming_kong',
      tiles: [...result.tiles, this.state.lastDiscard],
      from: this.state.lastDiscardBy!,
    };
    hand.melds = [...hand.melds, meld];

    this.state.lastDiscard = null;
    this.state.lastDiscardBy = null;
    this.state.turn = seat;
    this._turnPhase = 'play';
    this.respondedSeats = new Set();

    // 杠后补牌
    const drawEvents = this.drawTile(seat);
    const gangEv = this.emit('MING_KONG', seat, {
      meld: meld.tiles.map((t) => t.id),
    });
    this.state.allowedActions = ['PLAY_TILE'];
    return { ok: true, events: [gangEv, ...drawEvents] };
  }

  private anKong(seat: Seat, hand: PlayerHand): ActionOutcome {
    if (this._turnPhase !== 'play' || seat !== this.state.turn) {
      return this.fail('WRONG_PHASE', '暗杠仅在自己的出牌回合可用');
    }

    const result = canAnGang(hand.concealed);
    if (!result.canGang || !result.tiles) {
      return this.fail('ILLEGAL_ACTION', '无法暗杠');
    }

    const after = removeTiles(hand.concealed, result.tiles);
    if (!after) return this.fail('INTERNAL', '暗杠移除手牌失败');
    hand.concealed = sortTiles(after);

    const meld: Meld = {
      kind: 'an_kong',
      tiles: result.tiles,
      from: null,
    };
    hand.melds = [...hand.melds, meld];

    // 杠后补牌
    const drawEvents = this.drawTile(seat);
    const gangEv = this.emit('AN_KONG', seat, {
      meld: meld.tiles.map((t) => t.id),
    });
    this.state.allowedActions = ['PLAY_TILE'];
    return { ok: true, events: [gangEv, ...drawEvents] };
  }

  private buKong(seat: Seat, hand: PlayerHand, gangTile?: Tile): ActionOutcome {
    if (this._turnPhase !== 'play' || seat !== this.state.turn) {
      return this.fail('WRONG_PHASE', '补杠仅在自己的出牌回合可用');
    }

    const result = canBuGang(hand.concealed, hand.melds, gangTile);
    if (!result.canGang || !result.tile) {
      return this.fail('ILLEGAL_ACTION', '无法补杠');
    }

    // 找到对应的碰副露
    const pongMeld = hand.melds.find(
      (m) => m.kind === 'pong' && sameTile(m.tiles[0]!, result.tile!),
    );
    if (!pongMeld) return this.fail('INTERNAL', '找不到对应碰副露');

    // 从手牌移除该牌
    const after = removeTile(hand.concealed, result.tile);
    if (!after) return this.fail('INTERNAL', '补杠移除手牌失败');
    hand.concealed = sortTiles(after);

    // 将碰升级为杠
    pongMeld.kind = 'bu_kong';
    pongMeld.tiles = [...pongMeld.tiles, result.tile];

    // 杠后补牌
    const drawEvents = this.drawTile(seat);
    const gangEv = this.emit('BU_KONG', seat, {
      meld: pongMeld.tiles.map((t) => t.id),
    });
    this.state.allowedActions = ['PLAY_TILE'];
    return { ok: true, events: [gangEv, ...drawEvents] };
  }

  /** 胡牌：响应窗口内点炮。 */
  hu(playerId: string, seat: Seat): ActionOutcome {
    if (this.state.phase === 'settled') {
      return this.fail('WRONG_PHASE', '对局已结束');
    }
    const hand = this.state.hands[seat]!;

    if (this._turnPhase === 'response') {
      // 点炮胡
      if (this.respondedSeats.has(seat)) {
        return this.fail('ILLEGAL_ACTION', '你已响应过');
      }
      if (!this.state.lastDiscard || this.state.lastDiscardBy == null) {
        return this.fail('INTERNAL', '无待响应弃牌');
      }
      const huResult = checkHu([...hand.concealed, this.state.lastDiscard]);
      if (!huResult.canHu) {
        return this.fail('ILLEGAL_ACTION', '手牌未满足胡牌条件');
      }
      return this.doHu(seat, 'discard', this.state.lastDiscardBy, huResult);
    }

    if (this._turnPhase === 'play' && seat === this.state.turn) {
      // 自摸胡
      if (hand.concealed.length !== 14) {
        return this.fail('ILLEGAL_ACTION', '自摸时手牌必须为 14 张');
      }
      const huResult = checkHu(hand.concealed);
      if (!huResult.canHu) {
        return this.fail('ILLEGAL_ACTION', '手牌未满足胡牌条件');
      }
      return this.doHu(seat, 'self', null, huResult);
    }

    return this.fail('WRONG_PHASE', '当前不可胡牌');
  }

  private doHu(seat: Seat, source: 'self' | 'discard', from: Seat | null, huResult: HuResult): ActionOutcome {
    this.state.phase = 'settled';
    this._turnPhase = 'play';
    this.respondedSeats = new Set();
    this.state.allowedActions = [];

    const ev = this.emit('HU', seat, {
      source,
      from,
      pattern: huResult.pattern,
      pair: huResult.pair,
    });

    // 计分：自摸胡赢家 +3，其余各 -1; 点炮胡赢家 +3，放炮者 -3
    const MIN_SCORE = 1;
    if (source === 'self') {
      for (let i = 0; i < 4; i++) {
        const s = i as Seat;
        this.state.scores[s] = (this.state.scores[s] ?? 0) + (s === seat ? 3 * MIN_SCORE : -1 * MIN_SCORE);
      }
    } else {
      this.state.scores[seat] = (this.state.scores[seat] ?? 0) + 3 * MIN_SCORE;
      if (from != null) {
        this.state.scores[from] = (this.state.scores[from] ?? 0) - 3 * MIN_SCORE;
      }
    }

    const endEv = this.emit('ROUND_END', seat, { reason: 'win', winner: seat, source });
    return { ok: true, events: [ev, endEv] };
  }

  /** 过：放弃响应窗口内的动作。 */
  pass(playerId: string, seat: Seat): ActionOutcome {
    if (this.state.phase === 'settled') {
      return this.fail('WRONG_PHASE', '对局已结束');
    }
    if (this._turnPhase !== 'response') {
      return this.fail('WRONG_PHASE', '当前不是响应窗口');
    }
    if (this.respondedSeats.has(seat)) return this.fail('ILLEGAL_ACTION', '你已响应过');
    this.respondedSeats.add(seat);
    this.emit('PASS', seat, {});

    // 三位其他玩家都 PASS 后，推进到下一回合
    const nonDiscarderCount = this.state.hands.filter(
      (h) => h.seat !== this.state.lastDiscardBy,
    ).length;
    if (this.respondedSeats.size >= nonDiscarderCount + 1) {
      return this.advanceAfterDiscard();
    }

    return { ok: true, events: [] };
  }

  // ── 内部逻辑 ────────────────────────────────────

  /** 弃牌后无人响应，进入下一玩家摸牌阶段。 */
  private advanceAfterDiscard(): ActionOutcome {
    this.state.lastDiscard = null;
    this.state.lastDiscardBy = null;
    this.respondedSeats = new Set();

    // 检查牌墙是否耗尽
    if (this.state.wall.length === 0) {
      return this.doDrawGame();
    }

    // 下一玩家
    const nextSeat = ((this.state.turn + 1) % 4) as Seat;
    this.state.turn = nextSeat;
    this._turnPhase = 'draw';

    const drawEvents = this.drawTile(nextSeat);
    this._turnPhase = 'play';
    this.state.allowedActions = ['PLAY_TILE'];
    return { ok: true, events: drawEvents };
  }

  /** 摸牌：从牌墙摸一张加入手牌。 */
  private drawTile(seat: Seat): GameEvent[] {
    const hand = this.state.hands[seat]!;
    const tile = this.state.wall.shift();
    if (!tile) return [];

    hand.concealed = sortTiles([...hand.concealed, tile]);
    const ev = this.emit('DRAW', seat, {
      tileId: tile.id,
      wallRemaining: this.state.wall.length,
    });
    return [ev];
  }

  /** 流局。 */
  private doDrawGame(): ActionOutcome {
    this.state.phase = 'settled';
    this._turnPhase = 'play';
    this.respondedSeats = new Set();
    this.state.allowedActions = [];
    // 流局：所有玩家分数不变
    const ev = this.emit('DRAW_GAME', this.state.turn, { wallRemaining: 0 });
    const endEv = this.emit('ROUND_END', this.state.turn, { reason: 'draw' });
    return { ok: true, events: [ev, endEv] };
  }

  /** 构建响应窗口的 allowedActions 列表。 */
  private buildResponseActions(responders: Responder[]): string[] {
    const actions: string[] = [];
    const hasHu = responders.some((r) => r.canHu);
    const hasGang = responders.some((r) => r.canMingGang);
    const hasPeng = responders.some((r) => r.canPeng);
    const hasChi = responders.some((r) => r.canChi);

    if (hasHu) actions.push('HU');
    if (hasGang) actions.push('GANG');
    if (hasPeng) actions.push('PENG');
    if (hasChi) actions.push('CHI');
    actions.push('PASS');
    return actions;
  }

  // ── 事件日志 ────────────────────────────────────

  private emit(type: GameEvent['type'], seat: Seat, data?: Record<string, unknown>): GameEvent {
    const seq = ++this.eventCounter;
    this.state.eventSeq = seq;
    const ev: GameEvent = { seq, type, seat, timestamp: Date.now(), data };
    this.eventLog.push(ev);
    return ev;
  }

  private fail(code: string, msg: string): ActionError {
    return { ok: false, code, msg };
  }
}

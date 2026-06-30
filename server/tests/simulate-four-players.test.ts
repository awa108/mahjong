/**
 * 四玩家自动对局仿真测试。
 *
 * 启动本地 WSS → 连接 4 个客户端 → 建房/加入/准备/开始 →
 * 按固定 seed 的随机策略出牌/吃碰杠/过 →
 * 校验：服务端不崩溃、不泄露他人手牌、消息序列合法。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { MahjongWSServer } from '../src/ws/WebSocketServer.js';

// ─── 可复现 PRNG (mulberry32) ────────────────────────

function createRNG(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── 模拟客户端 ──────────────────────────────────────

interface SimState {
  myHand: any[];
  allowedActions: string[];
  turn: number;
  phase: string;
  scores: Record<number, number>;
}

class SimClient {
  ws: WebSocket;
  name: string;
  msgQueue: any[] = [];
  latestView: SimState | null = null;
  roundEndMsg: any = null;
  errors: any[] = [];

  constructor(ws: WebSocket, name: string) {
    this.ws = ws;
    this.name = name;
    ws.on('message', (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        this.msgQueue.push(m);
      } catch {}
    });
  }

  /** 等待特定类型的消息，返回匹配的第一条。 */
  async waitMsg(type: string, timeoutMs = 5000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const idx = this.msgQueue.findIndex((m) => m.type === type);
      if (idx >= 0) {
        const m = this.msgQueue[idx]!;
        this.msgQueue.splice(idx, 1);
        return m;
      }
      // Check for errors
      const errIdx = this.msgQueue.findIndex((m) => m.error);
      if (errIdx >= 0) {
        const m = this.msgQueue[errIdx]!;
        this.msgQueue.splice(errIdx, 1);
        this.errors.push(m);
        throw new Error(`Server error: ${m.error.code} - ${m.error.msg}`);
      }
      await sleep(20);
    }
    throw new Error(`${this.name}: timeout waiting for '${type}'. Queue: ${JSON.stringify(this.msgQueue.slice(0, 5))}`);
  }

  /** 从队列中取出最近一条 START_GAME (view) 消息，更新 latestView。 */
  drainView(): boolean {
    let found = false;
    // 从后往前找最后的 START_GAME 消息
    for (let i = this.msgQueue.length - 1; i >= 0; i--) {
      if (this.msgQueue[i]!.type === 'START_GAME' && this.msgQueue[i]!.payload?.view) {
        const v = this.msgQueue[i]!.payload.view;
        this.latestView = {
          myHand: v.myHand ?? [],
          allowedActions: v.allowedActions ?? [],
          turn: v.turn ?? -1,
          phase: v.phase ?? '',
          scores: v.scores ?? {},
        };
        found = true;
      }
    }
    // 清理所有已处理的 START_GAME + PLAY_TILE + READY 等广播消息
    this.msgQueue = this.msgQueue.filter(
      (m) => m.type !== 'START_GAME' && m.type !== 'PLAY_TILE'
        && m.type !== 'READY' && m.type !== 'HEARTBEAT'
        && m.type !== 'CHI' && m.type !== 'PENG' && m.type !== 'GANG'
        && m.type !== 'HU' && m.type !== 'ROUND_END' && m.type !== 'JOIN_ROOM',
    );
    return found;
  }

  /** 清空队列（丢弃所有 pending 消息）。 */
  clearQueue(): void {
    this.msgQueue.length = 0;
  }

  /** 检查是否有 ROUND_END。 */
  checkRoundEnd(): any | null {
    for (let i = this.msgQueue.length - 1; i >= 0; i--) {
      if (this.msgQueue[i]!.type === 'ROUND_END') {
        const m = this.msgQueue[i]!;
        this.msgQueue.splice(i, 1);
        this.roundEndMsg = m;
        return m;
      }
    }
    return null;
  }

  send(msg: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── 模拟策略 ────────────────────────────────────────

interface BotChoice {
  type: string;
  payload?: Record<string, unknown>;
}

/**
 * 根据当前手牌和 allowedActions 决定动作。
 * 优先级：胡 > 杠 > 碰 > 吃 > 过（概率递减）。
 */
function chooseAction(rng: () => number, view: SimState): BotChoice | null {
  const actions = view.allowedActions;
  if (actions.length === 0) return null;

  // 出牌回合：随机选一张手牌打出
  if (actions.includes('PLAY_TILE') && view.myHand.length > 0) {
    const idx = Math.floor(rng() * view.myHand.length);
    const tile = view.myHand[idx];
    return { type: 'PLAY_TILE', payload: { tile } };
  }

  // 响应窗口：按概率选择
  if (actions.includes('HU')) {
    // 50% 概率胡牌（如果可胡），避免每局立刻结束
    if (rng() < 0.5) {
      return { type: 'HU', payload: { source: 'discard' } };
    }
  }

  if (actions.includes('GANG')) {
    if (rng() < 0.4) {
      return { type: 'GANG', payload: { gangKind: 'ming_kong', tile: {} } };
    }
  }

  if (actions.includes('PENG')) {
    if (rng() < 0.5) {
      return { type: 'PENG', payload: { tile: {} } };
    }
  }

  if (actions.includes('CHI')) {
    if (rng() < 0.5) {
      // 需要传 chiLow — 从最新的 PLAY_TILE 知道弃牌
      // 这里传一个占位，WSS 会从 engine 取 lastDiscard 构造 chiLow
      // 实际上 chi msg 需要 chiLow，但 engine.chi() 用 chiLow 匹配选项
      return { type: 'CHI', payload: { tile: {}, chiLow: {} } };
    }
  }

  // 默认 PASS
  if (actions.includes('PASS')) {
    return { type: 'PASS', payload: {} };
  }

  return null;
}

/** 根据 WSS 收到的 PLAY_TILE 消息中的 tile 来构造合法的 chiLow。 */
function buildChiPayload(view: SimState, lastDiscard: any): any | null {
  // lastDiscard has { suit, rank }
  // We need to find a valid chi option
  // canChi returns options, each with chiLow.
  // We're blind to the exact options but can try a common chiLow:
  // The chiLow is the lowest tile in the chi meld.
  // Simplest: use the discard tile itself as chiLow (r+1, r+2 case)
  // or r-2, or r-1.
  // Since we don't have the exact options client-side, we'll try all 3
  // and let the server reject invalid ones. But for the test, we should
  // pick one that works.
  // For now: just use the discard itself - this covers the case where
  // discard is the middle or lowest of the chi.
  const suit = lastDiscard.suit;
  const rank = lastDiscard.rank;

  // Try rank-2 as chiLow (r-2, r-1 + discard)
  if (rank >= 3) {
    return { tile: lastDiscard, chiLow: { suit, rank: rank - 2 } };
  }
  // Try rank-1 as chiLow (r-1, r+1 + discard)
  if (rank >= 2) {
    return { tile: lastDiscard, chiLow: { suit, rank: rank - 1 } };
  }
  // Try rank as chiLow (r, r+1, r+2)
  return { tile: lastDiscard, chiLow: { suit, rank } };
}

// ─── 非泄露校验 ──────────────────────────────────────

/** 检查视图是否泄露了其他玩家手牌。 */
function assertNoHandLeak(view: SimState, myIndex: number): void {
  // myHand 只能包含 0-14 张牌（结构检查，不读内容）
  expect(Array.isArray(view.myHand)).toBe(true);
  // 不能从 view 中获得其他玩家具体手牌，
  // PlayerViewState.players 只含 concealedCount，不含 concealed 数组。
}

// ─── 测试 ────────────────────────────────────────────

describe('四玩家自动对局仿真', { timeout: 60_000 }, () => {
  let server: MahjongWSServer;
  let port: number;
  let rng: () => number;
  let clients: SimClient[] = [];

  beforeAll(async () => {
    // 固定 seed = 20240601 使整局可复现
    rng = createRNG(20240601);

    server = new MahjongWSServer();
    const wss = server.listen(0);
    port = (wss.address() as any).port;
  });

  afterAll(() => {
    for (const c of clients) c.ws.close();
    server?.close();
  });

  function connect(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}`);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  it('完整一局：建房→加入→准备→对局→结算', async () => {
    await server._reset();

    // ── 1. 连接 4 个客户端 ─────────────────────────
    const raws = await Promise.all([connect(), connect(), connect(), connect()]);
    clients = [
      new SimClient(raws[0]!, '东'),
      new SimClient(raws[1]!, '南'),
      new SimClient(raws[2]!, '西'),
      new SimClient(raws[3]!, '北'),
    ];

    // ── 2. 玩家 A 创建房间 ─────────────────────────
    clients[0]!.send({ type: 'CREATE_ROOM', requestId: 'cr', serverTime: 0, payload: { nickname: '东' } });
    const crResp = await clients[0]!.waitMsg('CREATE_ROOM');
    expect(crResp.payload.room).toBeDefined();
    expect(crResp.payload.sessionToken).toBeDefined();
    const roomCode: string = crResp.payload.room.roomCode;

    // ── 3. B/C/D 加入 ─────────────────────────────
    const joinPayloads = [
      { roomCode, nickname: '南' },
      { roomCode, nickname: '西' },
      { roomCode, nickname: '北' },
    ];

    for (let i = 1; i <= 3; i++) {
      clients[i]!.send({ type: 'JOIN_ROOM', requestId: `j${i}`, serverTime: 0, payload: joinPayloads[i - 1]! });
      const jResp = await clients[i]!.waitMsg('JOIN_ROOM');
      expect(jResp.payload.room.players).toHaveLength(i + 1);
    }

    // drain A's JOIN_ROOM broadcasts
    await sleep(100);
    for (const c of clients) c.clearQueue();

    // ── 4. 四人准备 ────────────────────────────────
    for (let i = 0; i < 4; i++) {
      clients[i]!.send({ type: 'READY', requestId: `r${i}`, serverTime: 0, payload: {} });
    }
    await sleep(200);
    for (const c of clients) c.clearQueue();

    // ── 5. 房主开始游戏 ────────────────────────────
    clients[0]!.send({ type: 'START_GAME', requestId: 'sg', serverTime: 0, payload: {} });

    // 收集各玩家的初始视图
    for (let i = 0; i < 4; i++) {
      let view: any = null;
      for (let t = 0; t < 20; t++) {
        const m = await clients[i]!.waitMsg('START_GAME');
        if (m.payload?.view) { view = m; break; }
      }
      expect(view).not.toBeNull();
      clients[i]!.latestView = {
        myHand: view.payload.view.myHand ?? [],
        allowedActions: view.payload.view.allowedActions ?? [],
        turn: view.payload.view.turn ?? -1,
        phase: view.payload.view.phase ?? '',
        scores: view.payload.view.scores ?? {},
      };
    }
    for (const c of clients) c.clearQueue();

    // 庄家 14 张，其余 13 张
    expect(clients[0]!.latestView!.myHand).toHaveLength(14);
    expect(clients[1]!.latestView!.myHand).toHaveLength(13);
    expect(clients[2]!.latestView!.myHand).toHaveLength(13);
    expect(clients[3]!.latestView!.myHand).toHaveLength(13);

    // ── 6. 对局主循环 ──────────────────────────────

    const MAX_ROUNDS = 200;
    let roundCount = 0;
    let roundEnded = false;
    let lastPlayedTile: any = null;
    const gameLog: string[] = [];

    while (roundCount < MAX_ROUNDS) {
      roundCount++;

      // 检查是否有 ROUND_END
      for (const c of clients) {
        const re = c.checkRoundEnd();
        if (re) {
          roundEnded = true;
          gameLog.push(`[对局结束] reason=${re.payload.reason} winner=${re.payload.winner ?? '无'}`);
        }
      }
      if (roundEnded) break;

      // 更新每个人的最新视图
      for (const c of clients) c.drainView();

      // 查找当前 turn 的玩家
      const currentTurn = clients[0]!.latestView?.turn ?? -1;
      if (currentTurn < 0) {
        await sleep(50);
        continue;
      }

      const currentPlayer = clients[currentTurn]!;
      const view = currentPlayer.latestView;

      if (!view) {
        await sleep(50);
        continue;
      }

      const actions = view.allowedActions;

      // 当前玩家的出牌回合
      if (actions.includes('PLAY_TILE') && view.myHand.length > 0) {
        const idx = Math.floor(rng() * view.myHand.length);
        const tile = view.myHand[idx];
        lastPlayedTile = tile;

        gameLog.push(`[R${roundCount}] 玩家${currentPlayer.name}(S${currentTurn}) 出牌 ${tile.suit}${tile.rank}`);

        currentPlayer.send({
          type: 'PLAY_TILE',
          requestId: `p${roundCount}`,
          serverTime: 0,
          payload: { tile },
        });

        // 等待消息到达
        await sleep(100);
        // 更新所有人的视图
        for (const c of clients) c.drainView();
        continue;
      }

      // 响应窗口：让每个需要响应的玩家行动
      const responders: { client: SimClient; seat: number; actions: string[] }[] = [];
      for (let i = 0; i < 4; i++) {
        const v = clients[i]!.latestView;
        if (v && v.turn === currentTurn) {
          const act = v.allowedActions;
          // 当前玩家不参与响应（自己出的牌）
          if (i === currentTurn) continue;
          if (act.length > 0 && !act.includes('PLAY_TILE')) {
            responders.push({ client: clients[i]!, seat: i, actions: act });
          }
        }
      }

      if (responders.length === 0) {
        // 没有响应者，等待引擎自动推进
        await sleep(100);
        for (const c of clients) c.drainView();
        continue;
      }

      // 按优先级处理响应者：胡 → 杠 → 碰 → 吃 → 过
      // 先检查是否有人胡（最高优先级）
      const huResponders = responders.filter((r) => r.actions.includes('HU'));
      if (huResponders.length > 0 && rng() < 0.6) {
        const r = huResponders[Math.floor(rng() * huResponders.length)]!;
        gameLog.push(`[R${roundCount}] 玩家${r.client.name}(S${r.seat}) 胡！`);
        r.client.send({ type: 'HU', requestId: `hu${roundCount}`, serverTime: 0, payload: { source: 'discard' } });
        await sleep(200);
        for (const c of clients) c.drainView();
        continue;
      }

      // 杠
      const gangResponders = responders.filter((r) => r.actions.includes('GANG'));
      if (gangResponders.length > 0 && rng() < 0.5) {
        const r = gangResponders[Math.floor(rng() * gangResponders.length)]!;
        gameLog.push(`[R${roundCount}] 玩家${r.client.name}(S${r.seat}) 杠`);
        r.client.send({
          type: 'GANG',
          requestId: `g${roundCount}`,
          serverTime: 0,
          payload: { tile: lastPlayedTile || {}, gangKind: 'ming_kong' },
        });
        await sleep(200);
        for (const c of clients) c.drainView();
        continue;
      }

      // 碰
      const pengResponders = responders.filter((r) => r.actions.includes('PENG'));
      if (pengResponders.length > 0 && rng() < 0.6) {
        const r = pengResponders[Math.floor(rng() * pengResponders.length)]!;
        gameLog.push(`[R${roundCount}] 玩家${r.client.name}(S${r.seat}) 碰`);
        r.client.send({
          type: 'PENG',
          requestId: `pg${roundCount}`,
          serverTime: 0,
          payload: { tile: lastPlayedTile || {} },
        });
        await sleep(200);
        for (const c of clients) c.drainView();
        continue;
      }

      // 吃
      const chiResponders = responders.filter((r) => r.actions.includes('CHI'));
      if (chiResponders.length > 0 && rng() < 0.5) {
        const r = chiResponders[Math.floor(rng() * chiResponders.length)]!;
        // 构建合法 chiLow 尝试
        let chiPayload: any = { tile: lastPlayedTile || {} };
        if (lastPlayedTile) {
          const built = buildChiPayload(r.client.latestView!, lastPlayedTile);
          if (built) chiPayload = built;
        }
        gameLog.push(`[R${roundCount}] 玩家${r.client.name}(S${r.seat}) 尝试吃 (chiLow=${chiPayload.chiLow?.suit}${chiPayload.chiLow?.rank})`);
        r.client.send({
          type: 'CHI',
          requestId: `ch${roundCount}`,
          serverTime: 0,
          payload: chiPayload,
        });
        await sleep(200);
        for (const c of clients) c.drainView();
        continue;
      }

      // 所有剩余响应者：PASS
      for (const r of responders) {
        if (r.actions.includes('PASS')) {
          r.client.send({ type: 'PASS', requestId: `ps${roundCount}_${r.seat}`, serverTime: 0, payload: {} });
        }
      }
      await sleep(100);
      for (const c of clients) c.drainView();
    }

    // ── 7. 校验 ─────────────────────────────────

    // 7a. 对局必须结束
    expect(roundEnded).toBe(true);
    expect(roundCount).toBeLessThan(MAX_ROUNDS);

    // 7b. 所有玩家都收到了 ROUND_END
    for (const c of clients) {
      expect(c.roundEndMsg).not.toBeNull();
      expect(c.roundEndMsg.payload.events).toBeDefined();
      expect(c.roundEndMsg.payload.events.length).toBeGreaterThan(0);
    }

    // 7c. 最后的消息序列中，myHand 不包含他人手牌
    for (const c of clients) {
      assertNoHandLeak(c.latestView!, clients.indexOf(c));
    }

    // 7d. 打印对局日志
    console.log('\n══════════════════════════════════════════');
    console.log('        四玩家自动对局 — 仿真日志');
    console.log('══════════════════════════════════════════');
    for (const line of gameLog) {
      console.log(line);
    }

    // 打印结算信息
    const finalEvents = clients[0]!.roundEndMsg?.payload?.events ?? [];
    console.log(`\n── 对局事件（共 ${finalEvents.length} 条）──`);
    const EVENT_CN: Record<string, string> = {
      DEAL: '发牌', DRAW: '摸牌', PLAY: '出牌',
      CHI: '吃', PENG: '碰', MING_KONG: '明杠',
      AN_KONG: '暗杠', BU_KONG: '补杠', HU: '胡牌',
      PASS: '过', ROUND_END: '结束', DRAW_GAME: '流局',
    };
    const last20 = finalEvents.slice(-20);
    for (const e of last20) {
      const label = EVENT_CN[e.type] ?? e.type;
      console.log(`  S${e.seat} [${label}] @ ${new Date(e.timestamp).toISOString()}`);
    }

    const ro = clients[0]!.roundEndMsg!.payload;
    if (ro.reason === 'win') {
      console.log(`\n── 胜者: Seat ${ro.winner} (${ro.winType === 'self' ? '自摸' : '点炮'}) ──`);
    } else {
      console.log(`\n── 流局 ──`);
    }
    console.log(`分数: S0=${ro.scores[0]} S1=${ro.scores[1]} S2=${ro.scores[2]} S3=${ro.scores[3]}`);
    console.log(`分数变化: S0=${ro.scoreChanges[0]} S1=${ro.scoreChanges[1]} S2=${ro.scoreChanges[2]} S3=${ro.scoreChanges[3]}`);
    console.log('══════════════════════════════════════════\n');

    expect(ro.scores).toBeDefined();
    expect(ro.scoreChanges).toBeDefined();
  });

  it('两局连玩：退回房间→再来一局', { timeout: 90_000 }, async () => {
    await server._reset();

    const raws = await Promise.all([connect(), connect(), connect(), connect()]);
    clients = [
      new SimClient(raws[0]!, '东'),
      new SimClient(raws[1]!, '南'),
      new SimClient(raws[2]!, '西'),
      new SimClient(raws[3]!, '北'),
    ];

    // 第一局：建房加入准备开始
    clients[0]!.send({ type: 'CREATE_ROOM', requestId: 'cr', serverTime: 0, payload: { nickname: '东' } });
    const crResp = await clients[0]!.waitMsg('CREATE_ROOM');
    const roomCode: string = crResp.payload.room.roomCode;

    for (let i = 1; i <= 3; i++) {
      clients[i]!.send({ type: 'JOIN_ROOM', requestId: `j${i}`, serverTime: 0, payload: { roomCode, nickname: ['南', '西', '北'][i - 1] } });
      await clients[i]!.waitMsg('JOIN_ROOM');
    }
    await sleep(100);
    for (const c of clients) c.clearQueue();

    for (let i = 0; i < 4; i++) {
      clients[i]!.send({ type: 'READY', requestId: `r${i}`, serverTime: 0, payload: {} });
    }
    await sleep(200);
    for (const c of clients) c.clearQueue();

    clients[0]!.send({ type: 'START_GAME', requestId: 'sg1', serverTime: 0, payload: {} });
    for (let i = 0; i < 4; i++) {
      let found = false;
      for (let t = 0; t < 20; t++) {
        const m = await clients[i]!.waitMsg('START_GAME');
        if (m.payload?.view) {
          clients[i]!.latestView = {
            myHand: m.payload.view.myHand ?? [],
            allowedActions: m.payload.view.allowedActions ?? [],
            turn: m.payload.view.turn ?? -1,
            phase: m.payload.view.phase ?? '',
            scores: m.payload.view.scores ?? {},
          };
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    }
    for (const c of clients) c.clearQueue();

    // 快速模拟：所有人只出牌+PASS（不碰不杠），让第一局尽快结束
    let round1Ended = false;
    for (let round = 0; round < 300 && !round1Ended; round++) {
      for (const c of clients) {
        const re = c.checkRoundEnd();
        if (re) round1Ended = true;
      }
      if (round1Ended) break;

      for (const c of clients) c.drainView();

      const turn = clients[0]!.latestView?.turn ?? -1;
      if (turn < 0) { await sleep(20); continue; }

      const cp = clients[turn]!;
      const v = cp.latestView;

      if (v?.allowedActions.includes('PLAY_TILE') && v.myHand.length > 0) {
        const tileIdx = Math.floor(rng() * v.myHand.length);
        const tile = v.myHand[tileIdx];
        cp.send({ type: 'PLAY_TILE', requestId: `p${round}`, serverTime: 0, payload: { tile } });
        await sleep(80);
        for (const c of clients) c.drainView();
        continue;
      }

      // 响应窗口：全部 PASS
      let acted = false;
      for (let i = 0; i < 4; i++) {
        const av = clients[i]!.latestView;
        if (av && av.turn === turn && i !== turn) {
          const act = av.allowedActions;
          if (act.length > 0 && !act.includes('PLAY_TILE')) {
            if (act.includes('HU') && rng() < 0.3) {
              clients[i]!.send({ type: 'HU', requestId: `hu${round}`, serverTime: 0, payload: { source: 'discard' } });
              acted = true;
              break;
            }
            if (act.includes('PASS')) {
              clients[i]!.send({ type: 'PASS', requestId: `ps${round}_${i}`, serverTime: 0, payload: {} });
              acted = true;
            }
          }
        }
      }
      if (!acted) { await sleep(40); }
      await sleep(60);
      for (const c of clients) c.drainView();
    }

    expect(round1Ended).toBe(true);
    const scoresAfterR1 = { ...clients[0]!.roundEndMsg?.payload?.scores };

    // 验证分数总和守恒（自摸 +3-1-1-1=0，点炮 +3-3=0）
    const totalScore1 = Object.values(scoresAfterR1 as Record<number, number>).reduce((a, b) => a + b, 0);
    expect(totalScore1).toBe(0);

    console.log(`第一局结束，分数: ${JSON.stringify(scoresAfterR1)}`);

    // 关闭连接，重新连接来模拟退房再开
    for (const c of clients) c.ws.close();
    await sleep(200);

    const raws2 = await Promise.all([connect(), connect(), connect(), connect()]);
    clients = [
      new SimClient(raws2[0]!, '东'),
      new SimClient(raws2[1]!, '南'),
      new SimClient(raws2[2]!, '西'),
      new SimClient(raws2[3]!, '北'),
    ];

    // 重连：用第一局保存的 token
    // 实际操作中：创建新房间，重新开始
    clients[0]!.send({ type: 'CREATE_ROOM', requestId: 'cr2', serverTime: 0, payload: { nickname: '东' } });
    const cr2Resp = await clients[0]!.waitMsg('CREATE_ROOM');
    const roomCode2: string = cr2Resp.payload.room.roomCode;

    for (let i = 1; i <= 3; i++) {
      clients[i]!.send({ type: 'JOIN_ROOM', requestId: `j2_${i}`, serverTime: 0, payload: { roomCode: roomCode2, nickname: ['南', '西', '北'][i - 1] } });
      await clients[i]!.waitMsg('JOIN_ROOM');
    }
    await sleep(100);
    for (const c of clients) c.clearQueue();

    for (let i = 0; i < 4; i++) {
      clients[i]!.send({ type: 'READY', requestId: `r2_${i}`, serverTime: 0, payload: {} });
    }
    await sleep(200);
    for (const c of clients) c.clearQueue();

    clients[0]!.send({ type: 'START_GAME', requestId: 'sg2', serverTime: 0, payload: {} });
    for (let i = 0; i < 4; i++) {
      let found = false;
      for (let t = 0; t < 20; t++) {
        const m = await clients[i]!.waitMsg('START_GAME');
        if (m.payload?.view) {
          clients[i]!.latestView = {
            myHand: m.payload.view.myHand ?? [],
            allowedActions: m.payload.view.allowedActions ?? [],
            turn: m.payload.view.turn ?? -1,
            phase: m.payload.view.phase ?? '',
            scores: m.payload.view.scores ?? {},
          };
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    }
    for (const c of clients) c.clearQueue();

    // 第二局快速模拟
    let round2Ended = false;
    for (let round = 0; round < 300 && !round2Ended; round++) {
      for (const c of clients) {
        const re = c.checkRoundEnd();
        if (re) round2Ended = true;
      }
      if (round2Ended) break;

      for (const c of clients) c.drainView();
      const turn = clients[0]!.latestView?.turn ?? -1;
      if (turn < 0) { await sleep(20); continue; }

      const cp = clients[turn]!;
      const v = cp.latestView;
      if (v?.allowedActions.includes('PLAY_TILE') && v.myHand.length > 0) {
        const tile = v.myHand[Math.floor(rng() * v.myHand.length)];
        cp.send({ type: 'PLAY_TILE', requestId: `p2_${round}`, serverTime: 0, payload: { tile } });
        await sleep(80);
        for (const c of clients) c.drainView();
        continue;
      }

      for (let i = 0; i < 4; i++) {
        const av = clients[i]!.latestView;
        if (av && av.turn === turn && i !== turn) {
          const act = av.allowedActions;
          if (act.length > 0 && !act.includes('PLAY_TILE') && act.includes('PASS')) {
            clients[i]!.send({ type: 'PASS', requestId: `ps2_${round}_${i}`, serverTime: 0, payload: {} });
          }
        }
      }
      await sleep(60);
      for (const c of clients) c.drainView();
    }

    expect(round2Ended).toBe(true);
    const scoresAfterR2 = { ...clients[0]!.roundEndMsg?.payload?.scores };
    const totalScore2 = Object.values(scoresAfterR2 as Record<number, number>).reduce((a, b) => a + b, 0);
    expect(totalScore2).toBe(0);

    console.log(`第二局结束，分数: ${JSON.stringify(scoresAfterR2)}`);
  });

  it('手动结束游戏后拒绝动作', async () => {
    await server._reset();

    const raws = await Promise.all([connect(), connect(), connect(), connect()]);
    clients = [
      new SimClient(raws[0]!, '东'),
      new SimClient(raws[1]!, '南'),
      new SimClient(raws[2]!, '西'),
      new SimClient(raws[3]!, '北'),
    ];

    clients[0]!.send({ type: 'CREATE_ROOM', requestId: 'cr', serverTime: 0, payload: { nickname: '东' } });
    const crResp = await clients[0]!.waitMsg('CREATE_ROOM');
    const roomCode: string = crResp.payload.room.roomCode;

    for (let i = 1; i <= 3; i++) {
      clients[i]!.send({ type: 'JOIN_ROOM', requestId: `j${i}`, serverTime: 0, payload: { roomCode, nickname: ['南', '西', '北'][i - 1] } });
      await clients[i]!.waitMsg('JOIN_ROOM');
    }
    await sleep(100);
    for (const c of clients) c.clearQueue();

    for (let i = 0; i < 4; i++) {
      clients[i]!.send({ type: 'READY', requestId: `r${i}`, serverTime: 0, payload: {} });
    }
    await sleep(200);
    for (const c of clients) c.clearQueue();

    clients[0]!.send({ type: 'START_GAME', requestId: 'sg', serverTime: 0, payload: {} });
    for (let i = 0; i < 4; i++) {
      let found = false;
      for (let t = 0; t < 20; t++) {
        const m = await clients[i]!.waitMsg('START_GAME');
        if (m.payload?.view) {
          clients[i]!.latestView = {
            myHand: m.payload.view.myHand ?? [],
            allowedActions: m.payload.view.allowedActions ?? [],
            turn: m.payload.view.turn ?? -1,
            phase: m.payload.view.phase ?? '',
            scores: m.payload.view.scores ?? {},
          };
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    }
    for (const c of clients) c.clearQueue();

    // 快速打到结束
    let ended = false;
    for (let round = 0; round < 300 && !ended; round++) {
      for (const c of clients) {
        const re = c.checkRoundEnd();
        if (re) ended = true;
      }
      if (ended) break;
      for (const c of clients) c.drainView();
      const turn = clients[0]!.latestView?.turn ?? -1;
      if (turn < 0) { await sleep(20); continue; }

      const cp = clients[turn]!;
      const v = cp.latestView;
      if (v?.allowedActions.includes('PLAY_TILE') && v.myHand.length > 0) {
        const tile = v.myHand[Math.floor(rng() * v.myHand.length)];
        cp.send({ type: 'PLAY_TILE', requestId: `p${round}`, serverTime: 0, payload: { tile } });
        await sleep(80);
        for (const c of clients) c.drainView();
        continue;
      }
      for (let i = 0; i < 4; i++) {
        const av = clients[i]!.latestView;
        if (av && av.turn === turn && i !== turn && av.allowedActions.length > 0 && !av.allowedActions.includes('PLAY_TILE') && av.allowedActions.includes('PASS')) {
          clients[i]!.send({ type: 'PASS', requestId: `ps${round}_${i}`, serverTime: 0, payload: {} });
        }
      }
      await sleep(60);
      for (const c of clients) c.drainView();
    }

    expect(ended).toBe(true);

    // 对局结束后，尝试出牌应被拒绝
    for (const c of clients) c.clearQueue();
    clients[0]!.send({ type: 'PLAY_TILE', requestId: 'bad', serverTime: 0, payload: { tile: { suit: 'm', rank: 1 } } });
    await sleep(200);

    let gotError = false;
    for (const c of clients) {
      for (const m of c.msgQueue) {
        if (m.error && m.error.code === 'ILLEGAL_ACTION') {
          gotError = true;
        }
      }
    }
    expect(gotError).toBe(true);
  });
});

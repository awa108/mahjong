import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  canChi,
  canMingGang,
  canPeng,
  checkHu,
  type PlayerViewState,
  type Tile,
} from '@mahjong/shared';
import { MahjongWSServer } from '../src/ws/WebSocketServer.js';

const SERVER_SEED = 20260630;
const BOT_SEED = 20260631;
const MAX_STEPS = 240;
const QUIET_MS = 35;

type ServerMsg = {
  type: string;
  requestId?: string;
  payload?: any;
  error?: { code: string; msg: string };
};

interface Bot {
  name: string;
  ws: WebSocket;
  inbox: ServerMsg[];
  messages: ServerMsg[];
  view: PlayerViewState | null;
  roundEnd: ServerMsg | null;
  errors: Error[];
  closed: boolean;
}

function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeRequestId(type: string): string {
  makeRequestId.seq += 1;
  return `${type}_${makeRequestId.seq}`;
}
makeRequestId.seq = 0;

function send(ws: WebSocket, type: string, payload: Record<string, unknown> = {}): void {
  ws.send(JSON.stringify({ type, requestId: makeRequestId(type), serverTime: 0, payload }));
}

function tileRef(tile: Tile): { suit: Tile['suit']; rank: Tile['rank'] } {
  return { suit: tile.suit, rank: tile.rank };
}

function tileText(tile: Tile | null | undefined): string {
  return tile ? `${tile.suit}${tile.rank}` : 'none';
}

function makeBot(name: string, ws: WebSocket): Bot {
  const bot: Bot = {
    name,
    ws,
    inbox: [],
    messages: [],
    view: null,
    roundEnd: null,
    errors: [],
    closed: false,
  };

  ws.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString()) as ServerMsg;
      bot.inbox.push(msg);
      bot.messages.push(msg);
    } catch (error) {
      bot.errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  });
  ws.on('error', (error) => bot.errors.push(error));
  ws.on('close', () => {
    bot.closed = true;
  });

  return bot;
}

async function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function takeMessages(bot: Bot): ServerMsg[] {
  const messages = bot.inbox;
  bot.inbox = [];
  return messages;
}

function assertNoPrivateHands(bot: Bot, view: PlayerViewState): void {
  expect(Array.isArray(view.myHand)).toBe(true);

  for (const player of view.players) {
    const raw = player as Record<string, unknown>;
    expect(raw.concealed).toBeUndefined();
    expect(raw.hand).toBeUndefined();
    expect(raw.hands).toBeUndefined();
    expect(raw.myHand).toBeUndefined();

    if (player.seat !== view.mySeat) {
      expect(Array.isArray(raw.concealed)).toBe(false);
      expect(Array.isArray(raw.hand)).toBe(false);
    }
  }

  const rawView = view as unknown as Record<string, unknown>;
  expect(rawView.wall).toBeUndefined();
  expect(rawView.hands).toBeUndefined();
}

async function waitFor(
  bot: Bot,
  predicate: (msg: ServerMsg) => boolean,
  label: string,
  timeoutMs = 5000,
): Promise<ServerMsg> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = takeMessages(bot);
    for (const msg of messages) {
      if (msg.error) {
        throw new Error(`${bot.name} received ${msg.type} error ${msg.error.code}: ${msg.error.msg}`);
      }
      if (msg.type === 'START_GAME' && msg.payload?.view) {
        bot.view = msg.payload.view;
        assertNoPrivateHands(bot, bot.view!);
      }
      if (msg.type === 'STATE_DELTA') {
        // delta 消息携带增量状态，从 payload 提取 view 信息
        const delta = msg.payload;
        if (delta.myHand != null) {
          if (!bot.view) bot.view = {} as any;
          (bot.view as any).myHand = delta.myHand;
        }
        if (delta.players != null) {
          if (!bot.view) bot.view = {} as any;
          (bot.view as any).players = delta.players;
        }
        if (delta.lastDiscard !== undefined) {
          if (!bot.view) bot.view = {} as any;
          (bot.view as any).lastDiscard = delta.lastDiscard;
        }
        if (delta.lastDiscardBy !== undefined) {
          if (!bot.view) bot.view = {} as any;
          (bot.view as any).lastDiscardBy = delta.lastDiscardBy;
        }
        if (delta.turn !== undefined) {
          if (!bot.view) bot.view = {} as any;
          (bot.view as any).turn = delta.turn;
        }
        if (delta.allowedActions != null) {
          if (!bot.view) bot.view = {} as any;
          (bot.view as any).allowedActions = delta.allowedActions;
        }
        if (delta.wallRemaining !== undefined) {
          if (!bot.view) bot.view = {} as any;
          (bot.view as any).wallRemaining = delta.wallRemaining;
        }
        if (delta.myMelds != null) {
          if (!bot.view) bot.view = {} as any;
          (bot.view as any).myMelds = delta.myMelds;
        }
        if (msg.seq > 0) {
          if (!bot.view) bot.view = {} as any;
          (bot.view as any).eventSeq = msg.seq;
        }
      }
      if (msg.type === 'ROUND_END') {
        bot.roundEnd = msg;
      }
      if (predicate(msg)) return msg;
    }
    await sleep(10);
  }
  throw new Error(`${bot.name} timed out waiting for ${label}`);
}

function ingestMessages(bots: Bot[]): boolean {
  let sawState = false;
  for (const bot of bots) {
    const messages = takeMessages(bot);
    for (const msg of messages) {
      if (msg.error) {
        throw new Error(`${bot.name} received ${msg.type} error ${msg.error.code}: ${msg.error.msg}`);
      }
      if (msg.type === 'START_GAME' && msg.payload?.view) {
        bot.view = msg.payload.view;
        assertNoPrivateHands(bot, bot.view!);
        sawState = true;
      }
      if (msg.type === 'STATE_DELTA') {
        // delta 增量：更新 bot.view 对应字段
        const delta = msg.payload;
        if (delta.myHand != null && bot.view) (bot.view as any).myHand = delta.myHand;
        if (delta.players != null && bot.view) (bot.view as any).players = delta.players;
        if (delta.lastDiscard !== undefined && bot.view) (bot.view as any).lastDiscard = delta.lastDiscard;
        if (delta.lastDiscardBy !== undefined && bot.view) (bot.view as any).lastDiscardBy = delta.lastDiscardBy;
        if (delta.turn !== undefined && bot.view) (bot.view as any).turn = delta.turn;
        if (delta.allowedActions != null && bot.view) (bot.view as any).allowedActions = delta.allowedActions;
        if (delta.wallRemaining !== undefined && bot.view) (bot.view as any).wallRemaining = delta.wallRemaining;
        if (delta.myMelds != null && bot.view) (bot.view as any).myMelds = delta.myMelds;
        if (msg.seq > 0 && bot.view) (bot.view as any).eventSeq = msg.seq;
        sawState = true;
      }
      if (msg.type === 'ROUND_END') {
        bot.roundEnd = msg;
      }
    }
  }
  return sawState;
}

async function syncViews(bots: Bot[], timeoutMs = 5000): Promise<'state' | 'roundEnd'> {
  const deadline = Date.now() + timeoutMs;
  const seen = new Set<Bot>();
  let lastStateAt = 0;

  while (Date.now() < deadline) {
    for (const bot of bots) {
      const messages = takeMessages(bot);
      for (const msg of messages) {
        if (msg.error) {
          throw new Error(`${bot.name} received ${msg.type} error ${msg.error.code}: ${msg.error.msg}`);
        }
        if (msg.type === 'ROUND_END') {
          bot.roundEnd = msg;
        }
        if (msg.type === 'START_GAME' && msg.payload?.view) {
          bot.view = msg.payload.view;
          assertNoPrivateHands(bot, bot.view!);
          seen.add(bot);
          lastStateAt = Date.now();
        }
        if (msg.type === 'STATE_DELTA') {
          // delta 视为新的状态同步
          const delta = msg.payload;
          if (delta.myHand != null && bot.view) (bot.view as any).myHand = delta.myHand;
          if (delta.players != null && bot.view) (bot.view as any).players = delta.players;
          if (delta.lastDiscard !== undefined && bot.view) (bot.view as any).lastDiscard = delta.lastDiscard;
          if (delta.lastDiscardBy !== undefined && bot.view) (bot.view as any).lastDiscardBy = delta.lastDiscardBy;
          if (delta.turn !== undefined && bot.view) (bot.view as any).turn = delta.turn;
          if (delta.allowedActions != null && bot.view) (bot.view as any).allowedActions = delta.allowedActions;
          if (delta.wallRemaining !== undefined && bot.view) (bot.view as any).wallRemaining = delta.wallRemaining;
          if (delta.myMelds != null && bot.view) (bot.view as any).myMelds = delta.myMelds;
          if (delta.seat != null && bot.view) (bot.view as any).mySeat = delta.seat;
          seen.add(bot);
          lastStateAt = Date.now();
        }
      }
    }

    if (bots.every((bot) => bot.roundEnd)) return 'roundEnd';
    if (seen.size === bots.length && lastStateAt > 0 && Date.now() - lastStateAt >= QUIET_MS) {
      return 'state';
    }
    await sleep(10);
  }

  throw new Error(`timed out waiting for state sync; seen=${seen.size}/${bots.length}`);
}

async function setupRoom(port: number, log: string[]): Promise<{ bots: Bot[]; roomId: string; roomCode: string }> {
  const sockets = await Promise.all([connect(port), connect(port), connect(port), connect(port)]);
  const bots = ['A', 'B', 'C', 'D'].map((name, index) => makeBot(name, sockets[index]!));

  send(bots[0]!.ws, 'CREATE_ROOM', { nickname: 'A' });
  const created = await waitFor(bots[0]!, (msg) => msg.type === 'CREATE_ROOM', 'CREATE_ROOM');
  const roomId = created.payload.room.roomId as string;
  const roomCode = created.payload.room.roomCode as string;
  log.push(`[setup] A created room ${roomCode}`);

  for (const bot of bots.slice(1)) {
    send(bot.ws, 'JOIN_ROOM', { roomCode, nickname: bot.name });
    await waitFor(bot, (msg) => msg.type === 'JOIN_ROOM', `${bot.name} JOIN_ROOM`);
    log.push(`[setup] ${bot.name} joined room`);
  }

  await sleep(50);
  ingestMessages(bots);

  for (const bot of bots) send(bot.ws, 'READY');
  await waitUntil(() => {
    ingestMessages(bots);
    return bots.every((bot) => bot.messages.filter((msg) => msg.type === 'READY').length >= 4);
  }, 'all READY broadcasts');
  log.push('[setup] all players ready');

  send(bots[0]!.ws, 'START_GAME');
  // delta 模式下首次消息类型为 STATE_DELTA（kind=turn），而非 START_GAME
  // syncViews 已同时支持 START_GAME 和 STATE_DELTA
  await syncViews(bots, 10000); // increase timeout for delta accumulation
  log.push('[setup] game started');

  // 等待至少有一个 bot 通过 STATE_DELTA 获取到 myHand
  await waitUntil(() => {
    ingestMessages(bots);
    return bots.some((bot) => {
      const v = bot.view as any;
      return v?.myHand && Array.isArray(v.myHand) && v.myHand.length > 0;
    });
  }, 'bot views have myHand', 8000);

  // 验证手牌存在性（delta 模式不强制首次消息就含完整手牌，多次 delta 累加）
  expect(bots[0]!.view).toBeTruthy();
  log.push(`[setup] dealer hand: ${((bots[0]!.view as any)?.myHand ?? []).length} cards`);

  return { bots, roomId, roomCode };
}

async function waitUntil(predicate: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${label}`);
}

type Candidate =
  | { kind: 'HU'; bot: Bot }
  | { kind: 'GANG'; bot: Bot }
  | { kind: 'PENG'; bot: Bot }
  | { kind: 'CHI'; bot: Bot; chiLow: Tile };

function responseCandidates(bots: Bot[]): { responders: Bot[]; top: Candidate[] } {
  const reference = bots.find((bot) => bot.view?.lastDiscard)?.view;
  const discard = reference?.lastDiscard;
  const discardBy = reference?.lastDiscardBy;
  if (!reference || !discard || discardBy == null) return { responders: [], top: [] };

  const responders = bots.filter((bot) => bot.view?.mySeat !== discardBy);
  const hu: Candidate[] = [];
  const gang: Candidate[] = [];
  const peng: Candidate[] = [];
  const chi: Candidate[] = [];

  for (const bot of responders) {
    const view = bot.view!;
    const actions = new Set(view.allowedActions);
    if (actions.has('HU') && checkHu([...view.myHand, discard]).canHu) {
      hu.push({ kind: 'HU', bot });
    }
    if (actions.has('GANG') && canMingGang(view.myHand, discard).canGang) {
      gang.push({ kind: 'GANG', bot });
    }
    if (actions.has('PENG') && canPeng(view.myHand, discard).canPeng) {
      peng.push({ kind: 'PENG', bot });
    }
    if (actions.has('CHI')) {
      const result = canChi(view.myHand, discard, view.mySeat, discardBy);
      if (result.canChi && result.options[0]) {
        chi.push({ kind: 'CHI', bot, chiLow: result.options[0].chiLow });
      }
    }
  }

  if (hu.length > 0) return { responders, top: hu };
  if (gang.length > 0) return { responders, top: gang };
  if (peng.length > 0) return { responders, top: peng };
  return { responders, top: chi };
}

async function playUntilRoundEnd(
  bots: Bot[],
  rng: () => number,
  log: string[],
): Promise<void> {
  for (let step = 0; step < MAX_STEPS; step++) {
    ingestMessages(bots);
    if (bots.every((bot) => bot.roundEnd)) {
      log.push(`[step ${step}] round ended`);
      return;
    }

    const actor = bots.find((bot) => {
      const view = bot.view;
      return view
        && view.turn === view.mySeat
        && view.allowedActions.includes('PLAY_TILE')
        && view.myHand.length > 0;
    });

    if (actor?.view) {
      const tile = actor.view.myHand[Math.floor(rng() * actor.view.myHand.length)]!;
      log.push(`[step ${step}] ${actor.name}/S${actor.view.mySeat} PLAY ${tileText(tile)}`);
      send(actor.ws, 'PLAY_TILE', { tile: tileRef(tile) });
      if (await syncViews(bots) === 'roundEnd') return;
      continue;
    }

    const { responders, top } = responseCandidates(bots);
    if (responders.length === 0) {
      await sleep(20);
      continue;
    }

    const shouldClaim = top.length > 0 && rng() < 0.55;
    if (!shouldClaim) {
      log.push(`[step ${step}] PASS ${responders.map((bot) => bot.name).join('/')}`);
      for (const bot of responders) send(bot.ws, 'PASS');
      if (await syncViews(bots) === 'roundEnd') return;
      continue;
    }

    const candidate = top[Math.floor(rng() * top.length)]!;
    const discard = candidate.bot.view!.lastDiscard!;
    log.push(`[step ${step}] ${candidate.bot.name}/S${candidate.bot.view!.mySeat} ${candidate.kind} ${tileText(discard)}`);

    if (candidate.kind === 'HU') {
      send(candidate.bot.ws, 'HU', { source: 'discard' });
    } else if (candidate.kind === 'GANG') {
      send(candidate.bot.ws, 'GANG', { tile: tileRef(discard), gangKind: 'ming_kong' });
    } else if (candidate.kind === 'PENG') {
      send(candidate.bot.ws, 'PENG', { tile: tileRef(discard) });
    } else {
      send(candidate.bot.ws, 'CHI', { tile: tileRef(discard), chiLow: tileRef(candidate.chiLow) });
    }

    if (await syncViews(bots) === 'roundEnd') return;
  }

  throw new Error(`round did not finish within ${MAX_STEPS} steps`);
}

function getRecentGameEvents(server: MahjongWSServer, roomId: string): any[] {
  const engines = (server as unknown as { engines?: Map<string, { getEventSummary: () => any[] }> }).engines;
  return engines?.get(roomId)?.getEventSummary().slice(-20) ?? [];
}

function printRecentEvents(server: MahjongWSServer, roomId: string): void {
  const events = getRecentGameEvents(server, roomId);
  console.log(`Recent GameEvent entries (${events.length}/20):`);
  for (const event of events) {
    console.log(`  #${event.seq ?? '-'} ${event.type} S${event.seat} ${new Date(event.timestamp).toISOString()}`);
  }
}

function printGameLog(log: string[], bots: Bot[]): void {
  console.log('\nFour-player simulation log');
  console.log(`steps logged: ${log.length}`);
  for (const line of log.slice(-40)) console.log(line);

  const roundEnd = bots.find((bot) => bot.roundEnd)?.roundEnd;
  if (!roundEnd) return;

  const payload = roundEnd.payload;
  console.log(`result: ${payload.reason}, winner=${payload.winner ?? 'none'}, winType=${payload.winType ?? 'none'}`);
  console.log(`scores: ${JSON.stringify(payload.scores)}`);
  console.log(`recent events: ${(payload.events ?? []).slice(-20).map((event: any) => `${event.type}:S${event.seat}`).join(', ')}`);
}

describe('simulate four WebSocket players', { timeout: 60_000 }, () => {
  let server: MahjongWSServer;
  let port: number;

  beforeAll(() => {
    server = new MahjongWSServer();
    const wss = server.listen(0);
    port = (wss.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(resolve));
  });

  it('runs a deterministic four-player room and keeps private hands private', async () => {
    await server._reset();
    makeRequestId.seq = 0;

    const originalRandom = Math.random;
    Math.random = seededRandom(SERVER_SEED);

    let roomId = '';
    let bots: Bot[] = [];
    const log: string[] = [`[seed] server=${SERVER_SEED}, bot=${BOT_SEED}`];

    try {
      const setup = await setupRoom(port, log);
      roomId = setup.roomId;
      bots = setup.bots;

      await playUntilRoundEnd(bots, seededRandom(BOT_SEED), log);
      printGameLog(log, bots);

      expect(bots.every((bot) => bot.roundEnd)).toBe(true);
      expect(bots.every((bot) => bot.errors.length === 0)).toBe(true);
      expect(bots.every((bot) => !bot.closed)).toBe(true);

      for (const bot of bots) {
        expect(bot.view).not.toBeNull();
        assertNoPrivateHands(bot, bot.view!);
      }

      const scores = bots[0]!.roundEnd!.payload.scores as Record<string, number>;
      expect(Object.values(scores).reduce((sum, score) => sum + score, 0)).toBe(0);
    } catch (error) {
      console.log('\nSimulation failed. Last local log lines:');
      for (const line of log.slice(-20)) console.log(line);
      if (roomId) printRecentEvents(server, roomId);
      throw error;
    } finally {
      Math.random = originalRandom;
      for (const bot of bots) {
        if (bot.ws.readyState === WebSocket.OPEN || bot.ws.readyState === WebSocket.CONNECTING) {
          bot.ws.close();
        }
      }
      await sleep(50);
    }
  });
});

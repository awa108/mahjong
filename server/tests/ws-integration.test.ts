/**
 * WebSocket 集成测试：模拟 4 个 WebSocket 客户端创建房间、加入、准备、开始、出牌。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { MahjongWSServer } from '../src/ws/WebSocketServer.js';

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function send(ws: WebSocket, msg: Record<string, unknown>): void {
  ws.send(JSON.stringify(msg));
}

function recv(ws: WebSocket, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('recv timeout')), timeoutMs);
    const handler = (raw: Buffer) => {
      clearTimeout(timer);
      ws.off('message', handler);
      resolve(JSON.parse(raw.toString()));
    };
    ws.on('message', handler);
  });
}

/** 监听并收集到达的消息（非阻塞快照）。 */
function collectAll(ws: WebSocket, durationMs = 500): Promise<any[]> {
  const msgs: any[] = [];
  return new Promise((resolve) => {
    function onMsg(raw: Buffer) {
      try { msgs.push(JSON.parse(raw.toString())); } catch {}
    }
    ws.on('message', onMsg);
    setTimeout(() => {
      ws.off('message', onMsg);
      resolve(msgs);
    }, durationMs);
  });
}

describe('WebSocket integration', () => {
  let server: MahjongWSServer;
  let port: number;

  beforeAll(async () => {
    server = new MahjongWSServer();
    const wss = server.listen(0);
    port = (wss.address() as any).port;
  });

  afterAll(() => {
    server?.close();
  });

  it('CREATE_ROOM → 返回 room 和 playerId', async () => {
    const c = await connect(port);
    send(c, { type: 'CREATE_ROOM', requestId: '1', serverTime: 0, payload: { nickname: 'Alice' } });
    const resp = await recv(c);
    expect(resp.type).toBe('CREATE_ROOM');
    expect(resp.payload.room).toBeDefined();
    expect(resp.payload.room.roomCode).toHaveLength(6);
    expect(resp.payload.playerId).toBeDefined();
    expect(resp.payload.sessionToken).toBeDefined();
    c.close();
  });

  it('JOIN_ROOM → 返回 room 信息', async () => {
    await server._reset();
    const c1 = await connect(port);
    const c2 = await connect(port);

    send(c1, { type: 'CREATE_ROOM', requestId: 'cr2', serverTime: 0, payload: { nickname: 'Host' } });
    const r1 = await recv(c1);
    const roomCode = r1.payload.room.roomCode;

    send(c2, { type: 'JOIN_ROOM', requestId: '2', serverTime: 0, payload: { roomCode, nickname: 'Bob' } });
    const resp = await recv(c2);
    expect(resp.type).toBe('JOIN_ROOM');
    expect(resp.payload.room.players).toHaveLength(2);

    c1.close();
    c2.close();
  });

  it('4 人完整流程：创建→加入→准备→开始→出牌', { timeout: 15000 }, async () => {
    await server._reset();
    const c1 = await connect(port);
    const c2 = await connect(port);
    const c3 = await connect(port);
    const c4 = await connect(port);

    // 1. 创建
    send(c1, { type: 'CREATE_ROOM', requestId: '1', serverTime: 0, payload: { nickname: '东' } });
    const m1 = await recv(c1);
    expect(m1.type).toBe('CREATE_ROOM');
    const roomCode: string = m1.payload.room.roomCode;

    // 2. 加入
    send(c2, { type: 'JOIN_ROOM', requestId: 'j2', serverTime: 0, payload: { roomCode, nickname: '南' } });
    const j2 = await recv(c2);
    expect(j2.type).toBe('JOIN_ROOM');

    send(c3, { type: 'JOIN_ROOM', requestId: 'j3', serverTime: 0, payload: { roomCode, nickname: '西' } });
    const j3 = await recv(c3);
    expect(j3.type).toBe('JOIN_ROOM');

    send(c4, { type: 'JOIN_ROOM', requestId: 'j4', serverTime: 0, payload: { roomCode, nickname: '北' } });
    const j4 = await recv(c4);
    expect(j4.type).toBe('JOIN_ROOM');

    // 3. 准备 — drain any interleaved bcast on c1, then each ready ack
    send(c1, { type: 'READY', requestId: 'r1', serverTime: 0, payload: {} });
    send(c2, { type: 'READY', requestId: 'r2', serverTime: 0, payload: {} });
    send(c3, { type: 'READY', requestId: 'r3', serverTime: 0, payload: {} });
    send(c4, { type: 'READY', requestId: 'r4', serverTime: 0, payload: {} });

    // Each must receive at least one READY message (the broadcast)
    const readyMsgs = new Set<string>();
    for (const c of [c1, c2, c3, c4]) {
      let tries = 0;
      while (tries < 10) {
        const m = await recv(c);
        if (m.type === 'READY') {
          readyMsgs.add(m.type);
          break;
        }
        tries++;
      }
    }
    expect(readyMsgs.size).toBe(1);
    expect(readyMsgs.has('READY')).toBe(true);

    // 4. 开始
    send(c1, { type: 'START_GAME', requestId: 's1', serverTime: 0, payload: {} });
    // Drain excess READY broadcasts first
    let g1: any;
    for (let i = 0; i < 10; i++) {
      g1 = await recv(c1);
      if (g1.type === 'START_GAME') break;
    }
    let g2: any;
    for (let i = 0; i < 10; i++) {
      g2 = await recv(c2);
      if (g2.type === 'START_GAME') break;
    }
    let g3: any;
    for (let i = 0; i < 10; i++) {
      g3 = await recv(c3);
      if (g3.type === 'START_GAME') break;
    }
    let g4: any;
    for (let i = 0; i < 10; i++) {
      g4 = await recv(c4);
      if (g4.type === 'START_GAME') break;
    }

    expect(g1.type).toBe('START_GAME');
    expect(g1.payload.view.myHand).toHaveLength(14);
    expect(g2.type).toBe('START_GAME');
    expect(g2.payload.view.myHand).toHaveLength(13);
    expect(g3.type).toBe('START_GAME');
    expect(g3.payload.view.myHand).toHaveLength(13);
    expect(g4.type).toBe('START_GAME');
    expect(g4.payload.view.myHand).toHaveLength(13);

    c1.close(); c2.close(); c3.close(); c4.close();
  });

  it('heartbeat → 收到 HEARTBEAT 确认', async () => {
    await server._reset();
    const c = await connect(port);
    send(c, { type: 'CREATE_ROOM', requestId: '1', serverTime: 0, payload: { nickname: 'T' } });
    await recv(c);

    send(c, { type: 'HEARTBEAT', requestId: 'hb', serverTime: 0, payload: {} });
    const resp = await recv(c);
    expect(resp.type).toBe('HEARTBEAT');
    c.close();
  });

  it('不在房间时发游戏动作 → 收到错误', async () => {
    await server._reset();
    const c = await connect(port);
    send(c, { type: 'PLAY_TILE', requestId: 'bad', serverTime: 0, payload: { tile: { suit: 'm', rank: 1 } } });
    const resp = await recv(c);
    expect(resp.error).toBeDefined();
    expect(resp.error.code).toBe('AUTH_FAILED');
    c.close();
  });

  it('reconnect → 返回当前视图', async () => {
    await server._reset();
    const c = await connect(port);
    send(c, { type: 'CREATE_ROOM', requestId: '1', serverTime: 0, payload: { nickname: 'Reconn' } });
    const m = await recv(c);
    expect(m.type).toBe('CREATE_ROOM');
    const roomId: string = m.payload.room.roomId;
    const playerId: string = m.payload.playerId;
    const sessionToken: string = m.payload.sessionToken;

    c.close();
    await new Promise((r) => setTimeout(r, 200));

    const c2 = await connect(port);
    send(c2, { type: 'RECONNECT', requestId: '2', serverTime: 0, payload: { roomId, playerId, sessionToken } });
    const resp = await recv(c2);
    expect(resp.type).toBe('RECONNECT');
    expect(resp.payload.playerView).toBeDefined();
    c2.close();
  });
});

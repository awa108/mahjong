/**
 * @file validation.ts
 * Zod 运行时校验器 + 消息编解码辅助函数。
 * 服务端在处理每条 WebSocket 消息前必须通过此模块验证。
 */
import { z } from 'zod/v4';
import type { ClientMessage, ErrorMsg, ServerMessage } from './protocol.js';
import { ErrorCode } from './protocol.js';
import { tileRefSchema, tileSchema } from './tiles.js';
import { meldKindSchema, seatSchema } from './types.js';
import type { ActionType } from './types.js';

// ─── 客户端消息 Zod schema ───────────────────────────

const createRoomPayload = z.object({ nickname: z.string().min(1).max(20) });
const joinRoomPayload = z.object({
  roomCode: z.string().length(6),
  nickname: z.string().min(1).max(20),
});
const playTilePayload = z.object({ tile: tileRefSchema });
const chiPayload = z.object({ tile: tileRefSchema, chiLow: tileRefSchema });
const pengPayload = z.object({ tile: tileRefSchema });
const gangPayload = z.object({
  tile: tileRefSchema,
  gangKind: meldKindSchema,
});
const huPayload = z.object({ source: z.enum(['self', 'discard']) });
const emptyPayload = z.object({}).strict();
const loginPayload = z.object({ sessionToken: z.string().min(1) });
const reconnectPayload = z.object({
  roomId: z.string().min(1),
  playerId: z.string().min(1),
  sessionToken: z.string().min(1),
});

const clientMessageSchemas: Record<string, z.ZodObject<any> | z.ZodType<any>> = {
  CREATE_ROOM: createRoomPayload,
  JOIN_ROOM: joinRoomPayload,
  READY: emptyPayload,
  START_GAME: emptyPayload,
  DRAW_TILE: emptyPayload,
  PLAY_TILE: playTilePayload,
  CHI: chiPayload,
  PENG: pengPayload,
  GANG: gangPayload,
  HU: huPayload,
  PASS: emptyPayload,
  RECONNECT: reconnectPayload,
  LOGIN: loginPayload,
  HEARTBEAT: emptyPayload,
  SYNC: emptyPayload,
  ROUND_END: emptyPayload,
};

const rawClientEnvelope = z.object({
  type: z.string(),
  requestId: z.string().min(1),
  serverTime: z.number().int().nonnegative().default(0),
  payload: z.unknown(),
});

// ─── 公开 API ────────────────────────────────────────

export interface ValidResult<T> {
  ok: true;
  value: T;
}
export interface InvalidResult {
  ok: false;
  error: string;
}

export type ParseResult<T> = ValidResult<T> | InvalidResult;

/** 解析并校验一条客户端消息（原始 JSON 文本）。 */
export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid json' };
  }

  const envResult = rawClientEnvelope.safeParse(envelope);
  if (!envResult.success) {
    return { ok: false, error: formatZodError(envResult.error) };
  }

  const { type, requestId, payload } = envResult.data;
  const payloadSchema = clientMessageSchemas[type];
  if (!payloadSchema) {
    return { ok: false, error: `unknown message type: ${type}` };
  }

  const payloadResult = payloadSchema.safeParse(payload);
  if (!payloadResult.success) {
    return { ok: false, error: formatZodError(payloadResult.error) };
  }

  return {
    ok: true,
    value: {
      type,
      requestId,
      serverTime: envResult.data.serverTime ?? 0,
      payload: payloadResult.data,
    } as unknown as ClientMessage,
  };
}

/** 校验一条准备发出的服务端消息（开发阶段 assert，防止服务端写错格式）。 */
export function assertServerMessage(msg: ServerMessage): void {
  if (!msg.type) throw new Error('server message missing type');
  if (msg.serverTime == null) throw new Error('server message missing serverTime');
}

/** 构建错误响应。 */
export function makeError(
  orig: { type: ActionType; requestId: string },
  code: string,
  msg: string,
): ErrorMsg {
  return {
    type: orig.type,
    requestId: orig.requestId,
    serverTime: Date.now(),
    error: { code, msg },
  } as ErrorMsg;
}

/** 校验请求消息的 payload 结构（对已解析的消息做二次检查）。 */
export function validatePayload<T>(msg: ClientMessage, _schema: z.ZodType<T>): ParseResult<T> {
  const payloadSchema = clientMessageSchemas[msg.type];
  if (!payloadSchema) return { ok: false, error: `unknown type: ${msg.type}` };
  const r = payloadSchema.safeParse(msg.payload);
  if (!r.success) return { ok: false, error: formatZodError(r.error) };
  return { ok: true, value: r.data as T };
}

// ─── 内部 ────────────────────────────────────────────

function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
}

// 重新导出常用 schema 供外部直接使用
export { clientMessageSchemas, rawClientEnvelope };
export { tileSchema, meldKindSchema, seatSchema };
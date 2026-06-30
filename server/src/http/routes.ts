/**
 * HTTP 路由：简易 Map-based 路由器 + JSON body 解析。
 *
 * 不引入 express/koa，仅使用 Node.js 内置 http 模块。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
) => Promise<void> | void;

const routes = new Map<string, RouteHandler>();

/** 注册路由。path 不含 query string，如 "/api/health"。 */
export function addRoute(method: string, path: string, handler: RouteHandler): void {
  routes.set(`${method}:${path}`, handler);
}

/** 发送 JSON 响应。 */
export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/** 解析 JSON body。 */
function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const data = Buffer.concat(chunks).toString();
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** 请求入口：分发到已注册路由。 */
export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';
  const key = `${method}:${url.pathname}`;

  // CORS（开发环境宽松）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const handler = routes.get(key);
  if (!handler) {
    sendJson(res, 404, { error: 'Not Found', path: url.pathname });
    return;
  }

  try {
    const body = method === 'POST' || method === 'PUT' ? await parseBody(req) : undefined;
    await handler(req, res, body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: 'Internal Server Error', message });
  }
}

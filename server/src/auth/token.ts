/**
 * 简易 session token 签发与校验（MVP 占位）。
 * 正式上线前替换为微信 code2session + JWT。
 */
const store = new Map<string, { uid: string; expires: number }>();

/** 签发 session token（MVP 里用随机串）。 */
export function signToken(uid: string): string {
  const token = `${uid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  store.set(token, { uid, expires: Date.now() + 24 * 3600 * 1000 });
  return token;
}

/** 校验 token，解析 uid。 */
export function verifyToken(token: string): string | null {
  const entry = store.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    store.delete(token);
    return null;
  }
  return entry.uid;
}
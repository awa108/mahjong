/** 生成 6 位随机房间码（大写字母 + 数字）。 */
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 跳过易混淆字符 I/O/0/1
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/** 简易唯一 ID（非加密，仅用于本次会话内标识）。 */
let counter = 0;
export function uid(): string {
  return `${Date.now().toString(36)}-${(counter++).toString(36)}`;
}
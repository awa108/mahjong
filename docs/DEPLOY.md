# DEPLOY — 部署指南

## 前置条件
- 微信公众平台注册小程序，获取 `appId` 与 `appSecret`
- 腾讯云 CloudBase 环境开通（按量付费）
- Node.js 18+ / npm（workspaces）

## 服务端部署（CloudBase 云托管）

1. `npm run build -w @mahjong/server`
2. 将 `server/dist` 与 `server/package.json` 打包为容器镜像
3. 推送到 CloudBase 云托管，设置环境变量：
   - `WX_APP_ID` — 小程序 appId
   - `WX_APP_SECRET` — 小程序 appSecret
   - `TCB_ENV_ID` — CloudBase 环境 ID
   - `PORT` — 容器端口（默认 8080）
4. 配置 WebSocket 路径与域名白名单

## HTTP 云函数（短请求）

- 登录接口、建房接口放在单独的云函数中（HTTP 触发）
- 函数内使用 CloudBase 数据库 SDK 访问 rooms/rounds 集合

## 小程序端

1. 修改 `project.config.json` 中的 `appid` 为实际值
2. 修改 `services/socket.ts` 中的 `WS_URL` 为云托管 WebSocket 地址
3. 修改 `services/api.ts` 中的 `BASE_URL` 为 HTTP 云函数地址
4. 微信开发者工具中打开 `miniprogram/` 目录构建预览
5. 上传代码 → 提交审核

## CloudBase 集合设计

### 1. users

每条文档代表一个玩家账号（playerId 为 `_id`）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | String | playerId（`p_xxx`） |
| `nickname` | String | 玩家昵称 |
| `avatarUrl` | String | 头像 URL |
| `lastLoginAt` | Number | 最后登录时间戳 |

索引：
- `_id`（自动主键）

### 2. rooms

每条文档代表一个房间（roomId 为 `_id`）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | String | roomId |
| `roomCode` | String | 6 位数字房间码 |
| `phase` | String | `waiting` / `playing` / `settled` / `closed` |
| `ruleset` | String | 规则集标识，默认 `simple4` |
| `players` | Array\<Player\> | 玩家列表（seat, playerId, nickname, ready, online, score） |
| `hostPlayerId` | String | 房主 playerId |
| `createdAt` | Number | 创建时间戳 (ms) |
| `updatedAt` | Number | 更新时间戳 (ms) |

索引：
- `_id`（自动主键）
- `roomCode` 唯一索引 — `findRoomByCode()` 用
- `phase` 普通索引 — `listActiveRooms()` 过滤非 `closed` 房间用

### 3. games

每条文档代表一局游戏快照。

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | String | gameId |
| `roomId` | String | 所属房间 ID |
| `roundNo` | Number | 房间内第几局（从 1 递增） |
| `phase` | String | `playing` / `settled` |
| `dealer` | Number | 庄家 seat |
| `turn` | Number | 当前回合 seat |
| `scores` | Record\<number, number\> | 各座位分数快照 |
| `stateSnapshot` | String | JSON 序列化的 GameState 摘要 |
| `createdAt` | Number | 创建时间戳 (ms) |
| `finishedAt` | Number\|null | 结束时间戳，对局中为 null |

索引：
- `_id`（自动主键）
- `roomId` + `createdAt` 复合降序索引 — `listGamesByRoom()` 用
- `roomId` + `finishedAt` 复合索引（`finishedAt: -1`）— `findLatestGameByRoom()` 用

### 4. gameEvents

append-only 事件日志，每条文档不可变。用于回放与审计。

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | String | eventId（唯一） |
| `gameId` | String | 所属游戏 ID |
| `seq` | Number | 事件序号（0 起始，单调递增） |
| `type` | String | 事件类型（DEAL / DRAW / PLAY / CHI / PENG / GANG / HU / PASS / ROUND_END） |
| `seat` | Number | 触发者 seat |
| `timestamp` | Number | 事件时间戳 (ms) |
| `data` | String | JSON 序列化的事件载荷 |

索引：
- `_id`（自动主键，保证幂等写入）
- `gameId` + `seq` 复合索引 — `getGameEvents()` 的主查询路径
- 建议启用 CloudBase TTL 或定期清理：游戏结束后超过 7 天的事件日志可归档删除

### 5. reconnectSessions

断线重连临时凭证，TTL 自动过期。

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | String | sessionId |
| `playerId` | String | 玩家 ID |
| `roomId` | String | 房间 ID |
| `seat` | Number | 玩家座位号 |
| `token` | String | 重连 token |
| `expiresAt` | Number | 过期时间戳 (ms) |

索引：
- `_id`（自动主键）
- `playerId` 唯一索引 — `findReconnectSession()` 用
- **TTL 索引**：CloudBase 支持基于 `expiresAt` 字段的 TTL 自动删除，设置 TTL 字段为 `expiresAt` 即可。过期时间建议 5 分钟。

## 安全（上线前必检）
- [ ] appSecret 仅存于云函数环境变量
- [ ] WebSocket 地址在小程序管理后台已配置白名单
- [ ] 数据库权限设置为"仅管理员可读写"（服务端用 admin SDK）
- [ ] 所有集合权限规则：仅服务端 admin SDK 可读写，客户端 SDK 无直接访问权限
- [ ] roomCode 生成使用 6 位数字随机码，防止枚举攻击
- [ ] WebSocket 连接建立时校验 token（`?token=xxx`），匿名连接仅允许 CREATE_ROOM 和 JOIN_ROOM
- [ ] 游戏动作校验：playerId、roomId、seat、当前 turn、action 合法性均需通过

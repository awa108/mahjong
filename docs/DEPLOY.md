# DEPLOY — 部署指南

## 前置条件
- 微信公众平台注册小程序，获取 `appId` 与 `appSecret`
- 腾讯云 CloudBase 环境开通（按量付费）
- Node.js 18+ / npm（workspaces）

## 配置文件初始化

在开始部署前，需要先创建本地环境变量文件：

```bash
# 在项目根目录执行
cp .env.example .env.local
cp server/.env.example server/.env.local
```

然后编辑 `server/.env.local`，填入真实值：

```
WX_APPID=wx1949e92d543a20ae          # 你的小程序 AppID
WX_APPSECRET=your-actual-secret       # 从微信公众平台获取（机密！）
TCB_ENV_ID=cloud1-d9ggcgqxc02c1aea9  # CloudBase 环境 ID
PORT=3000
```

> ⚠️ `server/.env.local` 已被 `.gitignore` 排除，不会提交到 git。**切勿**将 AppSecret 写入 `miniprogram/config/index.ts` 或任何前端文件。

### 配置文件说明

| 文件 | 是否提交 git | 说明 |
|------|-------------|------|
| `.env.example` | ✅ 提交 | 根环境变量模板，不含真实值 |
| `server/.env.example` | ✅ 提交 | 服务端模板，不含真实值 |
| `.env.local` | ❌ gitignore | 实际环境变量（本地开发用） |
| `server/.env.local` | ❌ gitignore | 服务端实际密钥（**机密**） |
| `miniprogram/config/index.ts` | ✅ 提交 | 小程序前端配置（URL、环境 ID，**无密钥**） |

### 生产环境 URL 配置

编辑 `miniprogram/config/index.ts` 中的生产环境 URL：

```typescript
// 开发环境 → 自动走 localhost
// 生产环境 → 替换为 CloudBase 云托管实际分配的域名
export const API_BASE_URL =
  APP_ENV === 'production'
    ? 'https://your-service-xxx.ap-shanghai.tcb-api.tencentcloudapi.com/api'
    : 'http://localhost:3000/api';

export const WS_URL =
  APP_ENV === 'production'
    ? 'wss://your-service-xxx.ap-shanghai.tcb-api.tencentcloudapi.com/ws'
    : 'ws://localhost:3000/ws';
```

CloudBase 云托管域名可在 [CloudBase 控制台](https://console.cloud.tencent.com/tcb) → 云托管 → 服务详情中查看。

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

---

# 微信小程序真机联调

## 1. 架构速览

本项目是一个 HTTP + WebSocket 共享端口的 Node.js 服务。服务端通过 `miniprogram/config/index.ts` 中的配置连接：

```
开发环境                  生产环境
──────────────────────    ──────────────────────
HTTP: localhost:3000/api  → https://api.example.com/api
WS:   localhost:3000/ws   → wss://api.example.com/ws
```

生产环境的 HTTP 和 WS 必须使用同一个已备案域名，通过路径区分（`/api` vs `/ws`），共享同一个端口（通常是 443，由反向代理转发到容器内的 3000）。

---

## 2. 服务器部署步骤

### 2.1 方式一：CloudBase 云托管（推荐）

1. **构建镜像**

   ```bash
   cd mahjong-miniapp
   npm run build        # 编译 shared → server → dist
   ```

   编写 `server/Dockerfile`：

   ```dockerfile
   FROM node:18-alpine
   WORKDIR /app
   COPY server/dist ./dist
   COPY server/package.json ./
   COPY shared/dist ../shared/dist  # shared 编译产物供 server 引用
   RUN npm ci --production
   EXPOSE 3000
   CMD ["node", "dist/index.js"]
   ```

2. **推送到 CloudBase 云托管**

   - 登录 [CloudBase 控制台](https://console.cloud.tencent.com/tcb)
   - 进入环境 → 云托管 → 新建服务
   - 上传镜像或关联代码仓库自动构建
   - 设置容器端口：`3000`
   - 配置最小副本数 ≥ 1（WebSocket 需要常驻进程）

3. **配置环境变量**（在云托管服务设置中配置）

   | 变量名 | 说明 | 示例 |
   |--------|------|------|
   | `WX_APPID` | 小程序 AppID | `wx1949e92d543a20ae` |
   | `WX_APPSECRET` | 小程序 AppSecret | 从微信公众平台获取 |
   | `TCB_ENV_ID` | CloudBase 环境 ID | `your-env-xxx` |
   | `PORT` | 容器监听端口 | `3000` |

   > ⚠️ `WX_APPSECRET` 严禁出现在前端代码、git 仓库、客户端日志中。

4. **获取公网域名**

   CloudBase 云托管会自动分配一个默认域名（如 `https://your-service-xxx.ap-shanghai.tcb-api.tencentcloudapi.com`）。
   也可以绑定已备案的自定义域名。

### 2.2 方式二：自建服务器

1. 将构建产物 `server/dist/` 上传到服务器
2. 使用 Nginx 反向代理：

   ```nginx
   server {
       listen 443 ssl;
       server_name api.example.com;

       ssl_certificate     /path/to/cert.pem;
       ssl_certificate_key /path/to/key.pem;

       # HTTP API
       location /api/ {
           proxy_pass http://127.0.0.1:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $remote_addr;
       }

       # WebSocket
       location /ws {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $remote_addr;
           proxy_read_timeout 3600s;
       }
   }
   ```

3. 使用 PM2 或 systemd 守护进程：

   ```bash
   pm2 start dist/index.js --name mahjong-server --env production
   ```

### 2.3 环境变量配置方式

服务端通过 `process.env` 读取环境变量。项目提供了模板文件：

- `server/.env.example` — 服务端环境变量模板（可提交 git）
- `server/.env.local` — 实际环境变量（gitignore，**不提交**）

**本地开发：**

```bash
cp server/.env.example server/.env.local
# 编辑 server/.env.local 填入真实值
```

**CloudBase 云托管**：在控制台「服务设置 → 环境变量」中添加（参考 `server/.env.example` 中的变量名）。

**自建服务器**：将 `server/.env.local` 部署到服务器，或用 PM2 的 `ecosystem.config.js` 注入。

```
WX_APPID=wx1949e92d543a20ae
WX_APPSECRET=your-app-secret-here
TCB_ENV_ID=cloud1-d9ggcgqxc02c1aea9
PORT=3000
```

> ⚠️ 生产环境不需要 JWT_SECRET（当前 MVP 使用 `crypto.randomBytes` 生成 session token，不依赖外部密钥）。后续若迁移到 JWT 方案，需额外配置 `JWT_SECRET`。

---

## 3. 小程序端配置

### 3.1 更新生产环境 URL

编辑 `miniprogram/config/index.ts`，将 `your-service-url` 替换为实际域名：

```typescript
export const API_BASE_URL: string =
  APP_ENV === 'development'
    ? 'http://localhost:3000/api'
    : 'https://api.example.com/api';   // ← 替换为实际 HTTPS 域名

export const WS_URL: string =
  APP_ENV === 'development'
    ? 'ws://localhost:3000/ws'
    : 'wss://api.example.com/ws';       // ← 替换为实际 WSS 域名
```

> 🔒 生产环境强制 `https://` 和 `wss://`。`config/index.ts` 中有运行时断言：如果 production 下检测到 `http://` 或 `ws://` 前缀，会在控制台输出 error。

### 3.2 更新 AppID

编辑 `miniprogram/project.config.json`，将 `"appid"` 替换为你的真实小程序 AppID：

```json
{
  "appid": "wx1949e92d543a20ae"
}
```

---

## 4. 微信公众平台后台配置

### 4.1 配置服务器域名（必需）

登录 [微信公众平台](https://mp.weixin.qq.com/) → 开发管理 → 开发设置 → 服务器域名。

| 配置项 | 值 | 说明 |
|--------|-----|------|
| **request 合法域名** | `https://api.example.com` | HTTP API 的域名，**必须使用 https** |
| **socket 合法域名** | `wss://api.example.com` | WebSocket 的域名，**必须使用 wss** |
| uploadFile 合法域名 | （暂不需要） | 如需头像上传再配置 |
| downloadFile 合法域名 | （暂不需要） | |

> ⚠️ **注意事项：**
> - 域名必须已完成 ICP 备案，否则无法在微信公众平台保存。
> - 不能使用 IP 地址、`localhost`、或未备案的域名。
> - 一个月内最多修改 5 次，请确认无误后再保存。
> - 配置后立即生效，无需审核。

### 4.2 其他必要设置

- **开发 → 开发设置 → 开发者 ID**：记下你的 `AppID` 和 `AppSecret`（后者用于服务端环境变量）
- **设置 → 基本设置 → 隐私协议**：提交审核前必须配置

---

## 5. 本地开发调试

### 5.1 启动本地服务

```bash
cd mahjong-miniapp
npm install
npm run dev
```

服务端输出：

```
[mahjong-server] HTTP + WebSocket 服务器已启动，端口 3000
[mahjong-server] REST API: http://localhost:3000/api/health
[mahjong-server] WebSocket: ws://localhost:3000/ws
```

验证：

```bash
curl http://localhost:3000/api/health
# → {"status":"ok","uptime":1.234}

curl -X POST http://localhost:3000/api/login/mock \
  -H 'Content-Type: application/json' \
  -d '{"nickname":"测试"}'
# → {"playerId":"p_xxx...","nickname":"测试","sessionToken":"xxx..."}
```

### 5.2 微信开发者工具调试

1. 打开微信开发者工具 → 导入项目
2. 目录选择 `mahjong-miniapp/miniprogram/`
3. AppID 选择「测试号」或填入真实 AppID
4. 关键设置（**详情 → 本地设置**）：
   - ✅ **不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书** — 必须勾选
   - ✅ 启用自动编译（默认开启）
5. 模拟器会自动加载 `pages/index/index` 页面
6. 输入昵称 → 进入大厅 → 创建/加入房间 → 开始游戏

### 5.3 真机预览

1. 确保手机和开发电脑在**同一局域网**
2. 修改 `miniprogram/config/index.ts` 中的开发 URL 为电脑局域网 IP：

   ```typescript
   // 开发环境 — 改为电脑的局域网 IP
   export const API_BASE_URL = 'http://192.168.1.100:3000/api';
   export const WS_URL = 'ws://192.168.1.100:3000/ws';
   ```

   > `localhost` 只能在本机访问，真机需要局域网 IP。

3. 在开发者工具中点击「预览」→ 生成二维码 → 手机扫码
4. 扫码后小程序会用局域网 IP 连接你电脑上的 server

---

## 6. 真机调试常见问题

### 6.1 域名未配置（`request:fail url not in domain list`）

**现象**：真机请求时报错，开发者工具正常。

**原因**：生产环境（非开发版）小程序只能访问在微信后台配置过的合法域名。

**解决**：
1. 确认真机使用的是「开发版」或「体验版」，不是「正式版」
2. 开发版需要在开发者工具中勾选「不校验合法域名」
3. 如果仍然不行，在微信中：右上角 ··· → 开发调试 → 开启「vConsole」→ 查看 Network 面板
4. 生产环境必须将域名添加到微信后台「服务器域名」

### 6.2 证书错误（`request:fail ssl hand shake error`）

**现象**：HTTPS/WSS 连接报 SSL 错误。

**常见原因**：
- 使用的域名 SSL 证书过期
- 自签名证书不被微信信任
- 证书链不完整

**解决**：
1. 使用 Let's Encrypt 或云服务商提供的免费 SSL 证书
2. 确保证书链完整（Nginx 中配置 `fullchain.pem` 而非 `cert.pem`）
3. 使用 [SSL Labs](https://www.ssllabs.com/ssltest/) 测试证书配置
4. CloudBase 云托管的默认域名自带 HTTPS 证书，无需额外配置

### 6.3 使用 IP 或 localhost（`url not in domain list`）

**现象**：`config/index.ts` 中配置了 `http://192.168.x.x` 或 `http://localhost`。

**原因**：微信小程序不允许使用 IP 地址或 `localhost` 作为服务器域名。

**解决**：
1. **开发阶段**：勾选「不校验合法域名」，可以使用 IP 和 localhost
2. **体验版/正式版**：必须使用已备案的域名（https/wss）
3. 开发时如需局域网联调，确保手机和电脑同一 WiFi，用局域网 IP + 不校验模式

### 6.4 WebSocket 连接失败（`WebSocket connection failed`）

**现象**：HTTP API 正常，但 WS 连不上。

**排查步骤**：

1. **检查 URL 格式**：`wss://api.example.com/ws?token=<sessionToken>`
   - 确认 `/ws` 路径存在
   - 确认 token 参数已正确编码（`encodeURIComponent`）

2. **检查防火墙**：
   ```bash
   # 在服务器上确认端口监听
   netstat -tlnp | grep 3000
   ```

3. **检查 Nginx 配置**：WebSocket 需要特殊的代理头：
   ```
   Upgrade: websocket
   Connection: Upgrade
   ```

4. **CloudBase 云托管**：确认容器端口映射正确，健康检查路径不要配置 `/ws`（WebSocket 不支持 HTTP 健康检查）

5. **在 vConsole 中查看**：真机调试时开启 vConsole，查看 `WebSocket` 相关错误信息

6. **常见错误码**：
   - `1006` — 连接异常关闭（通常是服务端崩溃或网络问题）
   - `1008` — 速率限制（客户端 30 条/秒超限）
   - `1013` — IP 连接数超限（单 IP > 20 个连接）

### 6.5 断线重连

**现象**：手机锁屏、切换后台、网络切换后游戏断开。

**行为说明**：
1. 客户端 `socket.ts` 实现了指数退避重连（最多 5 次，基础延迟 1 秒，最大 30 秒）
2. 重连成功后自动发送 `RECONNECT` 消息，服务端下发完整 `PlayerViewState`
3. 服务端心跳超时 30 秒，超时后关闭连接
4. 服务端在断线时调用 `revokePlayerTokens()` 吊销旧 session token — 客户端重连需要用新 token
5. **生产环境下**，客户端需要在重连前重新走 HTTP `/api/login/mock`（或正式 login）获取新 token

**调试重连**：
- 开发者工具中：点「模拟操作 → 断开网络」→ 再点「恢复网络」
- 观察控制台：`[socket] 将在 2.0s 后重连（第 2/5 次）`
- 如果 5 次后仍失败，触发 `FATAL` 事件，弹出模态框提示

---

## 7. 如何查看 CloudBase 日志

### 7.1 云托管日志

1. 登录 [CloudBase 控制台](https://console.cloud.tencent.com/tcb)
2. 进入环境 → 云托管 → 选择服务
3. 点击「日志」标签页
4. 可选择时间范围、日志级别（info/warn/error）
5. 搜索关键词（如 `playerId`、`roomCode`）定位问题

### 7.2 云函数日志

1. CloudBase 控制台 → 云函数
2. 选择函数名 → 「日志」标签
3. 可查看每次调用的请求参数、返回结果、`console.log` 输出

### 7.3 关键日志排查场景

| 场景 | 搜索关键词 |
|------|-----------|
| 登录失败 | `AUTH_FAILED`、`code2session` |
| 房间创建失败 | `createRoom`、`ROOM_FULL` |
| WebSocket 异常 | `ws`、`upgrade`、`heartbeat` |
| 游戏逻辑拒绝 | `ILLEGAL_ACTION`、`NOT_YOUR_TURN` |
| 服务器崩溃 | `Internal Server Error`、`uncaughtException` |

### 7.4 本地日志

本地开发时，`server/src/index.ts` 会输出到 stdout。使用 `npm run dev` 启动时日志直接显示在终端。生产环境建议接入 CloudBase 日志服务或使用 `console.log` 输出（云托管会自动收集 stdout/stderr）。

---

## 8. 环境变量清单

### 配置文件对照

| 文件 | 包含内容 | 提交 git |
|------|---------|----------|
| `.env.example` | 根环境变量模板 | ✅ |
| `server/.env.example` | 服务端环境变量模板 | ✅ |
| `.env.local` | 本地实际环境变量 | ❌ |
| `server/.env.local` | 服务端实际密钥 | ❌ |
| `miniprogram/config/index.ts` | 前端 URL / 环境 ID | ✅ |

### 服务端（server/.env.local 或云环境变量）

| 变量名 | 必需 | 说明 | 示例 |
|--------|------|------|------|
| `PORT` | 否 | 监听端口，默认 3000 | `3000` |
| `WX_APPID` | 生产必需 | 小程序 AppID | `wx1949e92d543a20ae` |
| `WX_APPSECRET` | 生产必需 | 小程序 AppSecret（仅服务端） | 从微信后台获取 |
| `TCB_ENV_ID` | 生产必需 | CloudBase 环境 ID | `cloud1-d9ggcgqxc02c1aea9` |

### 小程序端（miniprogram/config/index.ts）

| 变量名 | 开发值 | 生产值 |
|--------|--------|--------|
| `API_BASE_URL` | `http://localhost:3000/api` | `https://your-service-xxx.tcb-api.tencentcloudapi.com/api` |
| `WS_URL` | `ws://localhost:3000/ws` | `wss://your-service-xxx.tcb-api.tencentcloudapi.com/ws` |
| `CLOUD_ENV_ID` | `cloud1-d9ggcgqxc02c1aea9` | 实际 CloudBase 环境 ID |

### 不需要在前端配置的（安全红线）

这些值 **永远不要** 出现在 `miniprogram/config/index.ts` 或其他前端文件中：

- ❌ `WX_APPSECRET` — 仅 `server/.env.local` 或云环境变量
- ❌ `JWT_SECRET` — 仅 `server/.env.local` 或云环境变量（未来迁移 JWT 时）
- ❌ 数据库连接字符串 — 仅 server 环境变量
- ❌ CloudBase admin SDK 密钥 — 仅 server 环境变量
- ❌ 任何对称加密密钥

CI 中运行 `grep -rE "(secret|password|key)" miniprogram/ --include="*.ts"` 来自动化校验。

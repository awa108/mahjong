# 🀄 麻将小程序 (mahjong-miniapp)

微信原生小程序实现的 4 人实时联网麻将。**权威服务器 + 纯休闲不涉真钱。**

## 项目简介

这是一款面向亲友的线上休闲麻将工具。创建房间、分享房间码、凑齐 4 人、开始对战——像线下约局一样简单。

- 🏠 **房间制**：房主创建 → 分享 6 位房间码 → 好友加入 → 4 人齐备 → 开局
- 🔐 **权威服务器**：洗牌、发牌、吃碰杠胡、胜负判定全在服务端，客户端无法作弊
- 🛡️ **安全第一**：每条消息校验身份+座位+回合+合法性，手牌裁剪只显示本家
- ♻️ **断线重连**：网络切换或锁屏后自动恢复，游戏状态服务端保留
- 📐 **可扩展规则**：规则引擎接口化，后续可接入四川麻将、国标麻将等

> ⚠️ **合规声明**：本项目仅用于休闲娱乐，不包含真钱、充值、提现、代币兑换、房卡代理、积分结算。UI 文案全部使用"休闲""娱乐""好友约局"，无任何赌博相关词汇。

## 功能列表

| 功能 | 状态 |
|------|------|
| 创建房间（6 位房间码） | ✅ |
| 加入房间 | ✅ |
| 4 人准备 / 取消准备 | ✅ |
| 摸牌、出牌 | ✅ |
| 吃、碰、明杠、暗杠、补杠 | ✅ |
| 点炮胡、自摸胡 | ✅ |
| 流局 | ✅ |
| 一局结算（分数变化） | ✅ |
| 断线重连 | ✅ |
| WebSocket 心跳保活 | ✅ |
| 消息 seq 检测（丢包/乱序） | ✅ |
| 服务端快照恢复（SYNC） | ✅ |
| 频率限制 + IP 连接数限制 | ✅ |
| 安全审计（无密钥泄露、无赌博代码） | ✅ |
| 压测脚本（20 房间 80 连接） | ✅ |
| Mock login（本地开发） | ✅ |
| 微信 code2session 登录（生产） | 待配置 |

## 技术栈

| 层 | 技术 |
|----|------|
| 小程序前端 | 微信原生小程序 + TypeScript |
| 共享规则引擎 | TypeScript 纯函数（零运行时依赖） |
| 服务端 | Node.js + TypeScript + `ws` 库 |
| WebSocket | 自定义二进制/JSON 协议（权威服务器模式） |
| HTTP API | Node.js 内置 `http` 模块（无 express） |
| 存储（开发） | `MemoryStorage`（内存 Map） |
| 存储（生产） | CloudBase 云数据库（`CloudBaseStorage` 骨架） |
| 测试 | Vitest（233+ 测试，100% 通过） |
| 构建 | TypeScript `tsc` |
| 包管理 | npm workspaces（shared + server） |

## 目录结构

```
mahjong-miniapp/
├── shared/                  # @mahjong/shared 纯函数 + 类型（前后端共用）
│   ├── src/
│   │   ├── tiles.ts         # 136 张牌定义、排序、比较、洗牌、发牌
│   │   ├── types.ts         # 领域类型：Seat/Player/Room/Meld/GameState/PlayerViewState
│   │   ├── protocol.ts      # WebSocket 消息协议（客户端/服务端所有消息类型）
│   │   ├── rules.ts         # 规则引擎：checkHu, canChi/Peng/Gang/BuGang, Ruleset 接口
│   │   ├── validation.ts    # Zod 运行时消息校验 + parseClientMessage
│   │   └── index.ts         # 汇总导出
│   └── tests/               # 103 个单元测试
│
├── server/                  # @mahjong/server 权威游戏服务
│   ├── src/
│   │   ├── index.ts         # 入口：HTTP + WebSocket 共享端口启动
│   │   ├── ws/
│   │   │   ├── WebSocketServer.ts  # WS 核心：连接管理、消息路由、delta 广播、seq、限频
│   │   │   └── index.ts
│   │   ├── game/
│   │   │   ├── GameEngine.ts       # 权威状态机：play/peng/chi/gang/hu/pass/roundEnd
│   │   │   └── index.ts
│   │   ├── room/
│   │   │   └── RoomManager.ts      # 房间管理：创建/加入/离开/准备/分数
│   │   ├── auth/
│   │   │   └── AuthService.ts      # 认证：mock login + wx code2session + token 管理
│   │   ├── storage/
│   │   │   ├── types.ts            # IStorage 接口
│   │   │   ├── MemoryStorage.ts    # 内存存储（开发/测试）
│   │   │   ├── CloudBaseStorage.ts # CloudBase 数据库骨架（生产待接入）
│   │   │   └── index.ts
│   │   ├── http/
│   │   │   ├── routes.ts           # 简易路由器 + JSON body 解析
│   │   │   ├── registerRoutes.ts   # GET /api/health + POST /api/login/mock
│   │   │   └── createHttpServer.ts # 共享 HTTP+WS 服务器工厂
│   │   └── utils/
│   │       └── id.ts               # 唯一 ID 生成 + 6 位房间码
│   └── tests/                      # 137 个测试（含 4 玩家 WebSocket 集成测试）
│
├── miniprogram/             # 微信小程序前端
│   ├── config/
│   │   └── index.ts         # 统一配置：APP_ENV / API_BASE_URL / WS_URL
│   ├── pages/
│   │   ├── index/           # 首页：输入昵称 → 进入大厅
│   │   ├── lobby/           # 大厅：创建房间 / 加入房间
│   │   ├── room/            # 房间：座位展示 / 准备 / 开始
│   │   ├── game/            # 对局：手牌 / 弃牌河 / 操作栏
│   │   └── result/          # 结算：胜者 / 分差 / 事件日志
│   ├── components/
│   │   ├── tile/            # 单张牌组件
│   │   ├── player-panel/    # 玩家面板（昵称/分数/在线状态）
│   │   ├── discard-river/   # 弃牌河
│   │   └── action-bar/      # 操作栏（吃/碰/杠/胡/过）
│   ├── services/
│   │   ├── socket.ts        # WebSocket 封装（单例/心跳/重连/消息队列）
│   │   ├── api.ts           # HTTP API 封装
│   │   └── auth.ts          # 认证：mock login / wx.login → code2session
│   ├── app.ts / app.json / app.wxss
│   ├── project.config.json  # 微信开发者工具项目配置
│   └── tsconfig.json
│
├── docs/
│   ├── SPEC.md              # 技术规格（目标/技术栈/功能范围）
│   ├── WS_PROTOCOL.md       # WebSocket 消息协议详解
│   ├── RULES.md             # 简化四人麻将规则
│   ├── DEPLOY.md            # 部署指南（含真机联调）
│   └── COMPLIANCE.md        # 合规审查材料（审核用）
│
├── package.json             # npm workspaces 根
├── tsconfig.base.json       # 共享 TypeScript 编译器选项
├── CLAUDE.md                # Claude Code 项目指令
└── README.md                # 你正在看这个文件
```

## 本地启动步骤

### 1. 安装依赖

```bash
git clone <your-repo-url>
cd mahjong-miniapp
npm install
```

### 2. 构建 + 启动服务端

```bash
# 编译 shared + server
npm run build

# 启动 HTTP + WebSocket 共享服务（端口 3000）
npm run dev
```

服务端输出：
```
[mahjong-server] HTTP + WebSocket 服务器已启动，端口 3000
[mahjong-server] REST API: http://localhost:3000/api/health
[mahjong-server] WebSocket: ws://localhost:3000/ws
```

快速验证：
```bash
curl http://localhost:3000/api/health
# → {"status":"ok","uptime":1.234}

curl -X POST http://localhost:3000/api/login/mock \
  -H 'Content-Type: application/json' \
  -d '{"nickname":"测试"}'
# → {"playerId":"p_xxx","nickname":"测试","sessionToken":"abc123..."}
```

### 3. 打开微信开发者工具

1. 打开「微信开发者工具」
2. 导入项目 → 目录选 `mahjong-miniapp/miniprogram/`
3. AppID 选「测试号」，或填入你自己的真实 AppID
4. 在「详情 → 本地设置」中：
   - ✅ 勾选「不校验合法域名」
   - ✅ 确保 TypeScript 编译开启
5. 模拟器加载首页 → 输入昵称 → 点击「进入大厅」
6. 点击「创建房间」→ 创建成功会显示 6 位房间码

### 4. 多客户端测试

打开 4 个开发者工具实例或借助模拟器同时启动多个 WebSocket 客户端，就可以模拟完整 4 人对局流程。

**真机预览**：电脑和手机在同一局域网 → 修改 `miniprogram/config/index.ts` 中的 `localhost` 为电脑局域网 IP → 开发者工具点「预览」→ 手机扫码。

## 测试命令

```bash
# 全量测试（shared → server）
npm test

# 单独测试 shared（103 个测试）
cd shared && npm test

# 单独测试 server（137 个测试，含 HTTP + WS 集成）
cd server && npm test

# 仅跑 4 玩家集成测试
cd server && npx vitest run tests/simulate-four-players.test.ts

# 类型检查
npm run typecheck
```

当前测试状态：
```
shared:  3 files | 103 tests | ✅ 100% pass
server:  8 files | 137 tests | ✅ 100% pass
总计:    11 files | 240 tests | ✅ 100% pass
```

## 微信开发者工具导入方式

1. 打开 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 选择「导入项目」
3. 目录：`mahjong-miniapp/miniprogram/`
4. AppID 可以选「测试号」或你自己的真实 AppID
5. 本地开发必须勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」
6. 如果 TS 编译报错，确保详情中的 TypeScript 编译插件已开启

## CloudBase / 服务器部署

完整部署指南见 **[docs/DEPLOY.md](docs/DEPLOY.md)**，包含：

- CloudBase 云托管部署（Dockerfile + 环境变量）
- 自建服务器 Nginx 反向代理配置
- 微信公众平台后台配置（request/socket 合法域名）
- 真机调试常见问题（域名未配置、证书错误、WS 连接失败、断线重连）
- View CloudBase 日志
- 环境变量清单

### 生产环境 URL 示意

```
开发环境                        生产环境
────────────────────────────    ─────────────────────────────────
HTTP: localhost:3000/api        → https://api.example.com/api
WS:   localhost:3000/ws         → wss://api.example.com/ws
```

### 环境变量（服务端）

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `PORT` | 否 | 监听端口，默认 `3000` |
| `WX_APPID` | 生产必需 | 小程序 AppID |
| `WX_APPSECRET` | 生产必需 | 小程序 AppSecret（**不进前端代码**） |
| `TCB_ENV_ID` | 生产必需 | CloudBase 环境 ID |

> ⚠️ 前端 `miniprogram/config/index.ts` 中**绝对不包含**任何密钥。CI 中运行 `grep -rE "(secret|password|key)" miniprogram/config/` 自动校验。

## WebSocket 协议

详见 **[docs/WS_PROTOCOL.md](docs/WS_PROTOCOL.md)**。

核心设计：
- 每条服务端广播消息带递增 `seq`，客户端检测不连续时自动发 `SYNC` 请求快照
- 游戏消息使用 `STATE_DELTA` 增量发送（非完整 GameState），降低带宽
- 手牌裁剪：`toPlayerView()` 仅本家可见 `myHand`，对手仅见 `concealedCount`
- 牌墙剩余数量公开，但具体牌序客户端不可知

## 麻将规则

详见 **[docs/RULES.md](docs/RULES.md)**。

第一版"简化四人麻将"(simple4)：
- 136 张牌（万、筒、条、东南西北中发白各 ×4），无花牌
- 支持吃、碰、明杠、暗杠、补杠、点炮胡、自摸胡、流局
- 胡牌型：标准型（4 面子 + 1 雀头）
- 动作优先级：胡 > 杠 > 碰 > 吃
- 基分 = 1，自摸赢家 +3 / 其他 -1，点炮赢家 +3 / 放炮者 -3，流局不变

## 合规说明

本小程序定位为**纯休闲娱乐**产品：

- ❌ 不含任何支付功能（无 `wx.requestPayment`）
- ❌ 不含充值入口、虚拟货币、积分系统
- ❌ 不含提现、转账、代币兑换功能
- ❌ 不含房卡购买、道具商城、代理分销
- ❌ 不含抽奖、开箱、赌博类概率玩法
- ❌ 不含广告、激励视频、诱导分享
- ❌ UI 文案不含"赌""赢钱""下注""庄家""赔率""押""筹码"等词
- ✅ 首页底部有"纯娱乐 · 不涉真钱"明确标注

完整合规材料见 **[docs/COMPLIANCE.md](docs/COMPLIANCE.md)**。

## 常见问题

### Q: `npm install` 报错？

确保 Node.js ≥ 18，npm ≥ 9。使用 `node -v` 检查版本。

### Q: 开发者工具提示 TypeScript 编译失败？

检查 `project.config.json` 中 `"useCompilerPlugins": ["typescript"]` 是否已配置，并确保 `miniprogram/tsconfig.json` 的 `paths` 映射正确。

### Q: 如何用真机联调？

1. 确保手机和开发电脑同一 WiFi
2. 修改 `miniprogram/config/index.ts` 中 `localhost` 为电脑局域网 IP
3. 开发者工具点「预览」→ 手机扫码
4. 手机端调试：右上角 ··· → 开启 vConsole

### Q: WebSocket 连接失败？

- 本地开发：确认服务端已启动（`npm run dev`），确认「不校验合法域名」已勾选
- 生产环境：确认域名已在微信后台配置为 socket 合法域名，并以 `wss://` 开头
- 常见错误码：`1006`（连接异常关闭）、`1008`（速率超限）、`1013`（IP 连接数超限）

### Q: 断线后怎么恢复？

客户端 `socket.ts` 实现了指数退避重连（最多 5 次）。重连成功后自动发送 `RECONNECT`，服务端下发完整 `PlayerViewState`。如果 5 次后仍失败，会弹窗提示返回大厅，需重新登录获取新 token。

### Q: 如何支持更多玩家或观战？

当前 MVP 只支持 4 人房间。观战模式在后续扩展计划中（通过 `GameEvent` 事件日志回放实现）。

## 后续扩展计划

| 版本 | 计划 |
|------|------|
| v0.2 | 完善 `CloudBaseStorage` 接入，投入生产 |
| v0.3 | 七对胡牌型 |
| v0.4 | 正式微信登录（code2session 上线） |
| v1.0 | 好友邀请（微信分享卡片直达房间） |
| v1.1 | 对局回放（基于 `GameEvent` 事件日志） |
| v1.2 | 观战模式 |
| v2.0 | 四川麻将规则（血战到底） |
| v2.1 | 国标麻将规则（81 种番型） |
| v3.0 | AI 陪打（单人补位） |

如需在这些方向贡献代码，请参考 `CLAUDE.md` 中的架构原则和 `shared/src/rules.ts` 中 `Ruleset` 接口的扩展方式。

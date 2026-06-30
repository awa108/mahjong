# 麻将小程序 (mahjong-miniapp)

微信原生小程序实现的 4 人实时联网麻将 MVP。权威服务器模式，纯休闲不涉真钱。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 构建 shared（server 依赖其编译产物）
npx tsc -p shared/tsconfig.json

# 3. 跑所有测试
npm test

# 4. 启动 WebSocket 服务端（开发用）
node server/dist/index.js
```

## 环境变量

服务端通过环境变量配置，所有敏感密钥**仅存于服务端**，绝不写进前端代码。

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `PORT` | 否 | WebSocket 服务端口，默认 `8080` |
| `WX_APPID` | 否 | 微信小程序的 AppID（生产环境必需）。开发环境不设置即走 mock login |
| `WX_APPSECRET` | 否 | 微信小程序的 AppSecret（生产环境必需）。**严禁提交到版本管理** |
| `NODE_ENV` | 否 | `development` / `production`，影响日志等 |

### 开发环境

```bash
# 不设置 WX_APPID/WX_APPSECRET 时，服务端自动走 mock login
# mock code 格式：mock_<playerId>，如 mock_alice 会生成 playerId=alice
node server/dist/index.js
```

### 生产环境

```bash
WX_APPID=wx1234567890abcdef \
WX_APPSECRET=your_app_secret_here \
PORT=8080 \
node server/dist/index.js
```

## 各文件说明

### 根配置
| 文件 | 用途 |
|------|------|
| `package.json` | npm workspaces 根：workspaces 声明 shared + server，统一 build/test/typecheck 脚本 |
| `tsconfig.base.json` | 共享 TypeScript 编译器选项，各包 extends 它 |
| `.gitignore` | 排除 node_modules/dist/.env/coverage 等 |

### shared/ (@mahjong/shared)
| 文件 | 用途 |
|------|------|
| `package.json` | ESM 包，声明 dist/ 作为入口 |
| `tsconfig.json` | extends 根 tsconfig，输出到 dist |
| `src/tiles.ts` | 136 张牌定义、排序、比较、`fullDeck()`、`tileName()` |
| `src/types.ts` | 领域类型：`Seat`/`Player`/`Room`/`Meld`/`RoundState`/`ScoreResult` |
| `src/protocol.ts` | WebSocket 消息协议：`ClientMsg`/`ServerMsg` 全套类型 + `ErrorCode` 常量 |
| `src/rules.ts` | `Ruleset` 接口 + `simple4Rules` 实现：胡牌判定（标准型+七对）、吃/碰/杠校验、基础计分 |
| `src/index.ts` | 汇总导出，跨端统一入口 `import { … } from '@mahjong/shared'` |
| `tests/tiles.test.ts` | 牌张测试：136 张/每种4张/命名/排序 |
| `tests/rules.test.ts` | 规则测试：胡牌（标准+七对+非胡）/吃/碰/杠（明+暗+补）/计分/工具函数 |

### server/ (@mahjong/server)
| 文件 | 用途 |
|------|------|
| `package.json` | ESM 包，依赖 @mahjong/shared + ws |
| `tsconfig.json` | extends 根 tsconfig |
| `src/index.ts` | 启动入口：创建 WS Server 并监听 PORT，处理 SIGTERM |
| `src/ws/index.ts` | WebSocket 门面：连接管理、消息 echo 占位（后续接完整路由） |
| `src/room/index.ts` | 房间业务：创建/加入/准备/全员准备判定/状态流转 |
| `src/game/index.ts` | 规则引擎适配层：`getActiveRuleset()` 返回当前 Ruleset 实现 |
| `src/auth/token.ts` | 简易 session token 签发/校验（内存 Map，后续接微信 code2session+JWT） |
| `src/auth/AuthService.ts` | 完整认证服务：mock login（dev）、wx login（prod 通过 code2session）、session token 签发/校验/续期/吊销 |
| `src/auth/index.ts` | 重新导出 auth 模块 |
| `src/storage/index.ts` | 数据持久化占位（内存 Map，后续接 CloudBase 云数据库） |
| `src/utils/id.ts` | 6 位房间码生成（防混淆字符集）+ 会话内唯一 ID |
| `tests/smoke.test.ts` | 烟雾测试：房间码/Token 往返/建-加-备 流程/规则集加载 |
| `tests/auth-service.test.ts` | AuthService 测试：mock login / wx login mock fetch / token 校验 / 伪造拒绝 / 过期拒绝 / 续期 |

### miniprogram/ (微信小程序前端)
| 文件 | 用途 |
|------|------|
| `app.ts/json/wxss` | 小程序入口、页面路由表、全局样式 |
| `project.config.json` | 微信开发者工具项目配置（appid 需替换） |
| `tsconfig.json` | TS 配置，paths 映射到 shared/src 以获取类型 |
| `pages/index/` | 首页：输入昵称、创建/加入房间 |
| `pages/lobby/` | 大厅占位页（将来接匹配/规则选择） |
| `pages/room/` | 房间大厅：玩家列表、准备/取消、分享邀请 |
| `pages/game/` | 对局页：手牌滚动区、弃牌河、操作按钮 |
| `pages/result/` | 结算页：分数展示、返回房间 |
| `components/tile/` | 单张牌组件：名称 + 选中态 |
| `components/player-panel/` | 玩家面板组件：昵称/分数/准备/当前轮次 |
| `components/action-bar/` | 操作栏组件：摸/吃/碰/杠/胡/过 六键 |
| `components/discard-river/` | 弃牌河组件：按座次展示弃牌序列 |
| `services/socket.ts` | WebSocket 封装：建连/心跳/指数退避重连/消息路由 + 引用 shared 协议类型 |
| `services/api.ts` | HTTP 短请求封装：登录/建房/获取房间信息 |
| `services/auth.ts` | 认证：mock login（dev）/ wx.login → code2session（prod），本地缓存 sessionToken，不保存密钥 |
| `utils/index.ts` | 通用工具（防抖等） |

### docs/
| 文件 | 用途 |
|------|------|
| `SPEC.md` | 功能规格：目标/技术栈/功能范围/规则/权威服务器原则 |
| `WS_PROTOCOL.md` | WebSocket 消息协议详细说明 |
| `RULES.md` | 简化四人麻将规则详解 |
| `DEPLOY.md` | 部署指南：云托管/云函数/数据库/小程序端/安全检查 |

## 下一步（对应 CLAUDE.md 中的开发里程碑）

- **M1**：扩充 `shared/src/rules.ts` 为完整状态机（`GameState` + `applyAction`），并覆盖更多边界单测
- **M2**：在 `server/src/ws/index.ts` 中接入消息路由 + 房间逻辑 + 引擎调用
- **M3**：写 4 玩家 WebSocket 集成测试
- **M4**：miniprogram 各页面接入真实 WS 交互，联调跑通一局
- **M5**：断线重连（snapshot + seq 补发）
- **M6**：限流/房间清理/日志/上线打磨
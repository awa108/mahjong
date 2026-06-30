# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目目标

休闲联网微信麻将小程序，4 人实时房间制，136 张牌无花牌，支持吃碰杠胡。
**红线：不做赌博、不接充值、不提现、不积分兑钱、不房卡代理、不广告激励。**

## 命令

```bash
npm install                     # 根安装
npx tsc -p shared/tsconfig.json # 构建 shared（server 依赖其 dist）
npm test                        # 全量测试（shared → server）
cd shared && npm test           # 单独 shared
cd server && npm test           # 单独 server
npm run typecheck               # 全量类型检查
```

## 架构原则

- **权威服务器**：洗牌、发牌、动作校验、胜负判定全在 server。前端只展示 + 提交操作，自身不维护权威游戏状态。
- **客户端不可信**：任何到达 ws/room 的消息都须校验 `playerId`、`roomId`、当前 `turn`（是否该玩家回合）、action 合法性。非法动作拒绝并记录，不修改权威态。
- **手牌裁剪**：server 下发 snapshot 时按座位过滤 `concealed` 数组——仅本家可见自己手牌。牌墙剩余张数、具体牌序不下发给客户端。

## 代码规范

- `strict: true`，`noUncheckedIndexedAccess: true`，`noImplicitOverride: true`。
- 尽可能使用纯函数，不写不必要的副作用。
- 严禁 `any`（除非带注释说明必要原因，且在 CR 中可见）。
- 新增规则（四川/国标）只需实现 `Ruleset` 接口，不修改现有规则调用方。
- shared 代码零运行时环境依赖，可被前后端直接使用。

## 测试规范

- **shared 所有模块必须写单测**（Vitest），覆盖率目标 ≥ 90%。
- **server/ws 必须写集成测试**：模拟 4 个 WebSocket 客户端完整一局。
- **修 bug 前先写复现测试**，确认测试失败 → 修复 → 测试通过。
- 每次修改后必须运行相关测试（至少被修改包的测试），禁止跳过。汇报命令和结果。

## 安全规范

- `appSecret`、云环境密钥、DB 密钥 **仅存于 server 环境变量**。前端产物中禁止出现任何 secret（CI 中自动化 grep 校验）。
- WebSocket 每条消息必须校验：`token` → `uid` → 用户是否在对应 `roomId` → 是否当前 `turn` → `action` 是否合法。
- 房间码随机生成（6 位，防枚举），登录接口限频。
- HTTP API 和 WS 地址必须在微信小程序管理后台配置为合法域名，生产环境强制 `https` / `wss`。

## 微信小程序规范

- 生产环境 `socket.ts` 的 `WS_URL` 必须为 `wss://` 开头的已备案域名（云托管提供）。
- 生产环境 `api.ts` 的 `BASE_URL` 必须为 `https://` 的已配置合法域名。
- 小程序前端不调用 `wx.getUserProfile` 等已废弃 API；用户昵称/头像由用户手动输入或默认分配。
- 提交审核前确保未使用任何废弃接口，且隐私协议已配置。

## 目录速览

```
mahjong-miniapp/
├── shared/            ← @mahjong/shared 纯函数+类型（tiles/types/protocol/rules）
├── server/            ← @mahjong/server 权威服务（ws/room/game/auth/storage）
├── miniprogram/       ← 微信原生小程序（pages/components/services）
├── docs/              ← SPEC / WS_PROTOCOL / RULES / DEPLOY
├── package.json       ← npm workspaces 根（workspaces: shared, server）
└── tsconfig.base.json
```

shared 在小程序端的引用：`tsconfig.json` 配置 `paths: { "@mahjong/shared": ["../shared/src/index.ts"] }`，
编译期获取类型，运行时零依赖。
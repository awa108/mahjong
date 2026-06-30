# WS_PROTOCOL — WebSocket 消息协议

字面量定义见 `shared/src/protocol.ts`，此文档为设计说明。

## 信封
```json
{ "t": "<type>", "id": "可选", "seq": 0, "data": {...} }
```
- `t`：消息类型
- `id`：客户端请求 id，服务端 ack 回填
- `seq`：服务端递增序号，断线补发用

## 客户端 → 服务端

| t | 说明 |
|---|------|
| `hello` | 鉴权 + 加入/恢复房间 |
| `ready` | 准备 |
| `draw` | 摸牌 |
| `discard` | 出牌 |
| `claim` | 吃/碰/杠 |
| `win` | 声明胡 |
| `pass` | 放弃操作机会 |
| `sync` | 请求全量快照（重连时） |

## 服务端 → 客户端

| t | 说明 |
|---|------|
| `welcome` | 鉴权成功，告知座位 |
| `snapshot` | 全量可见状态（裁剪后） |
| `dealt` | 发牌（仅本家手牌） |
| `turn` | 轮到谁，可做哪些动作 |
| `drawn` | 摸牌结果 |
| `discarded` | 出牌广播 |
| `claimed` | 吃碰杠声明广播 |
| `win` | 胡牌结算 |
| `draw_round` | 流局 |
| `round_end` | 单局结算 |
| `error` | 错误 |

## 可见性规则
- 手牌：仅本人可见
- 牌墙/王牌/岭上牌：客户端不可见
- 他家副露：所有人可见

## 错误码
- AUTH_FAILED / NOT_YOUR_TURN / ILLEGAL_ACTION / ROOM_FULL / ROOM_NOT_FOUND / INTERNAL
/**
 * game 模块：封装 shared 规则引擎，作为服务器端权威游戏逻辑入口。
 * 未来完整的 GameState 状态机迁移到 shared/engine 后，这里将变为薄适配层。
 */
import { simple4Rules, type Ruleset } from '@mahjong/shared';

/** 当前 MVP 使用的规则集。以后通过 room 动态选择。 */
export function getActiveRuleset(): Ruleset {
  return simple4Rules;
}
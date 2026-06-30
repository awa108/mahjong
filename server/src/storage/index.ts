/**
 * storage — 数据持久化模块。
 *
 * IStorage 接口 + MemoryStorage 实现 + CloudBaseStorage 骨架。
 * 业务代码只依赖 IStorage，通过构造函数注入具体实现。
 */
export type { IStorage, UserRecord, GameRecord, GameEventRecord, ReconnectSession } from './types.js';
export { MemoryStorage } from './MemoryStorage.js';
export { CloudBaseStorage } from './CloudBaseStorage.js';

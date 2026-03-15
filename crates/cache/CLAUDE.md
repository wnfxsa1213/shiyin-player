[根目录](../../CLAUDE.md) > [crates](../) > **cache**

# crates/cache - 内存 LRU 搜索缓存

## 变更记录 (Changelog)

| 时间 | 操作 | 说明 |
|------|------|------|
| 2026-03-15T11:22:14 | 校验 | 无代码变更，确认文档仍准确 |
| 2026-02-24T22:48:14 | 初始化 | 首次扫描生成文档 |

## 模块职责

提供基于 LRU 的内存搜索结果缓存，作为三级缓存架构的 L1 层（L1 内存 -> L2 SQLite -> L3 API）。

## 入口与启动

- 入口文件：`src/lib.rs`
- `SearchCache::new()` 创建缓存实例

## 对外接口

- `SearchCache::new()` - 创建缓存（默认 128 容量，5 分钟 TTL）
- `SearchCache::get(source, keyword)` -> `Option<Vec<Track>>` - 查询缓存，自动过期淘汰
- `SearchCache::set(source, keyword, tracks)` - 写入缓存

## 关键依赖与配置

- `lru` 0.12 - LRU 缓存实现
- `rustplayer-core` - Track 和 MusicSourceId 类型

## 数据模型

- 缓存键：`(MusicSourceId, String)` 即 (音源, 关键词)
- 缓存值：`CacheEntry<Vec<Track>>`，包含过期时间戳
- 默认 TTL：300 秒（5 分钟）
- 默认容量：128 条
- 线程安全：`Mutex<LruCache<...>>`

## 测试与质量

当前无测试文件。建议测试方向：TTL 过期逻辑、LRU 淘汰、并发访问。

## 相关文件清单

- `src/lib.rs` - SearchCache 实现

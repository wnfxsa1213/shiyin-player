[根目录](../../CLAUDE.md) > [crates](../) > **sources**

# crates/sources - 音乐源注册表

## 变更记录 (Changelog)

| 时间 | 操作 | 说明 |
|------|------|------|
| 2026-03-15T11:22:14 | 校验 | 无代码变更，确认文档仍准确 |
| 2026-02-24T22:48:14 | 初始化 | 首次扫描生成文档 |

## 模块职责

提供 `SourceRegistry`，统一管理多个 `MusicSource` 实现的注册与查找。

## 入口与启动

- 入口文件：`src/lib.rs`
- 纯库模块，无运行时入口

## 对外接口

- `SourceRegistry::new()` - 创建空注册表
- `SourceRegistry::register(source)` - 注册一个 `Arc<dyn MusicSource>`
- `SourceRegistry::get(id)` -> `Option<&Arc<dyn MusicSource>>` - 按 MusicSourceId 查找
- `SourceRegistry::all()` -> `&[Arc<dyn MusicSource>]` - 获取所有已注册音源

## 关键依赖与配置

- `rustplayer-core` - MusicSource trait 和 MusicSourceId
- `async-trait` - 异步 trait 支持

## 测试与质量

当前无测试文件。

## 相关文件清单

- `src/lib.rs` - SourceRegistry 实现

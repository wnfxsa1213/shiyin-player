[根目录](../../CLAUDE.md) > [crates](../) > **recommend**

# crates/recommend - 本地推荐引擎

## 变更记录 (Changelog)

| 时间 | 操作 | 说明 |
|------|------|------|
| 2026-03-15T11:22:14 | 初始化 | 首次扫描生成文档 |

## 模块职责

纯算法库，基于本地播放行为数据构建用户画像，对平台推荐结果进行混合重排序，并提供艺术家推荐和"重温经典"选曲。不依赖任何网络或 Tauri 运行时。

## 入口与启动

- 入口文件：`src/lib.rs`
- 纯库模块，无运行时入口
- 公开 API：`normalize_artist`、`build_profile`、`UserProfile`、`rerank`、`suggest_artists`、`pick_rediscover`

## 对外接口

### 用户画像 (`profile.rs`)

- `build_profile(artist_stats: &[ArtistPreference]) -> UserProfile` - 从预聚合的艺术家统计构建用户画像
- `UserProfile` - 包含 `artist_scores: HashMap<String, f64>` 和 `max_artist_score: f64`

### 混合重排序 (`rerank.rs`)

- `rerank(tracks, profile, recent_ids) -> Vec<Track>` - 对平台推荐歌曲进行混合重排序
  - 权重：平台排名 30% + 艺术家偏好 50% + 新鲜度 20%
  - 多样性约束：同一艺术家最多连续 2 首
  - 最近 24 小时播放过的曲目新鲜度降为 0

### 艺术家推荐 (`suggest.rs`)

- `suggest_artists(artist_stats, limit) -> Vec<ArtistPreference>` - 返回 Top N 偏好艺术家，跨音源合并（标准化名称去重）
- `pick_rediscover(stale_tracks, limit) -> Vec<Track>` - 从长期未播放的历史高频曲目中选取"重温经典"

### 名称标准化 (`normalize.rs`)

- `normalize_artist(name) -> String` - 艺术家名称标准化：小写、去首尾空格、折叠连续空格、分隔符（`/`、`、`、`·`）转为空格

## 关键依赖与配置

- `rustplayer-core` - `Track`、`ArtistPreference` 类型

## 数据模型

### 重排序权重常量

| 常量 | 值 | 说明 |
|------|-----|------|
| `WEIGHT_PLATFORM_RANK` | 0.30 | 保留平台推荐的原始排名信号 |
| `WEIGHT_ARTIST_PREF` | 0.50 | 用户对艺术家的偏好权重（最高） |
| `WEIGHT_FRESHNESS` | 0.20 | 最近未播放的曲目获得更高分 |
| `MAX_CONSECUTIVE_SAME_ARTIST` | 2 | 多样性约束：同一艺术家最多连续出现次数 |

### 算法流程

1. 对每首曲目计算混合分数 = `rank_score * 0.3 + artist_score * 0.5 + freshness_score * 0.2`
2. 按分数降序稳定排序
3. 应用多样性约束：若连续同艺术家超过 2 首，后续曲目延迟插入

## 测试与质量

已有单元测试（4 个）：
- `test_normalize_basic` - 基本英文名称标准化
- `test_normalize_chinese` - 中文名称标准化
- `test_normalize_separators` - 分隔符处理
- `test_normalize_empty` - 空字符串边界

建议补充测试：`rerank` 排序正确性、`build_profile` 分数合并、`suggest_artists` 去重合并、`pick_rediscover` 边界条件。

## 常见问题 (FAQ)

- **Q: 推荐引擎何时启用个性化排序？** A: 需要至少 10 条播放事件（`event_count >= 10`），否则返回平台原始排序。
- **Q: 艺术家偏好分数如何计算？** A: 由 `db.rs` 中的 `get_artist_stats` 计算：`score = play_count * avg_completion_rate * recency_factor`，其中 recency 从 1.0 衰减到 0.3。

## 相关文件清单

- `src/lib.rs` - 模块入口与公开 API 导出（10 行）
- `src/profile.rs` - 用户画像构建（41 行）
- `src/rerank.rs` - 混合重排序算法（129 行）
- `src/suggest.rs` - 艺术家推荐与重温经典（44 行）
- `src/normalize.rs` - 名称标准化 + 单元测试（67 行）
- `Cargo.toml` - 依赖配置

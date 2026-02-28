# 拾音 (RustPlayer) 项目路线图

> 最后更新：2026-02-27

## 📊 竞品对比分析

### 对标项目：YesPlayMusic

**YesPlayMusic 概况：**
- 技术栈：Vue.js + Electron
- 开发历史：6年，727次提交，28.6k stars
- 音源：仅网易云音乐
- 状态：2.0 Alpha 发布，1.x 进入维护模式

## 🎯 拾音的核心优势

### 技术架构层面
- ✅ **性能优势**：Rust + Tauri 内存占用约为 Electron 的 1/3-1/2
- ✅ **启动速度**：Tauri 应用启动显著快于 Electron
- ✅ **模块化设计**：workspace 架构清晰，crate 职责分明
- ✅ **类型安全**：Rust 端到端类型安全，减少运行时错误

### 功能差异化
- ✅ **双音源支持**：网易云 + QQ音乐，曲库覆盖更广
- ✅ **频谱可视化**：基于 GStreamer 的实时频谱分析
- ✅ **动态主题色**：从专辑封面提取主题色
- ✅ **现代技术栈**：React 18 + Zustand + Tailwind CSS

## ⚠️ 当前劣势与差距

### 功能完整度
- ❌ 缺少 MV 播放
- ❌ 缺少私人 FM / 每日推荐
- ❌ 缺少音乐云盘
- ❌ 缺少 Last.fm Scrobble
- ❌ 缺少 UnblockNeteaseMusic 灰色歌曲解锁
- ❌ 缺少全局快捷键
- ❌ 缺少 Mpris 支持（Linux 媒体控制）

### 生态成熟度
- ❌ 社区规模小
- ❌ 缺少多种部署方式（Web版、Docker等）
- ❌ 文档和用户反馈不足
- ❌ 缺少测试覆盖

### 用户体验
- ❌ 缺少多种登录方式（扫码/手机/邮箱）
- ❌ 缺少搜索历史
- ❌ 缺少播放队列高级管理
- ❌ 缺少 PWA 支持

---

## 🚀 迭代计划

## 第一阶段：功能对等（1-2个月）

### 核心功能补齐

#### 登录与账号
- [ ] 实现网易云扫码登录
- [ ] 实现网易云手机号登录
- [ ] 实现网易云邮箱登录
- [ ] 实现 QQ音乐扫码登录
- [ ] 实现 QQ音乐手机号登录
- [ ] 账号信息持久化与自动登录

#### 推荐与发现
- [ ] 实现私人 FM 功能（网易云）
- [ ] 实现每日推荐歌曲（网易云）
- [ ] 实现每日推荐歌单（网易云）
- [ ] 实现 QQ音乐每日推荐
- [ ] 实现音乐排行榜

#### 系统集成
- [ ] 添加全局快捷键支持（播放/暂停、上一曲/下一曲、音量控制）
- [ ] 实现 Mpris 协议（Linux 媒体控制）
- [ ] 实现 macOS Touch Bar 支持
- [ ] 实现系统托盘功能
- [ ] 实现桌面通知（正在播放）

### 用户体验完善

#### 搜索与历史
- [ ] 添加搜索历史记录
- [ ] 实现搜索建议/自动完成
- [ ] 搜索结果分类展示（单曲/专辑/歌手/歌单）
- [ ] 热门搜索词展示

#### 播放队列管理
- [ ] 播放队列拖拽排序
- [ ] 播放队列批量操作（删除、清空）
- [ ] 播放历史记录
- [ ] 播放模式切换（顺序/随机/单曲循环）

#### 收藏与管理
- [ ] 歌曲收藏/喜欢功能
- [ ] 创建自定义歌单
- [ ] 歌单编辑（添加/删除歌曲）
- [ ] 歌单导入/导出（JSON格式）
- [ ] 收藏的歌手/专辑

#### 设置与配置
- [ ] 快捷键配置界面
- [ ] 音质选择（标准/高品质/无损）
- [ ] 缓存管理（查看大小、清理缓存）
- [ ] 主题切换（浅色/深色/自动）
- [ ] 启动设置（开机自启、最小化启动）

### 测试与文档

#### 测试覆盖
- [ ] Rust 单元测试（weapi 加密、QQ音乐签名、LRC 解析）
- [ ] Rust 集成测试（API 客户端 mock 测试）
- [ ] 前端单元测试（Zustand store 逻辑）
- [ ] E2E 测试（Tauri test utils）
- [ ] 目标覆盖率：60%+

#### 文档完善
- [ ] 完善 README（添加功能截图）
- [ ] 添加功能对比表（vs YesPlayMusic）
- [ ] 编写用户手册
- [ ] 编写开发者文档
- [ ] 添加贡献指南（CONTRIBUTING.md）
- [ ] 添加变更日志（CHANGELOG.md）

---

## 第二阶段：差异化创新（3-6个月）

### 多音源智能整合

#### 智能切换
- [ ] 音源可用性检测（版权、VIP限制）
- [ ] 自动切换音源（A平台无版权时切换到B平台）
- [ ] 音质对比与优选
- [ ] 音源优先级配置

#### 跨平台同步
- [ ] 歌单跨平台同步（网易云 ↔ QQ音乐）
- [ ] 收藏歌曲同步
- [ ] 播放历史同步
- [ ] 冲突解决策略

#### 搜索增强
- [ ] 跨平台搜索结果聚合
- [ ] 搜索结果去重
- [ ] 搜索结果排序优化

### 音源扩展

- [ ] 接入 Spotify（需要 Premium）
- [ ] 接入 YouTube Music
- [ ] 本地音乐库管理（扫描、导入、元数据编辑）
- [ ] 支持 UnblockNeteaseMusic（灰色歌曲解锁）
- [ ] 支持自定义音源插件

### 高级音频功能

#### 可视化增强
- [ ] 多种频谱可视化效果（柱状图、波形、圆形）
- [ ] 可视化效果自定义（颜色、灵敏度）
- [ ] 全屏可视化模式
- [ ] 歌词与可视化联动

#### 音效处理
- [ ] 音效均衡器（10段EQ）
- [ ] 预设音效（流行、摇滚、古典等）
- [ ] 音量标准化
- [ ] 淡入淡出效果

#### 歌词增强
- [ ] AI 歌词翻译（利用本地 LLM）
- [ ] 歌词逐字高亮
- [ ] 歌词编辑与上传
- [ ] 双语歌词显示

### 社区建设

#### 发布渠道
- [ ] 发布到 AUR（Arch Linux）
- [ ] 发布到 Homebrew（macOS）
- [ ] 发布到 Scoop（Windows）
- [ ] 发布到 Flathub（Linux）
- [ ] 发布到 Snap Store（Linux）

#### 社区运营
- [ ] 建立用户社区（Telegram/Discord）
- [ ] 收集用户反馈
- [ ] 定期发布更新日志
- [ ] 举办功能投票活动

---

## 第三阶段：平台扩展（6个月+）

### 平台多样化

#### Web 版本
- [ ] WASM 编译支持
- [ ] Tauri API polyfill
- [ ] Web 端部署方案（Vercel/Netlify）
- [ ] PWA 支持

#### 移动端
- [ ] Tauri Mobile 适配（Android）
- [ ] Tauri Mobile 适配（iOS）
- [ ] 移动端 UI 优化
- [ ] 移动端手势支持

#### 服务器版
- [ ] Headless mode（无界面运行）
- [ ] Web UI 控制面板
- [ ] 多用户支持
- [ ] API 接口开放

### 高级功能

#### 社交与分享
- [ ] Last.fm Scrobble
- [ ] ListenBrainz Scrobble
- [ ] 播放统计与年度报告
- [ ] 社区歌单分享
- [ ] 歌单评论与点赞

#### 云服务
- [ ] 音乐云盘（自建存储）
- [ ] 云端配置同步
- [ ] 跨设备播放进度同步
- [ ] 云端歌单备份

#### 内容扩展
- [ ] 播客支持
- [ ] 有声书支持
- [ ] MV 播放
- [ ] 演唱会直播

### 插件系统

- [ ] 插件 API 设计
- [ ] Rust WASM 插件支持
- [ ] 插件市场
- [ ] 插件开发文档
- [ ] 示例插件（音源适配器、可视化效果）

### 性能优化

#### 内存优化
- [ ] 优化缓存策略
- [ ] 减少内存占用（目标 < 100MB）
- [ ] 内存泄漏检测与修复

#### 启动优化
- [ ] 延迟加载非核心模块
- [ ] 优化启动时间（目标 < 1s）
- [ ] 启动画面优化

#### 安装包优化
- [ ] 实现增量更新
- [ ] 减少安装包大小
- [ ] 压缩资源文件

---

## 💡 核心竞争力方向

### 1. 多音源智能整合（首要差异化）
不只是简单支持多平台，而是：
- 智能切换：版权互补、音质优选
- 歌单互通：跨平台同步与迁移
- 统一体验：一致的 UI/UX

### 2. 极致性能（技术优势）
充分发挥 Rust + Tauri 优势：
- 最轻量的桌面音乐播放器
- 最快的启动速度
- 最低的资源占用

### 3. 开发者友好（生态建设）
- 模块化架构，易于扩展
- 插件系统，社区贡献音源适配器
- 完善的开发文档

### 4. Linux 优先（细分市场）
YesPlayMusic 在 Linux 上体验一般，针对性优化：
- Wayland 原生支持
- 深度系统集成（Mpris、通知、托盘）
- 各大发行版软件源收录

---

## 📈 里程碑

### v0.2.0 - 功能对等版（预计 2026-04）
- ✅ 完成第一阶段所有核心功能
- ✅ 测试覆盖率达到 60%
- ✅ 发布到主流软件源

### v0.3.0 - 差异化版（预计 2026-07）
- ✅ 完成多音源智能整合
- ✅ 实现高级音频功能
- ✅ 社区规模达到 1000+ 用户

### v1.0.0 - 稳定版（预计 2026-10）
- ✅ 完成所有核心功能
- ✅ 测试覆盖率达到 80%
- ✅ 性能指标达标
- ✅ 文档完善

### v2.0.0 - 平台扩展版（预计 2027+）
- ✅ 支持 Web/Mobile/Server
- ✅ 插件系统上线
- ✅ 社区生态成熟

---

## 🎯 当前优先级（按重要性排序）

1. **登录功能**（扫码/手机/邮箱）- 用户留存的基础
2. **私人 FM / 每日推荐** - 核心使用场景
3. **全局快捷键 + Mpris** - 系统集成体验
4. **搜索历史 + 收藏功能** - 基础用户体验
5. **测试覆盖** - 保证质量
6. **文档完善** - 吸引用户和贡献者

---

## 📝 备注

- 本路线图为动态文档，会根据用户反馈和技术发展调整
- 优先级会根据社区投票和实际需求变化
- 欢迎通过 Issue 提出建议和反馈
1. 私人 FM / 每日推荐 ⭐⭐⭐⭐⭐

  YesPlayMusic 的实现：
  - 私人 FM：基于用户听歌习惯的电台模式
  - 每日推荐：每天推荐 30 首歌曲

  为什么值得学习：
  - 提升用户粘性（每天打开应用的理由）
  - 降低选择困难（不知道听什么时的解决方案）
  - 利用平台算法优势

  实现建议：
  // crates/core/src/lib.rs
  #[async_trait]
  pub trait MusicSource {
      // 现有方法...

      // 新增方法
      async fn get_personal_fm(&self) -> Result<Vec<Track>, SourceError> {
          Err(SourceError::Unimplemented)
      }

      async fn get_daily_recommendations(&self) -> Result<Vec<Track>,
  SourceError> {
          Err(SourceError::Unimplemented)
      }
  }

  优先级：⭐⭐⭐⭐⭐（强烈推荐）

  ---
  2. MV 播放 ⭐⭐⭐

  YesPlayMusic 的实现：
  - 支持播放音乐视频
  - 与音频播放无缝切换

  为什么值得学习：
  - 丰富内容形式
  - 提升用户体验（部分歌曲 MV 很精彩）

  实现挑战：
  - 需要视频播放器组件（GStreamer 已支持视频）
  - UI 需要适配视频播放界面
  - 流量消耗较大

  优先级：⭐⭐⭐（中等优先级，可作为高级功能）

  ---
  3. Last.fm Scrobble ⭐⭐⭐⭐

  YesPlayMusic 的实现：
  - 自动记录播放历史到 Last.fm
  - 同步听歌数据

  为什么值得学习：
  - 满足音乐发烧友需求
  - 数据可视化（年度报告等）
  - 社交分享功能

  实现建议：
  // crates/core/src/lib.rs
  pub struct ScrobbleInfo {
      pub track: Track,
      pub timestamp: u64,
      pub duration_played: u64,
  }

  // 新增 crate: crates/scrobble
  pub trait ScrobbleService {
      async fn scrobble(&self, info: ScrobbleInfo) -> Result<(), ScrobbleError>;
      async fn update_now_playing(&self, track: Track) -> Result<(),
  ScrobbleError>;
  }

  优先级：⭐⭐⭐⭐（推荐实现）

  ---
  4. 音乐云盘 ⭐⭐⭐⭐

  YesPlayMusic 的实现：
  - 支持播放网易云音乐云盘中的歌曲
  - 上传本地音乐到云盘

  为什么值得学习：
  - 解决版权限制（用户自己的音乐）
  - 跨设备同步
  - 本地音乐管理

  实现建议：
  #[async_trait]
  pub trait MusicSource {
      // 云盘相关
      async fn get_cloud_tracks(&self) -> Result<Vec<Track>, SourceError> {
          Err(SourceError::Unimplemented)
      }

      async fn upload_to_cloud(&self, file_path: &str) -> Result<Track,
  SourceError> {
          Err(SourceError::Unimplemented)
      }

      async fn delete_from_cloud(&self, track_id: &str) -> Result<(),
  SourceError> {
          Err(SourceError::Unimplemented)
      }
  }

  优先级：⭐⭐⭐⭐（推荐实现）

  ---
  5. 全局快捷键 ⭐⭐⭐⭐⭐

  YesPlayMusic 的实现：
  - 支持自定义全局快捷键
  - 应用在后台时也能控制播放

  为什么值得学习：
  - 极大提升用户体验（不需要切换窗口）
  - 音乐播放器的标配功能

  实现建议：
  // 使用 tauri-plugin-global-shortcut
  // Cargo.toml
  [dependencies]
  tauri-plugin-global-shortcut = "2.0"

  // main.rs
  use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

  fn main() {
      tauri::Builder::default()
          .plugin(tauri_plugin_global_shortcut::init())
          .setup(|app| {
              // 注册全局快捷键
              app.global_shortcut().register("MediaPlayPause")?;
              app.global_shortcut().register("MediaNextTrack")?;
              app.global_shortcut().register("MediaPreviousTrack")?;
              Ok(())
          })
          .run(tauri::generate_context!())
          .expect("error while running tauri application");
  }

  优先级：⭐⭐⭐⭐⭐（强烈推荐，Linux 音乐播放器必备）

  ---
  6. MPRIS 支持 ⭐⭐⭐⭐⭐

  YesPlayMusic 的实现：
  - 支持 Linux MPRIS 协议
  - 与系统媒体控制集成（KDE/GNOME 媒体控制面板）

  为什么值得学习：
  - Linux 桌面的标准协议
  - 与系统深度集成（通知栏控制、锁屏界面控制）
  - 支持蓝牙耳机媒体按键

  实现建议：
  // Cargo.toml
  [dependencies]
  mpris-server = "0.8"

  // 新增 crates/mpris
  use mpris_server::{Server, Player, PlaybackStatus, Metadata};

  pub struct MprisIntegration {
      server: Server,
      player: Player,
  }

  impl MprisIntegration {
      pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
          let server = Server::new("rustplayer")?;
          let player = server.create_player("RustPlayer", "RustPlayer")?;
          Ok(Self { server, player })
      }

      pub fn update_metadata(&self, track: &Track) {
          let metadata = Metadata::builder()
              .title(track.name.clone())
              .artist(vec![track.artist.clone()])
              .album(track.album.clone())
              .build();
          self.player.set_metadata(metadata);
      }

      pub fn set_playback_status(&self, status: PlaybackStatus) {
          self.player.set_playback_status(status);
      }
  }

  优先级：⭐⭐⭐⭐⭐（强烈推荐，Linux 专属优势）

  ---
  7. 每日自动签到 ⭐⭐

  YesPlayMusic 的实现：
  - 自动签到网易云音乐（手机端 + 电脑端）
  - 获取每日积分

  为什么值得学习：
  - 用户便利性（不用手动签到）
  - 增加用户粘性

  实现建议：
  // 使用定时任务
  use tokio::time::{interval, Duration};

  async fn daily_checkin_task(netease_client: Arc<NeteaseClient>) {
      let mut interval = interval(Duration::from_secs(86400)); // 24小时
      loop {
          interval.tick().await;
          if let Err(e) = netease_client.daily_checkin().await {
              eprintln!("签到失败: {}", e);
          }
      }
  }

  优先级：⭐⭐（低优先级，可选功能）

  ---
  8. UnblockNeteaseMusic 集成 ⭐⭐⭐

  YesPlayMusic 的实现：
  - 自动检测灰色歌曲
  - 从其他音源（QQ 音乐、YouTube 等）获取替代链接

  为什么值得学习：
  - 解决版权限制问题
  - 提升歌曲可用性

  实现建议：
  // 作为可选功能
  pub struct UnblockService {
      proxy_url: String,
  }

  impl UnblockService {
      pub async fn get_alternative_url(&self, track_id: &str) -> Result<String,
  SourceError> {
          // 调用 UnblockNeteaseMusic API
          // 返回替代音源 URL
      }
  }

  优先级：⭐⭐⭐（中等优先级，但有法律风险）

  ---
  功能优先级排序

  ┌────────┬─────────────────────┬──────────────────────────────┐
  │ 优先级 │        功能         │             理由             │
  ├────────┼─────────────────────┼──────────────────────────────┤
  │ 🔥 P0  │ MPRIS 支持          │ Linux 桌面标准，系统集成必备 │
  ├────────┼─────────────────────┼──────────────────────────────┤
  │ 🔥 P0  │ 全局快捷键          │ 音乐播放器标配，用户体验关键 │
  ├────────┼─────────────────────┼──────────────────────────────┤
  │ ⭐ P1  │ 私人 FM / 每日推荐  │ 提升用户粘性，差异化功能     │
  ├────────┼─────────────────────┼──────────────────────────────┤
  │ ⭐ P1  │ Last.fm Scrobble    │ 满足发烧友需求，数据可视化   │
  ├────────┼─────────────────────┼──────────────────────────────┤
  │ ⭐ P1  │ 音乐云盘            │ 解决版权限制，本地音乐管理   │
  ├────────┼─────────────────────┼──────────────────────────────┤
  │ 📦 P2  │ MV 播放             │ 丰富内容形式，高级功能       │
  ├────────┼─────────────────────┼──────────────────────────────┤
  │ 📦 P2  │ UnblockNeteaseMusic │ 提升可用性，但有法律风险     │
  ├────────┼─────────────────────┼──────────────────────────────┤
  │ 🎁 P3  │ 每日自动签到        │ 便利性功能，非核心           │
  └────────┴─────────────────────┴──────────────────────────────┘

  ---
  建议实施路线

  第一阶段（核心体验）

  1. MPRIS 支持 - 与 Linux 桌面深度集成
  2. 全局快捷键 - 后台控制播放

  第二阶段（内容丰富）

  3. 私人 FM / 每日推荐 - 智能推荐
  4. 音乐云盘 - 本地音乐管理

  第三阶段（高级功能）

  5. Last.fm Scrobble - 数据同步
  6. MV 播放 - 视频内容

  需要我帮你实现其中某个功能吗？我推荐从 MPRIS 支持或全局快捷键开始，这两个是
  Linux 音乐播放器的标配功能。

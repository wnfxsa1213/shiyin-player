# Linux 原生场景压力测试

此入口打包真实 React App，并运行使用 `tauri/custom-protocol` 的 Rust 发布构建。背景导入、图片协议、设置保存和频谱事件通过真实 Tauri IPC；音乐播放身份、频谱、歌词及音乐发现使用固定测试数据，不产生声音或使用账号。

需要已有项目依赖、Python 3、python3-pil、X11/libX11 和 xprop；NVIDIA 指标还需要 `nvidia-smi`。从仓库根目录运行：

```bash
node scripts/scene-stress/build.mjs work/scene-stress
/usr/bin/python3 scripts/scene-stress/run.py work/scene-stress --quick --name pilot
/usr/bin/python3 scripts/scene-stress/run.py work/scene-stress --name full
/usr/bin/python3 scripts/scene-stress/summarize.py work/scene-stress/full/report.json
```

`build.mjs` 通过临时 Tauri 构建配置创建 `work/scene-stress/scene-stress`，额外窗口控制能力只存在于该测试包。`run.py` 创建独立的 XDG 数据和缓存目录，只采集其启动的进程及子进程，并仅激活该进程的窗口。每次使用新的 `--name`，保护已有测试记录。关闭窗口可以中止；超时或进程树超过 3 GiB 的测试内存预算也会结束运行。

测试包要求隔离运行标记，直接双击不会开始修改场景。构建结束后会恢复常规 release 二进制。可追加 `--foreground`，在动态采样期间每四秒激活一次测试窗口，进行前台对照；报告仍以实际记录到的焦点状态为准。

完整流程覆盖：初始空闲、三张 3840×2160 图片导入和去重、100 套搭配、5000 条队列滚动、八种效果的预热和强频谱输入、2560×1440 图片背景、三轮共 240 次应用切换、100 次预览选择、隐藏/恢复，以及最终停绘。CPU/PSS/RSS 和可获得的 GPU 数据约每秒采样；检查结果和按阶段聚合保存在输出目录。

指标解释：

- CPU 的 100% 表示一个逻辑核，不是全机占用率。
- PSS 为进程树的比例分摊内存，RSS 求和可能重复计算共享页；无法完整读取 PSS 时不报告完整 PSS。
- GPU framebuffer 与 SM 指标仅统计 `nvidia-smi pmon` 中属于该进程树的条目，`-` 表示不可用。整卡利用率与功耗同时受桌面和其他程序影响，不能全部归因于播放器。
- WebGL 的供应商字符串可能经过隐私处理；应与进程打开的 GPU 设备、驱动和原生监控交叉核对。
- RAF 间隔反映调度与应用负载，不等于显示器真实呈现帧率；控件操作到下一 RAF 回调也不是完整的输入到屏幕延迟。
- `drawFps` 包括 resize 和切换时的静态重绘，只有稳定场景阶段才适合按连续动画帧率解读。暂停和隐藏阶段关闭探针，检查是否仍有应用 RAF/绘制。
- 该测试衡量视觉层和原生素材路径，不包含真实音频解码、联网延迟与端到端音画同步。窗口焦点、实际尺寸及频谱新鲜度均记录在报告中。

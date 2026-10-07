# Bilibili-oversea 2.5.1 浏览器安装指南

[项目与下载](https://limitedrush.online/projects/bilibili-oversea) · [在线教程](https://limitedrush.online/projects/bilibili-oversea#browser-guide) · [常见问题](https://limitedrush.online/projects/bilibili-oversea#browser-troubleshooting)

当前交付包为 **2.5.1-final（r19）**，适用于 Chrome / Edge。它在本机选择 B 站媒体线路，无开发者服务器或遥测。最终交付不表示完整稳定版验收通过，个别视频仍可能慢开播或卡顿。

## 四步安装

1. **下载并解压。** 获取[2.5.1-final ZIP](https://limitedrush.online/assets/projects/bilibili-oversea/browser-2.5.1/bilibili-oversea-browser-v2.5.1-final.zip)，完整解压到独立新目录。打开后应直接看到 `manifest.json`、`src` 和 `assets`；浏览器不能直接加载 ZIP。
2. **停用旧版。** 在扩展管理页停用旧版和其他 B 站 CDN 切换扩展，保留旧目录供回退。
3. **加载。** Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`。开启“开发者模式”，点击“加载已解压的扩展程序”（Edge 可能显示“加载解压缩的扩展”），选中新目录。
4. **刷新验证。** 刷新 B 站视频页并开始播放，点击工具栏图标查看版本、播放状态和实际线路；插件不会自动弹出。

扩展显示版本号为 **2.5.1**。解压目录需长期保留；可把插件图标固定到工具栏，方便查看。

## 日常使用

默认保持“自动”即可。新视频优先使用同网络下有效的可信缓存；没有合格缓存时优先尝试 08CT，仍遵守排除设置和近期真实失败记录。发生故障后，插件按证据尝试有限备用线路；缓冲足够且满足条件后，才进行可选的轻量复核。

这不是每条视频开播前测速并选出最快节点。当前线路、目标线路、已验证结果是不同状态；显示“未测”也不代表插件没有工作。

- **原始线路 / 关闭：** 停止自动改道，使用播放器原来的线路。
- **重测 / 单点验证：** 主动执行有限测量，会产生额外流量；日常无需反复点击。
- **固定 / 排除：** 按自己的选择使用或跳过节点。需要恢复自动选路时切回“自动”。

## 常见问题

### 加载时找不到 manifest.json

选中解压后直接包含 `manifest.json` 的文件夹。不要选择 ZIP，也不要选择包在外面的上一级目录。

### 如何从旧版升级

按上方四步把新包加载到独立新目录，保留停用的旧扩展与旧目录，最后刷新播放页。需要回退时停用本版、启用旧版并刷新。若之前已安装 r19-candidate，运行代码完全相同，无需重复安装。

### 一直显示“等待视频”

先刷新 B 站播放页并开始播放，检查插件是否启用，以及扩展详情中的网站访问权限是否允许 B 站。若还有其他 CDN 切换扩展，同时停用后再检查。

### 节点很多，为什么没有全部显示速度

节点目录包含尚未验证的候选。插件只测有限批次或手动选择的节点，不会同时测试整个目录；历史速度也不代表当前视频一定可用或最快。

### 视频仍慢开播或切换后停止

先选择“原始线路”并刷新；仍异常时使用“复制诊断”，记录画质和具体症状，便于排查。网络、签名及播放器状态都会影响效果。r19 首帧前只调整后续原生请求，不重建或强制播放；播放器停止请求后，不能保证自行恢复。

### 如何卸载

在扩展管理页找到 Bilibili-oversea 并点击“移除”，再刷新 B 站播放页。浏览器会清除该扩展的本地设置与缓存。

## 版本与隐私

本包固定使用 r19 的 22 个运行文件。本轮两条新视频均完整播放，未记录既定阈值的卡顿，首显示帧为 6.39 / 11.14 秒；样本有限，完整稳定版验收仍未通过，未追加长视频、关页重进、最终原生弹窗/BFCache 或 iPhone 真机验收。

扩展不申请 Cookie、浏览历史、代理或所有网站访问权限。完整媒体 URL 与签名仅临时处理，不写入持久缓存或“复制诊断”；实际播放及必要测量仍会向媒体 CDN 发出正常请求。具体范围见下载包内的 `PRIVACY.md`。

下载文件为 `bilibili-oversea-browser-v2.5.1-final.zip`，大小 **95,651 字节**。[SHA-256 校验文件](https://limitedrush.online/assets/projects/bilibili-oversea/browser-2.5.1/bilibili-oversea-browser-v2.5.1-final.zip.sha256)对应值为：

```text
411f5f36c1f0e8173f464f169c54fa9fd89f7745d110919e29c18a3d88a0d5ad
```

手机脚本仍为 **0.5.0**，与浏览器扩展分开安装，本轮没有升级。[iPhone / iPad 教程](https://limitedrush.online/projects/bilibili-oversea#ios-guide)介绍网络工具导入、证书和自动化。

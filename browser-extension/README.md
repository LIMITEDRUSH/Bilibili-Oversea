# Bilibili-oversea 浏览器扩展

当前交付：**2.5.1-final（r19）**，适用于 Chrome / Edge。

[下载 ZIP](https://limitedrush.online/assets/projects/bilibili-oversea/browser-2.5.1/bilibili-oversea-browser-v2.5.1-final.zip) · [四步安装教程](https://limitedrush.online/projects/bilibili-oversea#browser-guide) · [常见问题](https://limitedrush.online/projects/bilibili-oversea#browser-troubleshooting)

请安装版本化 ZIP，不要直接加载本主分支的旧开发目录。交付包包含完整运行源码、许可、隐私说明、验证摘要及逐文件哈希；网站分发的文件与已交付 r19 完全一致。

## 安装与更新

1. 下载并解压到固定目录，确认直接包含 `manifest.json`、`src` 和 `assets`。
2. 停用旧版及其他 CDN 切换扩展，保留旧目录供回退。
3. 在 `edge://extensions` 或 `chrome://extensions` 开启开发者模式，加载上述已解压目录。
4. 刷新 B 站页面，点击工具栏图标核对 **2.5.1**。不自动弹出是正常行为。

新版本使用独立目录；已安装 r19-candidate 的运行代码相同，不必重复安装。回退时停用新版、启用旧版并刷新。

## 选路与边界

同网络的可信缓存优先，否则通常使用 08CT；保持健康线路，遇到真实失败时有限轮换，安全缓冲后条件性复核。不是每条视频开播前测速选最快，节点未测速也不等于不可用。

r19 首帧前故障恢复只调整后续原生请求，不重建播放器，不强制播放、暂停或跳转；正常安全缓冲后复核、手动测速及播放中恢复仍保留。

个别视频仍可能慢开播或卡顿，完整性能验收未通过。两条新视频有限实播均完整结束、未记录既定阈值卡顿，但首显示帧为 6.39 / 11.14 秒；小样本不证明普遍提升。长视频、关页重进、最终原生弹窗/BFCache 等本轮未追加验证。

出现问题时复制诊断并记录画质和症状，可选择原始线路或停用扩展对比，不必反复重测。

[版本与验证范围](https://limitedrush.online/projects/bilibili-oversea#release-notes) · [权限与隐私](https://limitedrush.online/projects/bilibili-oversea#privacy) · [SHA-256 校验](https://limitedrush.online/assets/projects/bilibili-oversea/browser-2.5.1/bilibili-oversea-browser-v2.5.1-final.zip.sha256)

手机 0.5.0 是独立模块，不随此 ZIP 更新。[手机教程](https://limitedrush.online/projects/bilibili-oversea#ios-guide)

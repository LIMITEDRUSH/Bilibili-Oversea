# Bilibili-oversea

本地 B 站媒体线路选择工具。浏览器当前下载为 **2.5.1-final（r19）**；iPhone / iPad 使用独立的 **0.5.0** 模块。

[项目与下载](https://limitedrush.online/projects/bilibili-oversea) · [浏览器教程](https://limitedrush.online/projects/bilibili-oversea#browser-guide) · [手机教程](https://limitedrush.online/projects/bilibili-oversea#ios-guide)

## Chrome / Edge：四步安装

1. [下载 2.5.1 ZIP](https://limitedrush.online/assets/projects/bilibili-oversea/browser-2.5.1/bilibili-oversea-browser-v2.5.1-final.zip)，完整解压到固定目录，确认直接包含 `manifest.json`、`src` 和 `assets`。
2. 停用旧版和其他 B 站 CDN 切换扩展，保留旧目录供回退。
3. Edge 打开 `edge://extensions`，Chrome 打开 `chrome://extensions`。启用开发者模式，选择“加载解压缩的扩展”，加载上述文件夹。
4. 刷新 B 站视频页，点击工具栏图标核对版本 **2.5.1** 和播放状态。插件不会自动弹出。

已安装 r19-candidate 的运行代码相同，不必重复安装。当前下载以冻结 ZIP 为准，包内包含完整运行源码；仓库开发目录与交付包独立，不要将旧的主分支目录直接作为 2.5.1 安装。

## 当前机制

可信的同网络缓存优先，没有合格缓存时通常以 **08CT** 为起点；健康线路优先保持，真实失败时有限轮换，安全缓冲后再条件性轻量复核。不是每个视频开播前测试全部节点并选择最快。

目录中的“未测速”不等于不可用；选中线路也不等于已收到媒体数据或播放成功。日常保持自动即可，不必频繁重测。

**个别视频仍可能慢开播或卡顿。** 2.5.1 是本轮交付版，完整性能验收仍未通过；[版本与验证范围](https://limitedrush.online/projects/bilibili-oversea#release-notes)保留具体限制，不承诺所有视频不卡。

## iPhone / iPad

在[手机教程](https://limitedrush.online/projects/bilibili-oversea#ios-guide)选择已使用的 Surge、Loon、Shadowrocket 或 Stash 导入模块；Quantumult X 为实验配置。只生成并信任自己客户端的证书，不使用他人的 CA、私钥或共享证书。

手机端 0.5.0 本轮没有升级，无法读取浏览器播放器的逐帧或缓冲状态，也未完成本轮真机验收。

## 帮助与回退

- [常见问题与复制诊断](https://limitedrush.online/projects/bilibili-oversea#browser-troubleshooting)：遇到问题请记录画质、症状并复制诊断，可用原始线路对比。
- [更新与回退](https://limitedrush.online/projects/bilibili-oversea#browser-update)：新版本使用独立目录；回退时停用新版、启用保留的旧版并刷新。
- [权限与隐私](https://limitedrush.online/projects/bilibili-oversea#privacy)：不向开发者上传遥测；正常播放和必要测量仍会访问媒体 CDN。不提供代理或绕过版权、地区、登录限制。
- [SHA-256 校验文件](https://limitedrush.online/assets/projects/bilibili-oversea/browser-2.5.1/bilibili-oversea-browser-v2.5.1-final.zip.sha256)：ZIP 为 95,651 字节，SHA-256 为 `411f5f36c1f0e8173f464f169c54fa9fd89f7745d110919e29c18a3d88a0d5ad`。

GitHub Pages 旧入口继续保留，并引导到个人网站；历史版本保留在仓库记录中。

# Bili CDN Auto 浏览器扩展

适用于 Chrome 111+、Edge 111+ 及其他兼容 Manifest V3 的 Chromium 浏览器。

## 安装

1. 解压发布 ZIP。
2. 打开 `chrome://extensions`；Edge 使用 `edge://extensions`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的目录。
5. 打开或刷新 B 站视频页面。扩展首次安装即启用自动模式。

## 功能

- 从当前视频的真实媒体地址发现兼容 CDN；
- 两阶段本地测速，兼顾首包和持续吞吐量；
- 为每个播放标签页建立临时重定向规则；
- 缓冲持续下降或播放卡住时尝试其他已验证节点；
- 支持手动节点、自定义候选、禁用候选和一键恢复原始 CDN；
- 不申请代理、Cookie、历史记录或全站访问权限；不包含遥测和远程代码。

完整媒体 URL 只保存在内存中；持久化数据仅包含设置、主机名和有上限的测速摘要。

## 来源

本扩展基于 MIT 项目
[liiliiliil/bili-cdn-switcher](https://github.com/liiliiliil/bili-cdn-switcher) 1.8.4。
具体变更和归属见 `UPSTREAM.md`，许可证见 `LICENSE`。

# Bilibili-oversea 浏览器扩展 2.2

适用于 Chrome 111+、Edge 111+ 及兼容 Manifest V3 的 Chromium 浏览器。

这是 Bilibili-oversea 的独立实现，不包含或运行其他浏览器扩展的源码。页面观察、候选校验、Range 测速、
标签页级会话规则、缓冲健康检查和弹窗界面均位于本目录，并由本项目维护。

## 安装

完整步骤见：<https://limitedrush.github.io/Bilibili-Oversea/browser-guide.html>

1. 下载并解压 `bilibili-oversea-browser-v2.2.0.zip`。
2. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
3. 开启“开发者模式”，点击“加载已解压的扩展程序”。
4. 选择解压后包含 `manifest.json` 的目录。
5. 打开或刷新 B 站视频页面，播放几秒，再点击扩展图标查看测速结果。

## 工作方式

- 只读观察 B 站 `playurl`、`window.__playinfo__` 和浏览器资源时间线，页面桥接脚本不修改播放器数据；
- 每 10 秒进行一次无额外下载流量的页面/资源兜底扫描，用于发现 SPA 换视频和漏过的媒体请求；
- 从当前视频带签名的真实媒体 URL 派生候选请求；
- 在当前 B 站标签页的隔离内容脚本中保留正常播放 Referer：最多 8 个候选各读取 128 KB 初筛，再对前三名各读取最多 1 MB 复测；
- 新视频立即使用三小时内的缓存最优节点；缓冲达到 12 秒后只用 256 KB 比较当前节点和最佳备用节点，此后每 15 分钟轻量复核一次；
- 仅为当前 B 站播放标签页添加 Chrome 会话重定向规则；
- 每 2 秒监测缓冲；低于 8 秒且持续快速下降，或经确认的 `waiting/stalled` 发生时，立即切换到下一个已验证节点并轻微回退；
- 完整成功结果缓存 3 小时，失败结果缓存 10 分钟；线路明显变慢、失败、网络变化或候选耗尽时才完整测速；
- 支持自动优选、立即重测、固定节点、禁用节点和恢复原始 CDN。

## 权限

- `activeTab`：打开弹窗时读取当前标签页；
- `storage`：保存模式、禁用节点和重测间隔；
- `declarativeNetRequestWithHostAccess`：建立仅限当前播放标签页的临时 CDN 规则；
- 主机范围仅为明确的 B 站页面、`*.bilivideo.com` 和 B 站的 `*.mcdn.bilivideo.cn` 媒体域名。

不申请代理、Cookie、历史记录、`webRequest` 或 `<all_urls>` 权限，不包含遥测、广告、远程代码或后端服务。

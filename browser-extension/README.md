# Bilibili-oversea 浏览器扩展 2.0

适用于 Chrome 111+、Edge 111+ 及兼容 Manifest V3 的 Chromium 浏览器。

这是 Bilibili-oversea 的独立实现，不包含或运行其他浏览器扩展的源码。页面观察、候选校验、Range 测速、
标签页级会话规则、缓冲健康检查和弹窗界面均位于本目录，并由本项目维护。

## 安装

完整步骤见：<https://limitedrush.github.io/Bilibili-Oversea/browser-guide.html>

1. 下载并解压 `bilibili-oversea-browser-v2.0.1.zip`。
2. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
3. 开启“开发者模式”，点击“加载已解压的扩展程序”。
4. 选择解压后包含 `manifest.json` 的目录。
5. 打开或刷新 B 站视频页面，播放几秒，再点击扩展图标查看测速结果。

## 工作方式

- 只读观察 B 站 `playurl` 响应，页面桥接脚本不修改播放器数据；
- 从当前视频带签名的真实媒体 URL 派生候选请求；
- 每个候选最多读取 128 KB Range 数据，在本机比较吞吐量和首包；
- 仅为当前 B 站播放标签页添加 Chrome 会话重定向规则；
- 播放器持续低缓冲或触发 `waiting/stalled` 时切换到下一个已验证节点；
- 支持自动优选、立即重测、固定节点、禁用节点和恢复原始 CDN。

## 权限

- `activeTab`：打开弹窗时读取当前标签页；
- `storage`：保存模式、禁用节点和重测间隔；
- `declarativeNetRequestWithHostAccess`：建立仅限当前播放标签页的临时 CDN 规则；
- 主机范围仅为明确的 B 站页面、`*.bilivideo.com` 和 B 站的 `*.mcdn.bilivideo.cn` 媒体域名。

不申请代理、Cookie、历史记录、`webRequest` 或 `<all_urls>` 权限，不包含遥测、广告、远程代码或后端服务。

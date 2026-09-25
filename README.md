# Bili CDN Auto

**安装入口：<https://limitedrush.github.io/Bilibili-Oversea/>**

**iOS 完整教程：<https://limitedrush.github.io/Bilibili-Oversea/guide.html>**

**浏览器插件教程：<https://limitedrush.github.io/Bilibili-Oversea/browser-guide.html>**

浏览器版可直接从安装入口下载；iPhone/iPad 在同一页面选择 Surge、Loon、Shadowrocket 或 Stash
一键导入，并可安装“连接 VPN”快捷指令。

一个本地运行、无遥测的 B 站视频 CDN 自动优选工具：

- 浏览器端使用 Chrome/Edge Manifest V3 扩展；
- iOS 端使用轻量请求脚本，由快捷指令负责启动和控制；
- 支持 Surge、Loon、Shadowrocket、Stash，并提供 Quantumult X 实验配置。

## 最快开始

### Chrome / Edge

浏览器插件名称为 **Bilibili-oversea**。使用 `browser-extension/dist/bilibili-oversea-browser-v2.1.0.zip`，解压后打开
`chrome://extensions` 或 `edge://extensions`，开启开发者模式并选择“加载已解压的扩展程序”。
自动模式首次安装即启用，打开 B 站视频播放几秒即可。完整步骤见
[`docs/BROWSER_TUTORIAL.md`](docs/BROWSER_TUTORIAL.md)。

### iPhone / iPad

iOS 客户端必须通过 HTTPS 下载脚本。先将本项目上传到自己的公开 GitHub 仓库，然后运行：

```bash
npm run build -- --base-url=https://raw.githubusercontent.com/你的用户名/仓库名/main
```

把生成的 `dist/` 一并提交，再打开 GitHub Pages 地址。页面提供
Surge、Loon、Shadowrocket、Stash 的一键导入按钮、iOS 自动化助手和本机控制按钮。

导入后，在所选网络工具里生成自己的 MITM CA，并按照 App 和 iOS 的提示安装、信任。
不要使用别人提供的共享证书或私钥。

## 使用方式

浏览器扩展与 iOS 端都会：

1. 从当前视频拿到真实、带签名的媒体 URL；
2. 对少量候选 CDN 发有大小上限的 Range 请求；
3. 选择可用且速度更好的节点；
4. 保留原始路径、查询参数和签名，只替换 CDN 主机；
5. 缓存选择，节点失败或网络变化后重新选择。

浏览器版还会观察前向缓冲趋势，在明显接近卡顿时尝试下一个已经验证的节点。iOS 版受网络扩展脚本接口限制，
失败切换发生在下一条媒体请求。

## 点原版哔哩哔哩自动启动

安装页提供经过 Apple “任何人可导入”模式签名的 `BiliCDNAuto-ConnectVPN.shortcut`。它只执行
iOS 原生“连接 VPN”动作，不保存 API 密钥，也不会打开第三方网页。

在 iPhone/iPad 上进行一次设置：

1. 从安装页添加“Bili CDN Auto · 连接 VPN”快捷指令；
2. 快捷指令 → 自动化 → `+` → App → 选择“哔哩哔哩”及“打开时”；
3. 选择“立即运行”，添加“运行快捷指令”，选中刚安装的快捷指令。

以后直接点击原版哔哩哔哩 App 即可。自动化会在当前 App 内连接已配置的 VPN，首个视频请求出现时自动测速。
如果设备有多个 VPN，请编辑快捷指令里的“连接 VPN”动作，选择正在使用的网络工具。

iOS 出于安全原因不允许下载内容替用户静默创建“个人自动化”，所以上述自动化必须在设备上确认一次。从下载、导入、
证书、验证到自动化和排错的全过程见 [`docs/IOS_TUTORIAL.md`](docs/IOS_TUTORIAL.md)，快捷指令技术说明见
[`ios/SHORTCUTS.md`](ios/SHORTCUTS.md)。

统一的本机控制地址：

- `http://bili-cdn-auto.invalid/retest`
- `http://bili-cdn-auto.invalid/auto`
- `http://bili-cdn-auto.invalid/original`
- `http://bili-cdn-auto.invalid/status`

`.invalid` 是保留域名。请求会在设备本机被配置脚本直接应答，不会发往外部服务器。

## 支持情况

| 平台 | 文件 | 自动测速 | 网络变化重测 | 快捷控制 |
| --- | --- | --- | --- | --- |
| Chrome / Edge | 浏览器扩展 ZIP | 是 | 缓存过期/播放状态触发 | 扩展弹窗 |
| Surge | `.sgmodule` | 是 | 是 | 原生脚本动作及本机 URL |
| Loon | `.plugin` | 是 | 是 | 通用脚本及本机 URL |
| Shadowrocket | `.module` | 是 | 事件脚本/本机 URL | 本机 URL |
| Stash | `.stoverride` | 是 | 请求健康检查 | 本机 URL |
| Quantumult X | `.snippet` | 实验性 | 请求健康检查 | 本机 URL |

## 开发与打包

```bash
npm test
npm run check
npm run package:browser
npm run package:shortcut # 需要 macOS；使用 Apple Shortcuts 签名
npm run build -- --base-url=https://raw.githubusercontent.com/USER/REPO/main
```

浏览器扩展不需要 npm 依赖或编译；源码就是扩展本体。iOS 构建脚本只负责把公开脚本地址写入各客户端模板，
并生成一个统一安装页面。

## 安全边界

- 无服务器、无账号、无遥测；测速和选择结果保存在本机。
- 浏览器扩展不申请代理、Cookie、历史记录或 `<all_urls>` 权限。
- 浏览器完整媒体 URL 只保存在当前会话内存中。
- iOS MITM 范围限制在 B 站视频 CDN 域名，但启用前仍应理解本机 CA 的作用。
- 工具不能绕过版权地区限制、登录限制或失效的媒体签名。
- CDN 和 B 站签名规则会变化，因此无法承诺永远无需维护。

## 开源来源

浏览器扩展 2.0 为本项目独立实现，不包含其他浏览器扩展的源码。iOS 域名族和匹配范围参考了 Apache-2.0
项目 [`Biliverse/Redirect`](https://github.com/Biliverse/Redirect)。详细归属见 `THIRD_PARTY_NOTICES.md`。

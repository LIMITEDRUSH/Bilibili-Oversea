# Bili CDN Auto

**安装入口：<https://limitedrush.github.io/Bilibili-Oversea/>**

浏览器版可直接从安装入口下载；iPhone/iPad 在同一页面选择 Surge、Loon、Shadowrocket 或 Stash
即可一键导入。

一个本地运行、无遥测的 B 站视频 CDN 自动优选工具：

- 浏览器端使用 Chrome/Edge Manifest V3 扩展；
- iOS 端使用轻量请求脚本，由快捷指令负责启动和控制；
- 支持 Surge、Loon、Shadowrocket、Stash，并提供 Quantumult X 实验配置。

## 最快开始

### Chrome / Edge

使用 `browser-extension/dist/bili-cdn-auto-browser-v1.8.5.zip`。解压后打开
`chrome://extensions` 或 `edge://extensions`，开启开发者模式并选择“加载已解压的扩展程序”。
自动模式首次安装即启用，打开 B 站视频播放几秒即可。

### iPhone / iPad

iOS 客户端必须通过 HTTPS 下载脚本。先将本项目上传到自己的公开 GitHub 仓库，然后运行：

```bash
npm run build -- --base-url=https://raw.githubusercontent.com/你的用户名/仓库名/main
```

把生成的 `dist/` 一并提交，再打开 GitHub Pages 地址。页面提供
Surge、Loon、Shadowrocket、Stash 的一键导入按钮、启动按钮和本机控制按钮。

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

## 快捷指令

快捷指令不保存 API 密钥。最简单的“打开 B 站”快捷指令是：

1. 打开所用客户端的 URL Scheme；
2. 等待 1 秒；
3. 打开“哔哩哔哩”App。

客户端启动地址及“重新测速”“自动模式”“恢复原始 CDN”等快捷指令步骤见
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

浏览器端基于 MIT 项目
[`liiliiliil/bili-cdn-switcher`](https://github.com/liiliiliil/bili-cdn-switcher) 1.8.4；iOS 域名族和匹配范围参考了
Apache-2.0 项目 [`Biliverse/Redirect`](https://github.com/Biliverse/Redirect)。详细归属见
`THIRD_PARTY_NOTICES.md` 及各子目录许可证。

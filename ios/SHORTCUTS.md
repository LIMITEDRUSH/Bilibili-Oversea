# iOS：点击原版哔哩哔哩自动运行

项目提供 Apple “任何人可导入”模式签名的 `BiliCDNAuto-ConnectVPN.shortcut`。它只使用系统
“连接 VPN”动作，不包含 API 密钥，也不会访问外部服务器。

## 一次性设置

1. 先从项目安装页导入 Surge、Loon、Shadowrocket 或 Stash 配置，安装并信任自己生成的 MITM CA。
2. 在安装页点击“安装‘连接 VPN’快捷指令”，确认添加。
3. 如果系统里有多个 VPN，编辑快捷指令，在“连接 VPN”动作中选择承载 Bili CDN Auto 的网络工具。
4. 打开“快捷指令”→“自动化”→右上角 `+` →“App”。
5. 选择“哔哩哔哩”，勾选“打开时”，选择“立即运行”。
6. 选择“新建空白自动化”→“添加操作”→“运行快捷指令”，指定 `Bili CDN Auto · 连接 VPN`。
7. 保存；如系统提供“运行时通知”，可按需关闭。

以后点击原版哔哩哔哩图标，iOS 会在当前 App 内连接 VPN，不需要先打开 Shadowrocket 等网络工具。
第一个真实视频请求出现时，已导入的脚本会自动测速和选择 CDN。

Apple 不允许共享的快捷指令静默创建“个人自动化”，因此第 4–6 步无法由下载文件代做，只需设置一次。

## URL Scheme 备用方案

如果你的 iOS 版本或 VPN 配置无法被系统“连接 VPN”动作识别，可以把自动化里的“运行快捷指令”换成“打开 URL”：

- Surge：`surge:///start?autoclose=true`
- Shadowrocket：`shadowrocket://connect?autoclose=true`
- Loon：`loon://on`
- Stash：`stash://start`

Surge 和 Shadowrocket 的 `autoclose=true` 会在连接后返回先前的 App。Loon、Stash 是否自动返回取决于客户端版本，
因此优先使用系统“连接 VPN”动作或客户端的按需连接功能。

## “重新测速”快捷指令

1. 新建快捷指令，添加“获取 URL 内容”。
2. URL 填写 `http://bili-cdn-auto.invalid/retest`，方法选择 GET。
3. 添加“显示结果”。

其他控制地址：

- 自动模式：`http://bili-cdn-auto.invalid/auto`
- 恢复原始 CDN：`http://bili-cdn-auto.invalid/original`
- 查看状态：`http://bili-cdn-auto.invalid/status`
- 固定节点：`http://bili-cdn-auto.invalid/set?host=cosov`

固定节点别名包括 `ali`、`cos`、`hw`、`aliov`、`cosov`、`hwov`。

不要在每次打开 B 站时调用 `retest`；默认自动模式会复用健康结果，只在需要时重新测速。

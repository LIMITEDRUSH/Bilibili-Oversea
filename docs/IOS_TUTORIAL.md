# iOS 完整安装与自动启动教程

这份教程的最终效果是：以后直接点击原版“哔哩哔哩”App，iOS 自动连接承载 Bili CDN Auto 的
VPN 配置；开始播放视频后，脚本自动实测候选 CDN，并使用当前网络下更合适的节点。

配置只需导入一次。日常打开 B 站时不会重复安装配置。

## 0. 开始前

- 推荐 iOS/iPadOS 16.4 或更高版本，以使用系统原生“连接 VPN”快捷指令动作。
- 安装 Surge、Shadowrocket、Loon 或 Stash 中的一个即可，不要同时连接多个 VPN 工具。
- 网络工具中应已有能正常使用的主配置。Bili CDN Auto 是模块/插件，不提供代理节点或订阅。
- 它只优化视频 CDN 路径，不能绕过地区、版权、登录或会员限制。

## 1. 打开安装页面

在 iPhone/iPad 的 Safari 打开：

<https://limitedrush.github.io/Bilibili-Oversea/>

先选择你实际使用的网络工具导入配置，然后再安装快捷指令。不要把四个客户端配置全部装一遍。

## 2. 导入 Bili CDN Auto

### Shadowrocket

1. 在安装页点击“导入 Shadowrocket”。
2. 允许 Safari 打开 Shadowrocket。
3. 在模块导入确认页添加 `Bili CDN Auto`，保持默认参数即可。
4. 进入 Shadowrocket 的配置/模块页面，确认 `Bili CDN Auto` 已存在并已启用。
5. 回到首页，选择你平时使用的配置或节点。

### Surge

1. 在安装页点击“导入 Surge”。
2. 允许 Safari 打开 Surge，在模块安装页确认添加。
3. Surge → 当前配置 → 模块，确认 `Bili CDN Auto` 已启用。
4. 参数第一次使用保持默认值；需要时可在模块参数页调整候选节点和缓存时间。

### Loon

1. 在安装页点击“导入 Loon”。
2. 允许打开 Loon，在插件导入页确认添加。
3. Loon → 配置 → 插件，确认 `Bili CDN Auto` 已启用。
4. 候选 CDN、缓存时间等参数保持默认即可。

### Stash

1. 在安装页点击“导入 Stash”。
2. 允许打开 Stash，确认安装 `Bili CDN Auto` Override。
3. Stash → 覆写/Override，确认该覆写已启用。
4. 确认你原有的主配置仍处于选中状态，然后返回首页。

### Quantumult X（实验性）

安装页提供 `.snippet` 地址。把其中的 `[rewrite_local]` 和 `[mitm]` 合并到自己的 Quantumult X
配置并更新资源。由于 Quantumult X 没有与其他四款相同的一键模块流程，建议熟悉其配置格式后再使用。

## 3. 生成、安装并信任自己的证书

视频请求是 HTTPS。网络工具只有在设备信任其本机 CA 后，才能执行 CDN 请求脚本。

在所选网络工具中找到 `MITM`、`HTTPS 解密`、`证书` 或 `CA Certificate`：

- Shadowrocket：设置 → 证书，生成新的 CA，然后选择安装证书。
- Surge：首页/更多 → MitM，生成新的 CA 并安装系统描述文件。
- Loon：配置/设置 → MitM → 证书，生成并安装证书。
- Stash：首页 → MitM → CA 证书 → `Stash Generated CA` → 安装证书。

客户端跳转到 Safari 或系统设置后：

1. 设置 → 通用 → VPN 与设备管理（部分版本显示“已下载描述文件”）。
2. 打开刚下载的证书描述文件，点击“安装”。
3. 设置 → 通用 → 关于本机 → 证书信任设置。
4. 在“针对根证书启用完全信任”下面启用刚才生成的证书。
5. 回到网络工具，确认 MitM/HTTPS 解密已开启。

只使用自己设备上的网络工具生成的证书。不要下载、共享或安装他人的 CA、私钥或 `.p12` 文件。
模块已将解密主机限制在相关 B 站视频 CDN 域名。

## 4. 首次连接与基础验证

1. 在网络工具首页点击启动/连接；首次连接时允许 iOS 添加 VPN 配置。
2. 回到安装页，点击“查看状态”。
3. 如果页面显示包含 `"ok": true` 的 JSON，说明本机控制脚本已经加载。
4. 打开哔哩哔哩，播放一个未完整缓存的视频 10–20 秒。
5. 再次查看状态。正常情况下 `selectedHost` 不为空，`scores` 中会出现测速结果。

若“查看状态”直接访问失败，通常是网络工具未连接、模块未启用，或主配置没有加载该模块。

## 5. 安装“连接 VPN”快捷指令

1. 在安装页点击“安装‘连接 VPN’快捷指令”。
2. iOS 打开快捷指令 App 后，检查内容：它只有一个系统动作——“连接 VPN”。
3. 点击“添加快捷指令”。
4. 如果设备里有多个 VPN，编辑该快捷指令，点击动作里的 `VPN`，选择承载 Bili CDN Auto 的客户端。
5. 手动运行一次；按 iOS 提示允许连接。确认状态栏出现 VPN 标志且没有跳转到其他 App。

该文件通过 macOS Shortcuts 的“任何人可导入”模式签名。它不包含账号、API 密钥、代理节点或远程执行代码。

## 6. 创建“打开哔哩哔哩时”个人自动化

Apple 不允许下载文件替用户静默创建个人自动化，因此下面的设置需要在本机确认一次：

1. 打开“快捷指令”App，进入“自动化”。
2. 点击右上角 `+`；首次使用时可直接点“新建自动化”。
3. 选择“App”。
4. 点击“选取”，勾选“哔哩哔哩”，然后点“完成”。
5. 勾选“打开时”；不要选择“关闭时”。
6. 选择“立即运行”。如果系统提供“运行时通知”，可按喜好关闭。
7. 进入下一步，选择“新建空白自动化”。
8. 添加“运行快捷指令”动作。
9. 点击蓝色的“快捷指令”字段，选择 `BiliCDNAuto-ConnectVPN`。
10. 点击“完成”。

现在关闭哔哩哔哩和网络工具进行测试。直接点击原版哔哩哔哩图标，VPN 应自动连接，而画面仍停留在
哔哩哔哩。播放视频后，CDN 优选会在后台执行。

## 7. 日常操作

- 正常情况：直接打开哔哩哔哩，不需要进入网络工具或安装页面。
- 换 Wi‑Fi、切换蜂窝网络后：工具会让旧的自动选择失效，并在后续视频请求中重新选择。
- 明显变慢：在安装页点击“重新测速”，再拖动到尚未缓存的位置或重新打开视频。
- 想恢复默认：点击“原始 CDN”。模块仍保留，但不再替换 CDN。
- 重新启用自动选择：点击“自动模式”。
- 查看结果：点击“查看状态”；`selectedHost` 是当前自动选择的节点。

不要每次打开 B 站都强制“重新测速”。自动模式会复用健康的结果，避免额外流量和启动延迟。

## 8. 常见问题

### 打开哔哩哔哩后 VPN 没有连接

- 在快捷指令中手动运行 `BiliCDNAuto-ConnectVPN`，确认它能连接正确的 VPN。
- 检查个人自动化是否启用、触发 App 是否为“哔哩哔哩”、运行方式是否为“立即运行”。
- 如果有多个 VPN，重新编辑“连接 VPN”动作并选择正确配置。
- 较旧 iOS 无法使用该动作时，可改用客户端的按需连接功能，或使用教程末尾的 URL Scheme。

### VPN 已连接，但 `selectedHost` 一直为空

- 确认模块/插件/Override 已启用。
- 确认证书描述文件已安装，而且“证书信任设置”里已开启完全信任。
- 播放一个新视频，或拖到尚未缓存的位置；已经缓存的片段不会产生新的 CDN 请求。
- 在安装页点一次“重新测速”，然后继续播放。

### B 站出现证书错误或完全无法联网

立即停止网络工具，然后禁用 Bili CDN Auto 模块并重新测试。检查是否误装了别人的证书、证书是否过期、
主配置是否存在其他 MitM/重写冲突。必要时删除证书描述文件并重新生成。

### 自动测速后仍然没有变快

候选 CDN 可能在当前运营商上表现接近，或者瓶颈不在 CDN。自动模式会在无可用候选时沿用原始节点，
但不能保证每条视频线路都能改善。

## 9. URL Scheme 备用方案

如果系统“连接 VPN”动作不能识别你的客户端，可以在个人自动化中使用“打开 URL”动作：

- Surge：`surge:///start?autoclose=true`
- Shadowrocket：`shadowrocket://connect?autoclose=true`
- Loon：`loon://on`
- Stash：`stash://start`

Surge 和 Shadowrocket 的 `autoclose=true` 会在连接完成后返回之前的 App。Loon、Stash 是否自动返回取决于版本，
因此优先使用系统“连接 VPN”动作或客户端的按需连接。

## 10. 卸载与恢复

1. 快捷指令 → 自动化，删除“哔哩哔哩打开时”的自动化。
2. 删除 `BiliCDNAuto-ConnectVPN` 快捷指令。
3. 在网络工具里禁用或删除 `Bili CDN Auto` 模块/插件/Override。
4. 如不再使用任何 HTTPS 解密功能，可到设置 → 通用 → VPN 与设备管理删除相应证书描述文件。
5. 停止 VPN。B 站会恢复平台原始 CDN 行为。

## 参考文档

- [Apple：创建个人自动化](https://support.apple.com/guide/shortcuts/add-automations-apdfbdbd7123/ios)
- [Apple：信任手动安装的证书](https://support.apple.com/zh-cn/102390)
- [Surge URL Scheme](https://manual.nssurge.com/tools/url-scheme.html)
- [Loon URL Scheme](https://nsloon.app/en/docs/Scheme/)
- [Loon 插件格式](https://nsloon.app/docs/Plugin/)
- [Stash Override](https://stash.wiki/en/configuration/override)
- [Stash MitM](https://stash.wiki/en/http-engine/mitm)

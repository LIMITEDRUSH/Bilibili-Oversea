# iOS 快捷指令

由于 Apple 不允许直接分发未签名的 `.shortcut` 文件，本项目使用所有主流客户端都能识别的本机控制 URL。
它不包含 API 密钥，也不会访问外部服务器。

## “打开 B 站”快捷指令

1. 新建快捷指令，命名为 `Bili CDN Auto`。
2. 添加“打开 URL”，按所用客户端填写：
   - Surge：`surge:///start?autoclose=true`
   - Loon：`loon://on`
   - Shadowrocket：`shadowrocket://connect?autoclose=true`
   - Stash：`stash://start`
3. 添加“等待”，设为 1 秒。
4. 添加“打开 App”，选择“哔哩哔哩”。

这条快捷指令只负责确保网络工具已经启动；自动测速会在第一个真实视频请求出现时运行。

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

## 个人自动化

可以创建“App → 哔哩哔哩 → 打开时”的个人自动化，只执行相应客户端的启动 URL。
不要每次打开 B 站都调用 `retest`，否则会产生不必要的测速流量。

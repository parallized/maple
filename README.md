# Maple

## 使用

目前你可以选择 2 种形式使用 Maple，取决于你是否需要多平台、随地使用、多人协作等功能

- 本地运行：数据完全自持，响应速度快，没有安全套件，端口不开放无需在线和多人协作的情况下使用
- 自行部署服务器或使用 Maple 官方测试服务器：有安全套件，支持多租户，多平台，随时随地使用

Maple 依赖于你本机的各种 AI 服务包括 Codex, Claude 等等，建议在安装 Maple 期间把 AI 服务调通

### 本地运行

1. 安装 Maple Standalone 版本

```powershell
irm https://maplecode.art/install-local.ps1 | iex

curl -fsSL https://maplecode.art/install-local.sh | sh
```

2. 在弹出的浏览器页面开始工作

### 客户端 + 服务端

1. 安装 Maple CLI

```powershell
irm https://maplecode.art/install.ps1 | iex

curl -fsSL https://maplecode.art/install.sh | sh
```

2. 登录 MapleCode 官方，并绑定你的 CLI 至工作区

- 运行 `maple` 后，CLI 会打开浏览器。登录并确认后，当前工作区将获得这台 CLI；不要确认来源不明的请求。

3. 在网页添加业务和需求，Maple CLI 将会自动分发、拉起 Worker 执行并截图结果

> 忘记掉 Claude, Codex, Kimi, Gemini, Grok...忘记掉上下文窗口，忘记掉缓存，忘记掉切 Provider 还要重启终端，把精力专注在手头的任务上，在业务播种与收获中全力以赴地享受

## 关键信息

- 你可能不喜欢完成任务以后自动截图：可以在设置里关闭
- 截图太模糊了，我是 4K 屏看着难受：可以在设置里调高清。截图太高清了，硬盘受不了，可以在设置里调糊
- 我不喜欢那种污染硬盘管理的软件，到处创建小东西找都找不到：Maple 相关缓存都在 ~/.maple 里面，理论上删掉 ~/.maple 一切大吉，截图上传成功后会尝试自我毁灭

## 要求

- 硬盘：Bun + Maple CLI bundle 大约 400M 占用，如果使用 Playwright 截图功能大约总和 1G 占用

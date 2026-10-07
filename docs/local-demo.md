# Windows 零费用部署演练

这条路线在本机运行生产容器，由 Cloudflare Quick Tunnel 提供临时 HTTPS 地址，不购买云服务器或域名。电脑、Docker Desktop 和隧道均须保持运行。地址在重新建立隧道后改变，没有可用性保证；它只用于少量人工体验，不代表已通过正式公开上线验收。正式部署仍使用 [部署与验收](deployment.md)。

## 已准备的配置

- `compose.demo.yaml` 与基础 `compose.yaml` 合并，使用独立的 `linkkeep-demo` 项目及数据卷。
- 应用端口不发布到宿主机；Nginx 只绑定 `127.0.0.1:8080`，只读运行，丢弃 capabilities，覆盖可信代理头。该配置只能接收本机 cloudflared 转发，不能改为绑定 `0.0.0.0`。
- `.private/demo.env` 从已有本地密钥生成，写入本次 HTTPS 地址和运营者提供的邮箱；不覆盖原 `.env` 的管理员凭据。
- 代理预算使用独立演练数据库，默认估算上限为 200 分。它不是云账单硬上限；本次没有购买收费云资源。
- `cloudflared` 2026.9.3 放在忽略提交的 `.private/tools/cloudflared.exe`。每次启动校验官方发布的 SHA256，启动和停止均不安装 Windows 服务、不改变系统网络设置。
- 日志位于忽略提交的 `artifacts/demo/`。会话状态位于 `.private/demo-session.json`。

## 启动

先打开 Docker Desktop，确认引擎运行。在项目目录执行：

```powershell
npm run test:container
powershell -NoProfile -File deploy/start-demo.ps1 -CopyrightEmail "你的实际邮箱地址"
```

脚本取得临时地址后自动写入演练配置，构建并启动应用及 Nginx，等待健康检查，再显示网页和后台地址。现有本地管理员凭据继续适用。密码、TOTP 和恢复码不要贴进聊天或提交到 Git。

脚本启动的 cloudflared 在后台运行，因此关闭启动命令窗口不会停止演练。若启动失败，脚本会关闭自己启动的隧道、停止演练项目并保留数据库卷。不要把含密钥的 `docker compose config` 完整输出发给别人。

## 验证

1. 从显示的 HTTPS 地址打开 `/zh`、`/en`、`/admin` 和 `/api/health`。
2. 手机关闭 Wi-Fi，使用移动流量检查访问；访问失败时记录报错，不要绕过浏览器的证书警告。
3. 手动测试本人发布或明确获授权的公开链接。基础部署通过不代表抖音、小红书的真实解析支持已经通过样本验收。
4. 投诉邮箱用于页面上的邮件联系链接；网页提交的投诉和反馈保存到后台，当前没有自动发邮件功能。

## 停止

```powershell
powershell -NoProfile -File deploy/stop-demo.ps1
```

停止脚本核对隧道进程的可执行文件路径和启动时间后关闭它，再停止独立演练项目。它保留数据库和备份卷。不要加 `down -v`，该参数会删除数据卷。

## 本机下载故障处理

本机连接 Docker Hub 认证接口曾超时，使用 `.env` 中的 `LINKKEEP_NODE_IMAGE` 选择 Docker 官方 ECR 镜像解决，正式发布可固定镜像摘要。Debian 下载曾返回 500/502，Dockerfile 已使用 HTTPS 软件源、下载重试和软件包缓存。无需添加不可信镜像加速站或关闭 Chromium 沙箱。

生产打包明确包含 `playwright-core` 运行文件，并在构建时检查浏览器清单。Chromium 配置目录放在可写的 `/tmp`；seccomp 允许浏览器在自身用户命名空间内调用 `chroot`，容器仍丢弃全部 capabilities。2026-10-03 本机容器渲染、密钥排除和生产健康检查通过。

来源：[Docker 官方 ECR 镜像说明](https://www.docker.com/blog/news-from-aws-reinvent-docker-official-images-on-amazon-ecr-public/)、[Cloudflare 临时隧道](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)、[cloudflared 2026.9.3 校验摘要](https://github.com/cloudflare/cloudflared/releases/tag/2026.9.3)。

2026-10-03 的官方 npm 生产依赖审计为 0 告警。完整审计有 5 项开发工具依赖告警，来源为 `eslint-config-next` 的间接 `braces` 依赖；[官方公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) 尚无修复版本，不采用审计工具建议的跨主版本降级。此前记录的完整审计为 0 是 2026-09-30 当时的结果。

## 2026-10-03 实际演练结果

生产容器沙箱渲染、密钥排除、健康检查、生产构建、TypeScript 和 ESLint 通过。真实临时 HTTPS 入口的 15 项检查通过，覆盖中英文首页、投诉联系邮箱、后台认证、密码和 TOTP、会话 Cookie、反馈入库、CSRF 和退出。浏览器确认首页渲染及无链接输入的错误提示。

运行中的演练数据库已创建加密备份，并恢复到 `/tmp` 的隔离文件，SQLite 完整性和测试反馈都通过核验；未覆盖在线数据库。停止、重新启动及重复启动脚本都已实际验证，数据库和备份卷保留。Nginx 使用 Docker 内置 DNS 定期刷新应用地址，支持应用容器重新创建。

检查报告和截图保存到忽略提交的 `artifacts/demo/`。当前地址从 `.private/demo-session.json` 读取；隧道重启后不要继续使用旧地址。本次没有购买云资源、注册域名或安装系统服务。手机移动网络和抖音/小红书授权公开链接仍需运营者实测。

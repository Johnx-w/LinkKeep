# LinkKeep / 链存

LinkKeep 是抖音、小红书公开媒体保存工具的首版实现。它只处理无需登录即可访问的普通公开帖子，不接收平台 Cookie，不绕过登录、付费、地区、DRM、签名或风控，不移除已经嵌入画面的水印。

当前状态：应用、模拟适配器契约、安全边界、三种传输路径、双语响应式界面和单人后台已实现；真实平台支持仍须用运营者本人或明确获授权的 20 条样本完成验证，未通过前不应公开宣称平台可用。

## 本地运行

要求 Node.js 24。

```powershell
npm install
Copy-Item .env.example .env
npm run setup:admin -- --write-env
npm run dev
```

`setup:admin -- --write-env` 生成独立密钥并写入 `.env`，一次性管理员密码、TOTP 和恢复码写入忽略提交的 `.private/operator-credentials-时间戳.txt`。将其移入密码管理器后删除该文件。已配置管理员时脚本拒绝覆盖；有意轮换才使用 `--rotate`，备份密钥会保留。不要提交 `.env`、数据库、备份、真实分享链接或媒体文件。

常用检查：

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
npm run test:backup
npm run test:validation
```

## 授权样本验证

1. 复制 `.private/authorized-samples.example.json` 为 `.private/authorized-samples.json`。
2. 填入抖音、小红书各 10 条本人发布或明确获授权的公开样本。
3. 在 `.env` 设置高熵 `VALIDATION_TOKEN`（初始化脚本会生成），启动应用。生产环境先配置 HTTPS 域名、真实邮箱和可信反向代理，见 [部署与验收](docs/deployment.md)。
4. 在另一个终端执行（脚本自动读取 `.env`）：

```powershell
npm run validate:samples
```

报告写入 `artifacts/validation/`，不包含完整媒体 URL。脚本验证所有媒体的实际代理响应和文件签名，不再把重定向计作下载成功。两个平台固定样本必须分别达到 10/10 解析和 10/10 下载启动，才可进入平台支持验收。独立动态清单可通过 `AUTHORIZED_SAMPLES_PATH` 指定，再运行 `npm run validate:samples -- --dynamic`。

## 架构边界

- `src/domain/`：领域错误、分享输入、媒体契约和文件命名。
- `src/platforms/`：公开页面加载器与抖音/小红书平台适配器。
- `src/security/`：域名/DNS/SSRF 校验、固定 DNS 请求、限流和后台认证。
- `src/application/`：15 秒解析服务与 15 分钟短期媒体令牌。
- `src/delivery/`：直连、浏览器本地 ZIP 所需代理、严格媒体签名校验和预算熔断。
- `src/storage/`：Node SQLite 运营状态、投诉、帖子停止解析、指标和代理用量。
- `src/app/`：Next.js 页面与 API。

完整产品边界见 [产品规格](docs/product-spec.md)，真实平台验收见 [验证计划](docs/validation-plan.md)，领域词汇见 [CONTEXT.md](CONTEXT.md)。

## Docker

Windows 本机免费部署体验见 [部署演练](docs/local-demo.md)，提供独立数据库、临时 HTTPS 入口以及启动和停止脚本。

如果 Docker Hub 的 `auth.docker.io` 无法连接，可在本地 `.env` 添加 `LINKKEEP_NODE_IMAGE=public.ecr.aws/docker/library/node:24-bookworm-slim`，从 Docker 官方在 Amazon ECR Public 发布的同系列镜像构建。该项只选择构建基础镜像，不修改系统 DNS、代理或其他项目配置；正式发布可使用镜像摘要固定版本。来源：[Docker 官方说明](https://www.docker.com/blog/news-from-aws-reinvent-docker-official-images-on-amazon-ecr-public/)。

```powershell
docker compose build
docker compose up -d
```

Compose 默认只绑定 `127.0.0.1:3000`，应由已配置 TLS、安全响应头、请求体限制和可信代理头覆盖规则的反向代理对外提供服务。容器丢弃 Linux capabilities、启用只读根文件系统，并限制进程、内存、CPU 和共享内存。浏览器启用 Chromium 沙箱和官方 seccomp 配置；需在实际宿主机执行 `npm run test:container` 验证。

标准浏览器兜底只在容器内存在 Chromium 且设置 `PLAYWRIGHT_EXECUTABLE_PATH` 时启用；它使用无账号、无持久 Cookie、无 stealth 的新上下文，任务后销毁。

## 备份

初始化脚本生成 32 字节 Base64 `BACKUP_ENCRYPTION_KEY`。备份前清理到期数据，然后定时执行：

```powershell
npm run backup
```

脚本自动读取 `.env`，使用 AES-256-GCM 加密 SQLite 快照，仅保留最近 7 份；已结案投诉的个人资料会从快照中脱敏。首次部署必须在隔离环境演练恢复；媒体缓存和诊断日志不会进入备份。每日调度、监控、回滚及验收步骤见 [部署与验收](docs/deployment.md)。

`npm run build` 会生成不含环境文件的 standalone 包。`npm start` 启动生产模式：不完整或示例生产配置会拒绝启动；日常本地开发仍使用 `npm run dev`。E2E 使用隔离数据库、随机测试凭据和本地 TLS 运行生产构建，运行前需要 `npm run build` 和已安装的 Chromium/WebKit。

## 公开上线前

- 完成域名实名/备案和目标地区业务合规核验。
- 配置独立 `copyright@域名` 邮箱并验证投诉流程。
- 替换所有开发密钥、示例邮箱和管理员凭据。
- 使用真实授权样本达到固定与动态成功率门槛。
- 完成 SSRF、恶意重定向、媒体伪装、限流、预算熔断和浏览器隔离测试。
- 在 iOS Safari、Android Chrome/Edge、桌面 Chrome/Edge/Safari 验收核心流程。
- 测试期保持 `robots.txt` 全站禁止收录；达到上线门槛后再修改。

在这些条件完成前，该项目只能视为验证版，不能声称已支持所有公开链接或可安全公开运营。

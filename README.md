# LinkKeep / 链存

LinkKeep 是抖音、小红书公开媒体保存工具的首版实现。它只处理无需登录即可访问的普通公开帖子，不接收平台 Cookie，不绕过登录、付费、地区、DRM、签名或风控，不移除已经嵌入画面的水印。

当前状态：应用、模拟适配器契约、安全边界、三种传输路径、双语响应式界面和单人后台已实现；真实平台支持仍须用运营者本人或明确获授权的 20 条样本完成验证，未通过前不应公开宣称平台可用。

## 本地运行

要求 Node.js 24。

```powershell
npm install
Copy-Item .env.example .env
npm run setup:admin
npm run dev
```

将 `setup:admin` 输出的哈希和 TOTP 密钥保存到密码管理器并写入 `.env`。不要提交 `.env`、数据库、备份、真实分享链接或媒体文件。

常用检查：

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

## 授权样本验证

1. 复制 `.private/authorized-samples.example.json` 为 `.private/authorized-samples.json`。
2. 填入抖音、小红书各 10 条本人发布或明确获授权的公开样本。
3. 在 `.env` 设置高熵 `VALIDATION_TOKEN`，启动应用。
4. 在另一个终端设置相同令牌后执行：

```powershell
npm run validate:samples
```

报告写入 `artifacts/validation/`，不包含完整媒体 URL。两个平台固定样本必须分别达到 10/10 解析和 10/10 下载启动，才可进入平台支持验收。

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

```powershell
docker compose build
docker compose up -d
```

Compose 默认只绑定 `127.0.0.1:3000`，应由已配置 TLS、安全响应头、请求体限制和可信代理头覆盖规则的反向代理对外提供服务。容器丢弃 Linux capabilities、启用只读根文件系统，并限制进程、内存、CPU 和共享内存。

标准浏览器兜底只在容器内存在 Chromium 且设置 `PLAYWRIGHT_EXECUTABLE_PATH` 时启用；它使用无账号、无持久 Cookie、无 stealth 的新上下文，任务后销毁。

## 备份

生成 32 字节 Base64 密钥并设置 `BACKUP_ENCRYPTION_KEY`，然后定时执行：

```powershell
npm run backup
```

脚本使用 AES-256-GCM 加密 SQLite 快照，仅保留最近 7 份。首次部署必须在隔离环境演练恢复；媒体缓存和诊断日志不得进入备份。

## 公开上线前

- 完成域名实名/备案和目标地区业务合规核验。
- 配置独立 `copyright@域名` 邮箱并验证投诉流程。
- 替换所有开发密钥、示例邮箱和管理员凭据。
- 使用真实授权样本达到固定与动态成功率门槛。
- 完成 SSRF、恶意重定向、媒体伪装、限流、预算熔断和浏览器隔离测试。
- 在 iOS Safari、Android Chrome/Edge、桌面 Chrome/Edge/Safari 验收核心流程。
- 测试期保持 `robots.txt` 全站禁止收录；达到上线门槛后再修改。

在这些条件完成前，该项目只能视为验证版，不能声称已支持所有公开链接或可安全公开运营。

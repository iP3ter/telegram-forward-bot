# Telegram Forward Bot

基于 Cloudflare Workers 的消息转发机器人，支持验证码。

## 部署步骤

### Fork 本仓库

### 创建 Cloudflare KV

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. `Workers & Pages` → `KV` → `Create a namespace`
3. 名称随意，如 `tg-bot-data`
4. **复制 Namespace ID**

### 获取 Cloudflare 凭据

**API Token:**
1. `My Profile` → `API Tokens` → `Create Token`
2. 选择 `Edit Cloudflare Workers` 模板
3. 复制 Token

**Account ID:**
- Dashboard 首页右侧栏可见

### 获取 Telegram 信息

| 信息 | 获取方式 |
|------|---------|
| Bot Token | @BotFather 创建机器人获取 |
| 你的用户 ID | 向 @userinfobot 发消息 |
| Bot 用户名 | 创建时设置的用户名（不带@）|

### 配置 GitHub Secrets

进入仓库 `Settings` → `Secrets and variables` → `Actions` → `New repository secret`

**必填：**

| Name | 说明 | 示例 |
|------|------|------|
| `CF_API_TOKEN` | Cloudflare API Token | `xxxxxx` |
| `CF_ACCOUNT_ID` | Cloudflare Account ID | `xxxxxx` |
| `BOT_TOKEN` | Telegram Bot Token | `123456:ABC-xxx` |
| `ADMIN_ID` | 管理员 Telegram ID | `123456789` |
| `KV_ID` | KV Namespace ID | `xxxxxx` |
| `BOT_USERNAME` |  Bot 用户名 | `my_forward_bot` |
| `WORKER_URL` |  域名（保护隐私，从actions里面隐藏） | `https://telegram-forward-bot.你的子域名.workers.dev` |

**可选（自定义配置）：**

| Name | 说明 | 默认值 |
|------|------|--------|
| `CAPTCHA_TYPE` | 验证码类型 (button/math/text/slider) | `button` |

### 触发部署

- 推送任何更改到 main 分支
- 或到 `Actions` 页面手动运行 workflow

### 设置 Webhook

部署完成后访问：https://telegram-forward-bot.你的子域名.workers.dev/setup

## 使用

**用户:** 发消息 → 完成验证 → 消息转发给管理员

**管理员:** 
- 输入 `/help` 会弹出命令提示
- 回复转发的消息 → 自动发送给用户

## 验证码类型

在 Secrets 中设置 `CAPTCHA_TYPE`：

- `button` - 点击表情（默认）
- `math` - 数学计算
- `text` - 输入验证码
- `slider` - 点击目标

## 功能
### 核心功能
- **双向转发**：
  - 用户 -> 机器人 -> 管理员（支持文本、图片、媒体）
  - 管理员回复 -> 机器人 -> 用户（匿名回复，保护管理员隐私）
- **无服务器架构**：基于 Cloudflare Workers + KV，免费、快速、无需维护服务器。

### 反垃圾消息与验证系统
- **强制验证码**：新用户必须通过验证（支持 Emoji 按钮 / 数学题 / 文本 / 滑块）。
- **秒级超时封禁**：验证码限时（默认 45秒），超时未验证或超时后尝试操作，**直接封禁**并提示。
- **即死判定**：
  - 在【按钮验证】模式下，如果用户不点按钮而直接发送文本/图片，系统判定为自动脚本，**直接封禁**。
  - 用户无法重置验证状态，只有管理员可解封。
- **指令拦截**：用户发送的 `/start`、`/help` 等指令仅在本地处理，**不会转发给管理员**，防止刷屏。

### 管理员权限与隐私
- **隐私保护**：管理员直接发送给机器人的消息（非回复）**不会**被转发，防止误操作泄露隐私。
- **快捷指令**：
  - `/block [ID]` 或回复消息 `/block`：封禁用户。
  - `/unblock [ID]` 或回复消息 `/unblock`：解封用户。
  - `/check [ID]` 或回复消息 `/check`：查看用户状态、注册时间、用户名。
- **状态反馈**：所有操作均有明确的成功/失败回显。

## 更新
- 2025年12月30日 加入防止转发管理员指令等功能例如`/start`， 以及对验证时间的优化
- 2025年12月23日 完成初版
## License

MIT

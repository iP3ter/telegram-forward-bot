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
| `WORKER_URL` |  域名 | `https://telegram-forward-bot.你的子域名.workers.dev` |

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

## 更新
- 2025年12月30日 加入防止转发管理员指令等功能例如`/start`， 以及对验证时间的优化
- 2025年12月23日 完成初版
## License

MIT

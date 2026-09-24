# opencode-quota

<!-- README-I18N:START -->

[English](./README.md) | **中文**

<!-- README-I18N:END -->

OpenCode TUI 插件，用于查看模型或订阅配额。

## 支持的提供商

- **OpenCode Go** — 滚动、周度和月度订阅配额（通过 HTML 解析）
- **GitHub Copilot** — 月度高级请求配额、额度和超额用量
- **OpenAI** — 基于当前 OpenAI 会话返回的频率限制窗口（例如 `5h`、`7d`，以及在可用时显示代码审查窗口）

仅当凭据已配置时，对应提供商才会运行。未配置的提供商会自动跳过。

## 命令

| 命令 | 说明 |
|---------|------|
| `/quota` | 获取并显示所有已配置提供商的当前配额 |

该命令始终获取最新数据。

## 输出示例

配额以分组文本对话框展示，包含进度条、百分比和重置计时：

```
→ [OpenCode Go]
Rolling:            5m
████████████████░░░░░░░░   67% left
Weekly:          3d 2h
████████████░░░░░░░░░░░░   50% left
Monthly:          12d
████████░░░░░░░░░░░░░░░░   33% left

Updated: Apr 27, 2:30 PM
```

## 安装

在 `~/.config/opencode/cli.json` 中添加插件（OpenCode V2）：

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["@whosydd/opencode-quota"]
}
```

当设置了 `OPENCODE_GO_WORKSPACE_ID` 和 `OPENCODE_GO_AUTH_COOKIE` 时，会启用 OpenCode Go。GitHub Copilot 和 OpenAI 会自动复用 OpenCode 登录会话。

<details>
<summary>手动构建（开发人员）</summary>

```bash
git clone https://github.com/whosydd/opencode-quota.git
cd opencode-quota
npm install
npm run build
```

然后将 `dist` 目录的绝对路径添加到 `~/.config/opencode/cli.json` 的 `plugins` 数组中。
</details>

## 配置

OpenCode Go 直接从环境变量读取配置。

### 环境变量

```bash
export OPENCODE_GO_WORKSPACE_ID="wrk_your_workspace_id"
export OPENCODE_GO_AUTH_COOKIE="Fe26.2**your_auth_cookie"
```

GitHub Copilot 和 OpenAI 不再使用插件选项或环境变量。直接通过 OpenCode 登录后，插件会复用对应的 OAuth 会话。

### 获取 OpenCode Go 凭据

**Workspace ID：**

1. 登录 [opencode.ai](https://opencode.ai) 并打开 Go 页面。
2. URL 格式为 `https://opencode.ai/workspace/wrk_xxxxxxxx/go`。
3. 其中 `wrk_xxxxxxxx` 即为你的 workspace ID。

**Auth Cookie：**

1. 在浏览器中登录 [opencode.ai](https://opencode.ai)。
2. 打开开发者工具（F12 或 Ctrl+Shift+I / Cmd+Option+I）。
3. 进入 **Application** → **Cookies** → `https://opencode.ai`。
4. 找到名为 `auth` 的 Cookie 并复制其值。
5. 该值以 `Fe26.2**` 开头，是一段很长的字符串。

> Cookie 会定期过期。如果配额获取出现身份验证错误，请重新执行以上步骤获取新的 Cookie。

### 配置模型详情

本插件直接从环境变量读取 OpenCode Go 凭据。

## GitHub Copilot 数据来源

插件使用 OpenCode 保存的 OAuth 会话调用 Copilot 配额快照端点（`/copilot_internal/user`）。身份验证、权限、频率限制和账户不支持等错误会直接展示。

## OpenAI 数据来源

插件使用 OpenCode 保存的 OAuth 会话调用 OpenAI 使用量 API（`/backend-api/wham/usage`）。界面会根据 API 返回的窗口时长生成标签，而不是假设固定为小时或周度窗口。身份验证、权限和频率限制等错误会直接展示。

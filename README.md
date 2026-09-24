# opencode-quota

<!-- README-I18N:START -->

**English** | [中文](./README.zh.md)

<!-- README-I18N:END -->

OpenCode TUI plugin for checking model or subscription quota.

## Supported Providers

- **OpenCode Go** — rolling, weekly, and monthly subscription quota (via HTML scraping)
- **GitHub Copilot** — monthly premium request quota, allowance, and overage
- **OpenAI** — rate-limit windows derived from the current OpenAI session (for example `5h`, `7d`, and code review when available)

Providers only run when their credentials are configured. Unconfigured providers are skipped silently.

## Commands

| Command | Description |
|---------|-------------|
| `/quota` | Fetch and show current quota from all configured providers |

The command always fetches fresh data. 

## Output

Quota is displayed as a grouped text dialog with progress bars, percentages, and reset timers:

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

## Install

Add the plugin to `~/.config/opencode/cli.json` (OpenCode V2):

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["@whosydd/opencode-quota"]
}
```

OpenCode Go is enabled when `OPENCODE_GO_WORKSPACE_ID` and `OPENCODE_GO_AUTH_COOKIE` are set. GitHub Copilot and OpenAI are detected from your OpenCode login session.

<details>
<summary>Manual build (for developers)</summary>

```bash
git clone https://github.com/whosydd/opencode-quota.git
cd opencode-quota
npm install
npm run build
```

Then add the absolute path to the `dist` directory to the `plugins` array in `~/.config/opencode/cli.json`.
</details>

## Configuration

OpenCode Go reads configuration directly from environment variables.

### Environment Variables

```bash
export OPENCODE_GO_WORKSPACE_ID="wrk_your_workspace_id"
export OPENCODE_GO_AUTH_COOKIE="Fe26.2**your_auth_cookie"
```

GitHub Copilot and OpenAI do not use plugin options or environment variables anymore. Log in through OpenCode and the plugin will reuse that OAuth session.

### Getting OpenCode Go Credentials

**Workspace ID:**

1. Log in to [opencode.ai](https://opencode.ai) and open the Go page.
2. The URL will look like `https://opencode.ai/workspace/wrk_xxxxxxxx/go`.
3. The `wrk_xxxxxxxx` part is your workspace ID.

**Auth Cookie:**

1. Log in to [opencode.ai](https://opencode.ai) in your browser.
2. Open Developer Tools (F12 or Ctrl+Shift+I / Cmd+Option+I).
3. Go to **Application** → **Cookies** → `https://opencode.ai`.
4. Find the cookie named `auth` and copy its value.
5. The value starts with `Fe26.2**` and is a long string.

> The cookie expires periodically. If quota fetching fails with an auth error, repeat these steps to get a fresh cookie.

### Configuration Model Details

This plugin reads OpenCode Go credentials directly from environment variables. 

## GitHub Copilot Data Sources

The plugin uses the Copilot quota snapshot endpoint (`/copilot_internal/user`) with the OAuth session stored by OpenCode. Auth, permission, rate-limit, and unsupported-account errors are surfaced directly.

## OpenAI Data Sources

The plugin fetches from the OpenAI usage API (`/backend-api/wham/usage`) using the OAuth session stored by OpenCode. The UI labels each window from the API's reported duration instead of assuming fixed hourly or weekly names. Auth, permission, and rate-limit errors are surfaced directly.

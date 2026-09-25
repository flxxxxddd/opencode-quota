# opencode-quota

<!-- README-I18N:START -->

**English** | [中文](./README.zh.md)

<!-- README-I18N:END -->

OpenCode TUI plugin for checking model or subscription quota.

## Supported Providers

- **OpenCode Go** — rolling, weekly, and monthly subscription quota (via HTML scraping)
- **GitHub Copilot** — monthly premium request quota, allowance, and overage
- **OpenAI** — rate-limit windows derived from the current OpenAI session (for example `5h`, `7d`, and code review when available)
- **Kimi Code** — rolling 5-hour and, on legacy plans, weekly subscription quota

Providers only run when their credentials are configured. Unconfigured providers are skipped silently.

## Commands

| Command | Description |
|---------|-------------|
| `/quota` | Fetch and show current quota from all configured providers |

The command always fetches fresh data. 

## Output

Quota is displayed one provider/account at a time with progress bars, percentages, and reset timers:

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

### Test this checkout locally

From the repository root, with OpenCode V2 installed:

```bash
npm install
npm run dev
```

In the newly opened TUI, run `/quota`. With multiple accounts, use **← / →** to switch tabs; fetch errors appear in an **Issues** tab. The launcher builds the current source and loads `dist/` for **this process only**. It does not edit global `cli.json`; for this test run it replaces the CLI plugin list so a published copy of this plugin cannot conflict. Other global settings remain in effect. Exit and run `npm run dev` again after code changes.

To test additional accounts, set `OPENCODE_QUOTA_AUTH_FILES` or `OPENCODE_QUOTA_KIMI_KEYS` in the same shell before `npm run dev` (see [Configuration](#configuration)). OpenAI's primary account is read from OpenCode's existing `auth.json`. `/quota` only reads quota; pressing **R** does **not** redeem anything until you select a reset and confirm. To test the UI safely, cancel at the confirmation prompt.

If `/quota` is missing, check that `opencode --version` reports V2 and launch via `npm run dev` rather than an already-open TUI window.

### Install published version

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

GitHub Copilot and the primary OpenAI account reuse OpenCode's OAuth session. For additional OpenAI (or Kimi OAuth) accounts, point to separate OpenCode-format auth files:

```bash
export OPENCODE_QUOTA_AUTH_FILES='["/path/to/second/auth.json", "/path/to/third/auth.json"]'
```

Each file should contain an `openai` OAuth entry (or `kimi-coding` / `kimi` for Kimi). OpenCode's own `auth.json` stores only one credential per provider; this plugin reads additional files but never changes them, refreshes their tokens, or switches OpenCode's active model account. Expired sessions must be renewed in the application that owns them. Keep these files private and out of the repository.

Alternatively, supply Kimi Code **subscription** API keys (not Moonshot Open Platform keys) as named accounts:

```bash
export OPENCODE_QUOTA_KIMI_KEYS='{"personal":"sk-kimi-...","work":"sk-kimi-..."}'
```

The Kimi usage endpoint is an undocumented read-only endpoint at `api.kimi.com/coding/v1/usages`, so its response may change. New Kimi plans may not include a weekly window; the Kimi Code endpoint does not reliably report the shared monthly membership pool.

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

When OpenAI reports saved Codex resets, `/quota` lists their expiry and scope where available. Press **R**, select a specific reset, and explicitly confirm before redeeming it. Redemption is irreversible and can move your weekly reset date. The plugin never redeems automatically. Reset details and redemption use OpenAI's internal `rate-limit-reset-credits` endpoints, which may change; a failed details request does not hide your usage windows. Resets are distinct from the ordinary automatic window reset timers.

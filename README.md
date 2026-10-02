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
| `/quota-settings` | Choose the first service, full order, HUD, alerts and active refresh interval |
| `/quota-order` | Set service order, for example `kimi, openai, copilot, go` |

The command always fetches fresh data. 

## HUD and dashboard controls

The prompt footer shows the first configured service in your preferred order,
its first two quota windows and the next reset. Click it or run `/quota` for
the full dashboard. Stale snapshots are labeled; failed refreshes retain the
last good snapshot rather than suggesting that quota disappeared.

- **← / →**, **H / L**, **Tab / Shift+Tab**: switch accounts instantly using the
  loaded snapshot; switching tabs does not make network requests.
- **F / Ctrl+R**: fetch a fresh snapshot.
- **S**: settings.
- **[ / ]**: move the selected service earlier/later in the saved order.
- **R**: redeem a saved OpenAI reset, with selection and explicit confirmation.
- **Esc**: close.

Service IDs are `openai`, `copilot`, `kimi`, and `go`. Omitted services are
appended to the end. Account order within a service remains stable. Preferences
are persisted by OpenCode and synchronized between TUI instances. The first
available service in the saved order also drives the HUD.

Background snapshots refresh every **120 seconds** while sessions are running
and for five minutes after activity. Settings offer 30/60/120/300/900 seconds.
Idle clients stop polling. Background server snapshots have a 60-second cache;
`/quota` and **F** bypass it. Concurrent refreshes share one in-flight request.
Each provider HTTP request, including its response body, has a 12-second
deadline. Reset redemption is **never retried automatically**.

Low-quota warnings trigger at **20%** and **5%** remaining, once per threshold
and quota window. They appear as in-app toasts and, when OpenCode's notification
settings permit, a desktop notification while the terminal is unfocused.
They never play an additional sound. HUD, alerts, order and refresh interval can
all be changed in `/quota-settings` without editing files.

Default preferences can also be supplied as plugin options on first use:

```jsonc
{
  "plugins": [{
    "package": "@whosydd/opencode-quota",
    "options": { "order": ["openai", "kimi", "copilot", "go"], "hud": true, "alerts": true, "refreshSeconds": 120 }
  }]
}
```

Saved settings take precedence over these initial defaults. No credentials are
stored in preference or alert state, and unexpected SDK errors are sanitized
before displaying them.

## Verification

```sh
npm run build
npm run typecheck
npm test
npm run test:ui # optional: Bun native-renderer HUD/tab/order smoke test
```

Tests cover service ordering, preference recovery, threshold deduplication,
staleness, safe errors, network timeouts and cancellation. Provider APIs are
mocked; tests do not redeem resets or contact subscription endpoints.

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

To test additional accounts, set `OPENCODE_QUOTA_AUTH_FILES` or `OPENCODE_QUOTA_KIMI_KEYS` in the same shell before `npm run dev` (see [Configuration](#configuration)). Accounts connected in OpenCode (`/connect`) are picked up automatically. `/quota` only reads quota; pressing **R** does **not** redeem anything until you select a reset and confirm. To test the UI safely, cancel at the confirmation prompt.

If `/quota` is missing, check that `opencode --version` reports V2 and launch via `npm run dev` rather than an already-open TUI window.

### Install published version

Add the plugin to your global `~/.config/opencode/opencode.jsonc` (OpenCode V2). The server part resolves credentials, and its TUI component loads automatically — no separate `cli.json` entry is needed:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@whosydd/opencode-quota"],
}
```

OpenCode Go is enabled when `OPENCODE_GO_WORKSPACE_ID` and `OPENCODE_GO_AUTH_COOKIE` are set. GitHub Copilot, OpenAI (ChatGPT OAuth), and Kimi are detected from accounts connected in OpenCode V2 (`/connect` / `opencode auth login`). All saved accounts for these providers are shown — not just the active one.

<details>
<summary>Manual build (for developers)</summary>

```bash
git clone https://github.com/whosydd/opencode-quota.git
cd opencode-quota
npm install
npm run build
```

Then add the absolute path to the repository's `dist` directory to the `plugins` array in `~/.config/opencode/opencode.jsonc`.
</details>

## Configuration

OpenCode Go reads configuration directly from environment variables.

### Environment Variables

```bash
export OPENCODE_GO_WORKSPACE_ID="wrk_your_workspace_id"
export OPENCODE_GO_AUTH_COOKIE="Fe26.2**your_auth_cookie"
```

OpenCode V2 stores connected accounts in its own database. This plugin resolves them through the server-side integration API — it no longer reads `auth.json` for the main setup, so refreshed OAuth tokens and multiple saved accounts work automatically. The TUI never sees raw tokens: the server part fetches quotas and returns only view data.

For accounts that cannot coexist in OpenCode (for example, a second ChatGPT login managed elsewhere), you can point to separate OpenCode-format auth files:

```bash
export OPENCODE_QUOTA_AUTH_FILES='["/path/to/second/auth.json", "/path/to/third/auth.json"]'
```

Each file should contain an `openai` OAuth entry (or `kimi-coding` / `kimi` for Kimi). This plugin reads additional files but never changes them, refreshes their tokens, or switches OpenCode's active model account. Expired sessions must be renewed in the application that owns them. Keep these files private and out of the repository.

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

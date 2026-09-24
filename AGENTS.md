# AGENTS.md

## Project Purpose

OpenCode TUI plugin that shows model/subscription quota from multiple providers in one place.

## Current Scope

- OpenCode Go rolling, weekly, and monthly subscription quota (HTML scraping)
- GitHub Copilot monthly premium request quota, allowance, and overage
- OpenAI rate-limit windows derived from the API response duration, plus code-review windows when available
- Single slash command: `/quota` - always fetches fresh data

## Build & Verify

```bash
npm install
npm run build      # tsup ESM + dts -> dist/
npm run typecheck  # tsc --noEmit
```

No test suite exists yet. Verify by building and type-checking.

## Repository Layout

- `src/tui.tsx`: TUI plugin entrypoint. Registers slash commands and orchestrates provider calls.
- `src/quota-dialog.tsx`: Renders the quota dashboard and provider cards.
- `src/config.ts`: Config loading from environment variables.
- `src/opencode-auth.ts`: Shared auth resolution (JWT parsing, OAuth session reading, token expiry checks via `isAuthExpired`). All providers use this module instead of duplicating auth logic.
- `src/opencode-go.ts`: HTML fetch + parse for OpenCode Go quota.
- `src/github-copilot.ts`: GitHub API fetcher using the OpenCode-stored OAuth session against the IDE quota snapshot endpoint.
- `src/openai.ts`: OpenAI usage API fetcher using the OpenCode-stored OAuth session.
- `src/format.ts`: Text formatting for TUI dialog output.
- `docs/project-plan.md`: Roadmap (phases 0-3).

## Architecture Rules

- Keep provider logic isolated. `tui.ts` should not know how data is fetched.
- Each provider owns its own fetch, parse, and error handling.
- `format.ts` is the single place for user-facing text; providers return structured data, not strings.
- Auth utilities (`isAuthExpired`, `readAuthFileCached`, `resolveCopilotAuth`, `resolveOpenAIAuth`) live in `opencode-auth.ts`. Providers must not duplicate auth or expiry logic.
- Do not log secrets (cookies, tokens) anywhere.
- Prefer environment variables over config files for credentials.

## Provider Quirks

### OpenCode Go
- Scrapes `https://opencode.ai/workspace/{id}/go` and parses inline JS object literals from HTML.
- Parsing is fragile; the page format can change without warning.
- Returns rolling, weekly, and monthly windows with `quotaPercent` and `resetInSec`.

### GitHub Copilot
- **Primary**: `GET /copilot_internal/user` quota snapshot (matches VS Code IDE usage).
- Uses the OpenCode-stored OAuth session to call `GET /copilot_internal/user`.
- Auth/permission/rate-limit and unsupported-account errors are surfaced directly.

### OpenAI
- Fetches from `https://chatgpt.com/backend-api/wham/usage` using the OpenCode-stored OAuth session.
- Returns rate-limit windows labeled from the API-reported duration, plus code-review windows when available.
- Auth/permission/rate-limit errors are surfaced directly.

## Config & Secrets

- OpenCode Go credentials should be provided via environment variables.
- GitHub Copilot and OpenAI reuse the OAuth sessions stored by OpenCode.
- String values support `{env:VARIABLE_NAME}` placeholders. Shell command placeholders like `{env:$(gh auth token)}` are explicitly rejected.
- `refreshIntervalMinutes` is not supported (always fetches fresh data).
- `readAuthFile` throws on malformed JSON in auth files rather than silently ignoring it.
- Never commit tokens or cookies to the repo.

## Constraints

- TUI-only for now. No server plugin entrypoint unless a concrete need appears.
- This is a single-package repo, not a monorepo.

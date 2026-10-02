import type { GitHubCopilotSnapshot } from "./github-copilot.js"
import type { OpenAISnapshot } from "./openai.js"
import type { OpenCodeGoSnapshot } from "./opencode-go.js"
import type { KimiSnapshot } from "./kimi.js"

export type QuotaWindowView = {
  label: string
  percentRemaining: number
  resetAt?: number
  detail?: string
}

export type QuotaProviderView = {
  /** Stable, non-secret selector for ordering, selection and alert deduplication. */
  id?: string
  title: string
  subtitle?: string
  account?: string
  windows: QuotaWindowView[]
  notes?: string[]
  reset?: { account: string; count: number; credits: Array<{ id: string; title: string; expiresAt?: number }> }
}

export function openCodeGoView(snapshot: OpenCodeGoSnapshot): QuotaProviderView {
  const windows: QuotaWindowView[] = []
  const add = (label: string, value: OpenCodeGoSnapshot["rolling"]) => {
    if (!value) return
    windows.push({
      label,
      percentRemaining: clampPercent(100 - value.quotaPercent),
      resetAt: Date.now() + value.resetInSec * 1000,
    })
  }

  add("Rolling window", snapshot.rolling)
  add("Weekly limit", snapshot.weekly)
  add("Monthly limit", snapshot.monthly)

  return { title: "OpenCode Go", windows }
}

export function copilotView(snapshot: GitHubCopilotSnapshot): QuotaProviderView {
  const allowance = snapshot.monthlyAllowance
  const detail = allowance === null
    ? `${snapshot.usedPremiumRequests} premium requests used`
    : `${snapshot.usedPremiumRequests} of ${allowance} premium requests used`

  return {
    title: "GitHub Copilot",
    subtitle: "Premium requests",
    windows: [{
      label: "Monthly allowance",
      percentRemaining: clampPercent(100 - snapshot.quotaPercent),
      resetAt: snapshot.resetAt,
      detail,
    }],
    ...(snapshot.overageRequests > 0
      ? { notes: [`${snapshot.overageRequests} overage requests`] }
      : {}),
  }
}

export function openAIView(snapshot: OpenAISnapshot, account?: string): QuotaProviderView {
  const plan = snapshot.label.match(/^OpenAI\s*\((.+)\)$/i)?.[1]
  const windows: QuotaWindowView[] = []

  const add = (window?: OpenAISnapshot["windows"]["primary"]) => {
    if (!window) return
    const resetAt = window.resetTimeIso ? Date.parse(window.resetTimeIso) : undefined
    windows.push({
      label: friendlyWindowLabel(window.label),
      percentRemaining: clampPercent(window.percentRemaining),
      ...(resetAt !== undefined && Number.isFinite(resetAt) ? { resetAt } : {}),
    })
  }

  add(snapshot.windows.primary)
  add(snapshot.windows.secondary)
  add(snapshot.windows.codeReview)

  return {
    title: "OpenAI",
    subtitle: plan,
    account: account ?? snapshot.email,
    windows,
    ...(snapshot.resetCount !== undefined && account ? { reset: { account, count: snapshot.resetCount, credits: snapshot.resetCredits ?? [] } } : {}),
    ...(snapshot.resetError ? { notes: [snapshot.resetError] } : {}),
  }
}

export function kimiView(snapshot: KimiSnapshot): QuotaProviderView {
  return { title: "Kimi Code", subtitle: snapshot.plan, account: snapshot.name, windows: snapshot.windows, ...(snapshot.notes ? { notes: snapshot.notes } : {}) }
}

function friendlyWindowLabel(label: string): string {
  const match = label.trim().match(/^(\d+)\s*([hdm])$/i)
  if (!match) return `${label} limit`

  const unit = { h: "hour", d: "day", m: "minute" }[match[2]!.toLowerCase()]!
  const count = Number(match[1])
  return `${count}-${unit} limit`
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function formatResetCountdown(iso?: string): string {
  if (!iso) return ""
  const resetDate = new Date(iso)
  const diffMs = resetDate.getTime() - Date.now()
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "reset"

  if (diffMs < 60000) return `${Math.max(0, Math.floor(diffMs / 1000))}s`

  const diffMinutes = Math.floor(diffMs / 60000)
  const days = Math.floor(diffMinutes / 1440)
  const hours = Math.floor((diffMinutes % 1440) / 60)
  const minutes = diffMinutes % 60

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "2-digit",
  })
}

export function quotaErrorMessage(error: unknown): string {
  // Do not expose arbitrary SDK errors: they can contain HTTP headers or credentials.
  const message = error instanceof Error ? error.message : ""
  if (/timed out|timeout/i.test(message)) return "Request timed out. Refresh to retry."
  if (/429|rate.limit/i.test(message)) return "Rate limited (429). Wait before refreshing."
  if (/expired|401|authentication/i.test(message)) return "Sign-in expired or rejected. Reconnect in /connect."
  if (/403|forbidden/i.test(message)) return "Access forbidden (403). Check subscription and permissions."
  if (/network/i.test(message)) return "Network unavailable. Check your connection."
  if (/no quota|no recognizable|parse|premium request data/i.test(message)) return "Quota response is unsupported or has changed."
  if (/404|unavailable/i.test(message)) return "Quota endpoint unavailable for this account."
  return "Could not update quota. Check your connection in /connect."
}

export function formatHud(provider: QuotaProviderView | undefined, now: number, fetchedAt: number, errors: number): string {
  if (!provider) return errors ? "Quota unavailable · /quota" : "Quota · /quota"
  const windows = provider.windows.slice(0, 2).map((window) => `${window.label.replace(/-hour limit$/, "h").replace(/-day limit$/, "d").replace(/ limit$/, "")} ${window.percentRemaining}%`)
  const resetAt = provider.windows[0]?.resetAt
  const reset = resetAt ? ` · reset ${formatResetCountdown(new Date(resetAt).toISOString())}` : ""
  const stale = now - fetchedAt > 300_000 ? " · stale" : ""
  return `${provider.title} · ${windows.join(" · ")}${reset}${stale}${errors ? " · !" : ""}`
}

export function formatSidebarWindow(window: QuotaWindowView): string {
  const percent = clampPercent(window.percentRemaining)
  const filled = Math.round(percent / 10)
  const reset = window.resetAt ? ` · ${formatResetCountdown(new Date(window.resetAt).toISOString())}` : ""
  const label = window.label.replace(/-hour limit$/, "h").replace(/-day limit$/, "d").replace(/ limit$/, "")
  return `${label} ${"█".repeat(filled)}${"░".repeat(10 - filled)} ${percent}%${reset}`
}

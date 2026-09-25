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

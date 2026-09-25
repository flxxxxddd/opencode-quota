import { readAuthFileCached, resolveOpenAIAuth, isAuthExpired, type OpenAIResolvedAuth } from "./opencode-auth.js"
import { randomUUID } from "node:crypto"

type RateLimitWindow = {
  used_percent: number
  limit_window_seconds: number
  reset_after_seconds: number
  reset_at?: number
}

type OpenAIUsageResponse = {
  plan_type: string
  rate_limit: {
    limit_reached: boolean
    primary_window: RateLimitWindow
    secondary_window: RateLimitWindow | null
  } | null
  code_review_rate_limit?: {
    primary_window: RateLimitWindow | null
  } | null
  credits?: {
    has_credits: boolean
    unlimited: boolean
    balance: string | null
  } | null
  rate_limit_reset_credits?: { available_count?: number } | null
}

export type ResetCredit = { id: string; title: string; expiresAt?: number }

type OpenAIWindow = {
  label: string
  percentRemaining: number
  resetTimeIso?: string
}

export type OpenAISnapshot = {
  label: string
  email?: string
  windows: {
    primary?: OpenAIWindow
    secondary?: OpenAIWindow
    codeReview?: OpenAIWindow
  }
  fetchedAt: number
  resetCount?: number
  resetCredits?: ResetCredit[]
  resetError?: string
}

const OPENAI_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
const RESET_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits"

function headersFor(auth: NonNullable<OpenAIResolvedAuth>): Record<string, string> {
  return {
    Authorization: `Bearer ${auth.accessToken}`,
    "User-Agent": "opencode-quota/0.3.2",
    ...(auth.accountId ? { "ChatGPT-Account-Id": auth.accountId } : {}),
  }
}

export async function listResetCredits(auth: NonNullable<OpenAIResolvedAuth>): Promise<{ count: number; credits: ResetCredit[] }> {
  if (isAuthExpired(auth.expiresAt)) throw new Error("OpenAI authentication expired. Log in again through OpenCode.")
  const response = await fetch(RESET_URL, { headers: headersFor(auth) })
  if (!response.ok) throw new Error(`OpenAI reset list failed (HTTP ${response.status}).`)
  const data = await response.json() as { available_count?: unknown; credits?: unknown }
  if (!Array.isArray(data.credits)) throw new Error("OpenAI reset list is unavailable.")
  const credits = data.credits.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return []
    const credit = item as Record<string, unknown>
    if (credit.status !== "available" || credit.reset_type !== "codex_rate_limits" || typeof credit.id !== "string" || !credit.id) return []
    const expiresAt = typeof credit.expires_at === "string" ? Date.parse(credit.expires_at) : NaN
    return [{ id: credit.id, title: typeof credit.title === "string" ? credit.title : "Full reset", ...(Number.isFinite(expiresAt) ? { expiresAt } : {}) }]
  }).sort((a: ResetCredit, b: ResetCredit) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity))
  const count = typeof data.available_count === "number" && Number.isInteger(data.available_count) && data.available_count >= 0
    ? data.available_count : credits.length
  return { count, credits }
}

export async function consumeResetCredit(auth: NonNullable<OpenAIResolvedAuth>, creditId: string): Promise<string> {
  if (isAuthExpired(auth.expiresAt)) throw new Error("OpenAI authentication expired. Log in again through OpenCode.")
  const response = await fetch(`${RESET_URL}/consume`, {
    method: "POST",
    headers: { ...headersFor(auth), "Content-Type": "application/json" },
    body: JSON.stringify({ credit_id: creditId, redeem_request_id: randomUUID() }),
  })
  if (!response.ok) throw new Error(`OpenAI reset failed (HTTP ${response.status}). Check your account before retrying.`)
  const result = await response.json() as { code?: string }
  if (result.code === "reset") return "Reset applied."
  if (result.code === "nothing_to_reset") return "Nothing to reset; your reset remains available."
  if (result.code === "already_redeemed") return "Reset already redeemed."
  if (result.code === "no_credit") return "No reset is available."
  throw new Error("Unknown reset response. Check your account before retrying.")
}

function deriveLabel(planType: string | undefined): string {
  const raw = (planType ?? "").toLowerCase()
  if (raw.includes("pro")) return "OpenAI (Pro)"
  if (raw.includes("plus")) return "OpenAI (Plus)"
  if (planType) return `OpenAI (${planType})`
  return "OpenAI"
}

function remainingPercent(window: RateLimitWindow): number {
  return Math.max(0, Math.min(100, Math.round(100 - window.used_percent)))
}

function labelForWindow(window: RateLimitWindow, fallback: string): string {
  const seconds = window.limit_window_seconds
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback

  if (seconds % 86400 === 0) {
    const days = Math.round(seconds / 86400)
    return days === 1 ? "Daily" : `${days}d`
  }

  if (seconds % 3600 === 0) {
    const hours = Math.round(seconds / 3600)
    return hours === 1 ? "Hourly" : `${hours}h`
  }

  if (seconds % 60 === 0) {
    const minutes = Math.round(seconds / 60)
    return minutes === 1 ? "1m" : `${minutes}m`
  }

  return `${Math.round(seconds)}s`
}

function resetIsoFromSeconds(seconds: number): string | undefined {
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined
  return new Date(Date.now() + Math.round(seconds * 1000)).toISOString()
}

function resetIsoFromTimestamp(timestamp?: number): string | undefined {
  if (!Number.isFinite(timestamp) || !timestamp) return undefined
  const ms = Math.round(timestamp * 1000)
  if (!Number.isFinite(ms) || ms <= 0) return undefined
  return new Date(ms).toISOString()
}

export async function getOpenAIQuota(account?: NonNullable<OpenAIResolvedAuth>): Promise<OpenAISnapshot | null> {
  const resolved = account ?? resolveOpenAIAuth(await readAuthFileCached())

  if (!resolved) return null

  if (isAuthExpired(resolved.expiresAt)) {
    throw new Error("OpenAI authentication expired. Log in to OpenAI again through OpenCode.")
  }

  if (resolved.accessToken.length < 20) {
    throw new Error("OpenAI access token looks invalid.")
  }

  const headers = headersFor(resolved)

  let response: Response
  try {
    response = await fetch(OPENAI_USAGE_URL, { headers })
  } catch {
    throw new Error("Network error while fetching OpenAI quota.")
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("OpenAI authentication failed. Your session may have expired.")
    }
    if (response.status === 403) {
      throw new Error("OpenAI quota request was forbidden.")
    }
    if (response.status === 429) {
      throw new Error("OpenAI quota request was rate limited. Try again shortly.")
    }
    throw new Error(`OpenAI quota request failed with HTTP ${response.status}.`)
  }

  const data = (await response.json()) as OpenAIUsageResponse
  const primaryWindow = data.rate_limit?.primary_window

  if (!primaryWindow) {
    throw new Error("No quota data received from OpenAI.")
  }

  const primary: OpenAIWindow = {
    label: labelForWindow(primaryWindow, "Primary"),
    percentRemaining: remainingPercent(primaryWindow),
    resetTimeIso: resetIsoFromTimestamp(primaryWindow.reset_at) ?? resetIsoFromSeconds(primaryWindow.reset_after_seconds),
  }

  const secondary: OpenAIWindow | undefined = data.rate_limit?.secondary_window
    ? {
        label: labelForWindow(data.rate_limit.secondary_window, "Secondary"),
        percentRemaining: remainingPercent(data.rate_limit.secondary_window),
        resetTimeIso:
          resetIsoFromTimestamp(data.rate_limit.secondary_window.reset_at) ??
          resetIsoFromSeconds(data.rate_limit.secondary_window.reset_after_seconds),
      }
    : undefined

  const codeReview: OpenAIWindow | undefined = data.code_review_rate_limit?.primary_window
    ? {
        label: "Code Review",
        percentRemaining: remainingPercent(data.code_review_rate_limit.primary_window),
        resetTimeIso:
          resetIsoFromTimestamp(data.code_review_rate_limit.primary_window.reset_at) ??
          resetIsoFromSeconds(data.code_review_rate_limit.primary_window.reset_after_seconds),
      }
    : undefined

  const count = data.rate_limit_reset_credits?.available_count
  let resets: { count: number; credits: ResetCredit[] } | undefined
  let resetError: string | undefined
  if (typeof count === "number" && count > 0) {
    try { resets = await listResetCredits(resolved) } catch { resetError = "Reset details unavailable; usage is still current." }
  }
  return {
    label: deriveLabel(data.plan_type),
    email: resolved.email,
    windows: { primary, secondary, codeReview },
    fetchedAt: Date.now(),
    ...(typeof count === "number" ? { resetCount: resets?.count ?? count } : {}),
    ...(resets ? { resetCredits: resets.credits } : {}),
    ...(resetError ? { resetError } : {}),
  }
}

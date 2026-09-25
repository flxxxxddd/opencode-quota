import { readAuthFileCached, resolveCopilotAuth, isAuthExpired, type CopilotResolvedAuth } from "./opencode-auth.js"

type GitHubCopilotQuotaSnapshot = {
  entitlement?: unknown
  remaining?: unknown
  unlimited?: unknown
  overage_count?: unknown
  overage_permitted?: unknown
  percent_remaining?: unknown
  reset_date?: unknown
}

type GitHubCopilotUserInfoResponse = {
  quota_reset_date?: unknown
  quota_snapshots?: {
    premium_interactions?: GitHubCopilotQuotaSnapshot
  }
}

export type GitHubCopilotSnapshot = {
  quotaMonth: {
    year: number
    month: number
  }
  usedPremiumRequests: number
  monthlyAllowance: number | null
  quotaPercent: number
  overageRequests: number
  resetAt: number
  fetchedAt: number
  source: "oauth-snapshot"
}

export async function getGitHubCopilotQuota(account?: NonNullable<CopilotResolvedAuth>): Promise<GitHubCopilotSnapshot> {
  const resolved = account ?? resolveCopilotAuth(await readAuthFileCached())

  if (!resolved) {
    throw new Error("GitHub Copilot is not configured. Log in to GitHub Copilot through OpenCode.")
  }

  if (isAuthExpired(resolved.expiresAt)) {
    throw new Error("GitHub Copilot authentication expired. Log in to GitHub Copilot again through OpenCode.")
  }

  let response: Response
  try {
    response = await fetch("https://api.github.com/copilot_internal/user", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${resolved.accessToken}`,
        "User-Agent": "opencode-quota/0.3.2",
        "X-GitHub-Api-Version": "2025-04-01",
      },
    })
  } catch {
    throw new Error("Network error while fetching GitHub Copilot quota (OAuth).")
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("GitHub Copilot quota snapshot is unavailable for this OpenCode session or account.")
    }

    if (response.status === 401) {
      throw new Error("GitHub Copilot OAuth authentication failed. Your session may have expired.")
    }

    if (response.status === 403) {
      throw new Error("GitHub Copilot OAuth quota request was forbidden.")
    }

    if (response.status === 429) {
      throw new Error("GitHub Copilot quota request was rate limited. Try again shortly.")
    }

    throw new Error(`GitHub Copilot OAuth quota request failed with HTTP ${response.status}.`)
  }

  const payload = (await response.json()) as GitHubCopilotUserInfoResponse
  const snapshot = toQuotaSnapshotFromOAuth(payload)
  if (!snapshot) {
    throw new Error("GitHub Copilot quota snapshot did not include premium request data.")
  }

  return snapshot
}



function toQuotaSnapshotFromOAuth(
  payload: GitHubCopilotUserInfoResponse,
): GitHubCopilotSnapshot | null {
  const premiumInteractions = payload.quota_snapshots?.premium_interactions
  if (!premiumInteractions) return null

  const unlimited = premiumInteractions.unlimited === true
  const entitlement = asNumber(premiumInteractions.entitlement)
  const remaining = asNumber(premiumInteractions.remaining)
  const percentRemaining = asNumber(premiumInteractions.percent_remaining)
  const overageRequests = Math.max(0, asNumber(premiumInteractions.overage_count) ?? 0)
  const resetAt = parseResetTimestamp(premiumInteractions.reset_date ?? payload.quota_reset_date)
  const quotaMonth = resetAt ? quotaMonthFromResetAt(resetAt) : currentQuotaMonth()

  const monthlyAllowance = unlimited ? null : entitlement ?? null
  const usedPremiumRequests = unlimited
    ? Math.max(0, overageRequests)
    : resolveUsedPremiumRequests(entitlement, remaining, percentRemaining, overageRequests)

  return {
    quotaMonth,
    usedPremiumRequests,
    monthlyAllowance,
    quotaPercent: toQuotaPercent(usedPremiumRequests, monthlyAllowance, percentRemaining),
    overageRequests,
    resetAt: resetAt ?? Date.UTC(quotaMonth.year, quotaMonth.month, 1, 0, 0, 0),
    fetchedAt: Date.now(),
    source: "oauth-snapshot",
  }
}

function currentQuotaMonth(): GitHubCopilotSnapshot["quotaMonth"] {
  const now = new Date()
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
  }
}

function quotaMonthFromResetAt(resetAt: number): GitHubCopilotSnapshot["quotaMonth"] {
  const date = new Date(resetAt - 1000)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  }
}

function parseResetTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null

  return timestamp
}

function resolveUsedPremiumRequests(
  entitlement: number | null,
  remaining: number | null,
  percentRemaining: number | null,
  overageRequests: number,
): number {
  if (entitlement !== null && remaining !== null) {
    return Math.max(0, entitlement - remaining + overageRequests)
  }

  if (entitlement !== null && percentRemaining !== null) {
    return Math.max(0, entitlement * (1 - percentRemaining / 100) + overageRequests)
  }

  return Math.max(0, overageRequests)
}

function toQuotaPercent(
  usedPremiumRequests: number,
  monthlyAllowance: number | null,
  percentRemaining?: number | null,
): number {
  if (percentRemaining !== undefined && percentRemaining !== null) {
    return Number((100 - percentRemaining).toFixed(1))
  }

  if (monthlyAllowance === null || monthlyAllowance <= 0) return 0
  return Number(((usedPremiumRequests / monthlyAllowance) * 100).toFixed(1))
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value

  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }

  return null
}

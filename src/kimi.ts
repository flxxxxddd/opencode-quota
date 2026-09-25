import { isAuthExpired, type OpenAIResolvedAuth } from "./opencode-auth.js"

export type KimiSnapshot = {
  name: string
  plan?: string
  windows: Array<{ label: string; percentRemaining: number; resetAt?: number; detail?: string }>
  notes?: string[]
}

type Row = { limit?: string | number; remaining?: string | number; used?: string | number; resetTime?: string }
type Ratio = { used_ratio?: number; reset_time?: string }
type Usage = {
  usage?: Row
  limits?: Array<{ window?: { duration?: number; timeUnit?: string }; detail?: Row }>
  usages?: { limit_5h?: Ratio; limit_month_total?: Ratio; limit_month_code?: Ratio }
  user?: { membership?: { level?: string } }
  booster_wallet?: { status?: string }
}

function windowFromRatio(ratio: Ratio | undefined, label: string): KimiSnapshot["windows"][number] | undefined {
  if (!ratio || typeof ratio !== "object" || typeof ratio.used_ratio !== "number" || !Number.isFinite(ratio.used_ratio)) return undefined
  const resetAt = ratio.reset_time ? Date.parse(ratio.reset_time) : NaN
  return {
    label,
    percentRemaining: Math.max(0, Math.min(100, Math.round((1 - ratio.used_ratio) * 100))),
    ...(Number.isFinite(resetAt) ? { resetAt } : {}),
  }
}

function windowFromRow(row: Row | undefined, label: string): KimiSnapshot["windows"][number] | undefined {
  if (!row || typeof row !== "object") return undefined
  const limit = Number(row.limit)
  const remaining = row.remaining !== undefined ? Number(row.remaining) : limit - Number(row.used)
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(remaining)) return undefined
  const resetAt = row.resetTime ? Date.parse(row.resetTime) : NaN
  return {
    label,
    percentRemaining: Math.max(0, Math.min(100, Math.round(remaining / limit * 100))),
    detail: `${Math.max(0, remaining)} of ${limit} remaining`,
    ...(Number.isFinite(resetAt) ? { resetAt } : {}),
  }
}

export async function getKimiQuota(auth: NonNullable<OpenAIResolvedAuth>, name: string): Promise<KimiSnapshot> {
  if (isAuthExpired(auth.expiresAt)) throw new Error(`Kimi (${name}) authentication expired.`)
  let response: Response
  try {
    response = await fetch("https://api.kimi.com/coding/v1/usages", {
      headers: { Authorization: `Bearer ${auth.accessToken}`, Accept: "application/json" },
    })
  } catch { throw new Error(`Kimi (${name}) network error.`) }
  if (!response.ok) throw new Error(`Kimi (${name}) quota request failed (HTTP ${response.status}).`)
  const data = await response.json() as Usage
  const windows: KimiSnapshot["windows"] = []
  // New plans may have no weekly row. Don't invent a weekly limit.
  const weekly = windowFromRow(data.usage, "Weekly limit")
  if (weekly) windows.push(weekly)
  // Newer API: membership monthly pools reported as used ratios.
  const monthTotal = windowFromRatio(data.usages?.limit_month_total, "Monthly limit")
  if (monthTotal) windows.push(monthTotal)
  const monthCode = windowFromRatio(data.usages?.limit_month_code, "Monthly code limit")
  if (monthCode && monthCode.percentRemaining !== monthTotal?.percentRemaining) windows.push(monthCode)
  for (const item of Array.isArray(data.limits) ? data.limits : []) {
    if (!item || typeof item !== "object") continue
    const duration = item.window?.duration
    const unit = item.window?.timeUnit
    const label = duration === 300 && unit === "TIME_UNIT_MINUTE" ? "5-hour limit"
      : `${duration ?? "Unknown"} ${unit?.replace("TIME_UNIT_", "").toLowerCase() ?? "window"} limit`
    const window = windowFromRow(item.detail, label)
    if (window) windows.push(window)
    // The API omits detail for a completely unused rolling window.
    else if (duration === 300 && unit === "TIME_UNIT_MINUTE" && !item.detail) windows.push({ label, percentRemaining: 100 })
  }
  if (!windows.length) throw new Error(`Kimi (${name}) returned no recognizable quota windows.`)
  const level = data.user?.membership?.level
  const booster = data.booster_wallet?.status
  const notes = booster && booster !== "STATUS_DISABLED" ? ["Extra usage wallet enabled"] : undefined
  return { name, ...(level ? { plan: level.replace(/^LEVEL_/, "").toLowerCase() } : {}), windows, ...(notes ? { notes } : {}) }
}

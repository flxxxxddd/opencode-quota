import type { QuotaProviderView } from "./format.js"

export const SERVICES = ["openai", "copilot", "kimi", "go"] as const
export type Service = typeof SERVICES[number]
export type QuotaPreferences = {
  order: Service[]
  hud: boolean
  sidebar: boolean
  alerts: boolean
  refreshSeconds: number
}
export const DEFAULT_PREFERENCES: QuotaPreferences = { order: [...SERVICES], hud: true, sidebar: true, alerts: true, refreshSeconds: 120 }

export function serviceOf(provider: QuotaProviderView): Service {
  if (provider.title === "GitHub Copilot") return "copilot"
  if (provider.title === "Kimi Code") return "kimi"
  if (provider.title === "OpenCode Go") return "go"
  return "openai"
}

export function parseOrder(value: string): Service[] {
  const values = value.toLowerCase().split(/[\s,>]+/).filter(Boolean)
  if (!values.length || values.some((item) => !SERVICES.includes(item as Service)) || new Set(values).size !== values.length) {
    throw new Error("Use unique service IDs: openai, copilot, kimi, go.")
  }
  return [...values as Service[], ...SERVICES.filter((item) => !values.includes(item))]
}

export function normalizePreferences(value: Partial<QuotaPreferences>): QuotaPreferences {
  let order = [...SERVICES]
  try { order = parseOrder(Array.isArray(value.order) ? value.order.join(",") : SERVICES.join(",")) } catch { /* recover old settings */ }
  return {
    order,
    hud: typeof value.hud === "boolean" ? value.hud : true,
    sidebar: typeof value.sidebar === "boolean" ? value.sidebar : true,
    alerts: typeof value.alerts === "boolean" ? value.alerts : true,
    refreshSeconds: typeof value.refreshSeconds === "number" && Number.isFinite(value.refreshSeconds)
      ? Math.max(30, Math.min(900, value.refreshSeconds)) : 120,
  }
}

export function orderProviders(providers: QuotaProviderView[], order: Service[]): QuotaProviderView[] {
  return [...providers].sort((a, b) => order.indexOf(serviceOf(a)) - order.indexOf(serviceOf(b)))
}

export function providerKey(provider: QuotaProviderView): string {
  return provider.id ?? `${serviceOf(provider)}:${provider.account ?? provider.subtitle ?? "default"}`
}

export type AlertState = Record<string, { resetAt: number; level: number }>
/** Only emit a newly crossed threshold; reset deduplication when the quota window rolls. */
export function collectAlerts(providers: QuotaProviderView[], previous: AlertState): { messages: string[]; state: AlertState } {
  const state = { ...previous }
  const messages: string[] = []
  for (const provider of providers) {
    for (const window of provider.windows) {
      const key = `${providerKey(provider)}:${window.label}`
      const resetAt = window.resetAt ?? 0
      const old = state[key]
      const sameWindow = old && (resetAt === 0 || Math.abs(old.resetAt - resetAt) < 60_000)
      const level = window.percentRemaining <= 5 ? 2 : window.percentRemaining <= 20 ? 1 : 0
      if (level > (sameWindow ? old.level : 0)) messages.push(`${provider.title}${provider.account ? ` (${provider.account})` : ""}: ${window.label} — ${window.percentRemaining}% left.`)
      state[key] = { resetAt, level: sameWindow ? Math.max(old.level, level) : level }
    }
  }
  return { messages, state }
}

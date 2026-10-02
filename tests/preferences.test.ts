import test from "node:test"
import assert from "node:assert/strict"
import { collectAlerts, normalizePreferences, orderProviders, parseOrder } from "../src/preferences.js"
import { formatHud, quotaErrorMessage, type QuotaProviderView } from "../src/format.js"

const provider = (percent: number, resetAt = 1_000_000): QuotaProviderView => ({ id: "account-1", title: "OpenAI", windows: [{ label: "5-hour limit", percentRemaining: percent, resetAt }] })

test("order accepts a preferred service and appends omitted services", () => {
  assert.deepEqual(parseOrder("kimi > openai"), ["kimi", "openai", "copilot", "go"])
  assert.throws(() => parseOrder("openai,openai"))
  assert.throws(() => parseOrder("unknown"))
  assert.throws(() => parseOrder(""))
})
test("ordering preserves account order and does not mutate input", () => {
  const source = [provider(80), { ...provider(60), title: "Kimi Code" }, { ...provider(70), id: "account-2" }]
  const result = orderProviders(source, parseOrder("kimi"))
  assert.equal(result[0]!.title, "Kimi Code")
  assert.equal(result[1]!.id, "account-1")
  assert.equal(result[2]!.id, "account-2")
  assert.equal(source[0]!.title, "OpenAI")
})
test("preferences recover malformed stored state and clamp refresh", () => {
  assert.equal(normalizePreferences({ refreshSeconds: 1 }).refreshSeconds, 30)
  assert.equal(normalizePreferences({ refreshSeconds: NaN }).refreshSeconds, 120)
  assert.equal(normalizePreferences({ refreshSeconds: 5000 }).refreshSeconds, 900)
})
test("alerts fire once per threshold, not once per refresh", () => {
  const first = collectAlerts([provider(20)], {})
  assert.equal(first.messages.length, 1)
  assert.equal(collectAlerts([provider(19)], first.state).messages.length, 0)
  const critical = collectAlerts([provider(5)], first.state)
  assert.equal(critical.messages.length, 1)
  assert.equal(collectAlerts([provider(4)], critical.state).messages.length, 0)
  assert.equal(collectAlerts([provider(19)], critical.state).messages.length, 0)
  assert.equal(collectAlerts([provider(5, 2_000_000)], critical.state).messages.length, 1)
})
test("alerts tolerate relative-reset rounding and isolate accounts", () => {
  const first = collectAlerts([provider(5)], {})
  assert.equal(collectAlerts([provider(5, 1_001_000)], first.state).messages.length, 0)
  assert.equal(collectAlerts([{ ...provider(5), id: "account-2" }], first.state).messages.length, 1)
})
test("HUD marks stale data and safe errors never echo arbitrary secrets", () => {
  assert.match(formatHud(provider(72), 400_000, 1, 1), /72%.*stale.*!$/)
  assert.equal(quotaErrorMessage(new Error("Bearer secret-token-value")), "Could not update quota. Check your connection in /connect.")
  assert.match(quotaErrorMessage(new Error("HTTP 429")), /Rate limited/)
  assert.match(quotaErrorMessage(new Error("request timed out")), /timed out/)
})

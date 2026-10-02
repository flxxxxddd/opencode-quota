import assert from "node:assert/strict"
import { testRender } from "@opentui/solid"
import { createStore, reconcile } from "solid-js/store"
import plugin from "../src/tui.js"
import type { Context } from "@opencode/plugin/tui/context"
import type { QuotaProviderView } from "../src/format.js"

// Optional native-renderer smoke test. Run with Bun's browser condition so all
// OpenTUI components share Solid's client runtime, just as in OpenCode.
const claims: any[] = []
const commands = new Map<string, any>()
const stores = new Map<string, any>()
const feedback = { base: "#ffffff" }
let requests = 0
let dialogRender: (() => any) | undefined
let dialogsShown = 0
const providers: QuotaProviderView[] = [
  { id: "test-openai", title: "OpenAI", windows: [{ label: "5-hour limit", percentRemaining: 72 }] },
  { id: "test-kimi", title: "Kimi Code", windows: [{ label: "Weekly limit", percentRemaining: 85 }] },
]
const storage = (key: string, { initial }: any) => {
  if (stores.has(key)) return stores.get(key)
  const [state, update] = createStore(initial)
  const entry = [state, (mutation: any) => {
    const draft = structuredClone(JSON.parse(JSON.stringify(state)))
    mutation(draft); update(reconcile(draft))
    return Promise.resolve()
  }]
  stores.set(key, entry)
  return entry
}
const context = {
  options: {},
  storage: { store: storage, memory: storage },
  theme: { text: { base: "#ffffff", muted: "#aaaaaa", feedback: { info: feedback, success: feedback, warning: feedback, error: feedback } }, border: { base: "#aaaaaa" } },
  attention: { notify: async () => ({ ok: true }) },
  data: { on: () => () => {}, session: { list: () => [], status: () => "idle" } },
  client: { rpc: () => ({ snapshot: async () => { requests++; return { providers, errors: [] } } }) },
  keymap: { layer: (factory: any) => { for (const command of factory().commands ?? []) commands.set(command.id, command) } },
  ui: {
    slot: (claim: any) => { claims.push(claim); return () => {} },
    toast: { show: () => {} },
    dialog: { set: () => {}, show: (render: any) => { dialogsShown++; dialogRender = render }, clear: () => { dialogRender = undefined }, prompt: async () => "kimi, openai", select: async () => undefined },
  },
} as unknown as Context

const dispose = await plugin.setup(context)
const app = claims.find((claim) => claim.append === "app")
app.render()
const hudClaim = claims.find((claim) => claim.append === "prompt.footer.status")
const hud = await testRender(() => hudClaim.render(), { width: 100, height: 4 })
const sidebarClaim = claims.find((claim) => claim.append === "sidebar.content")
const sidebar = await testRender(() => sidebarClaim.render(), { width: 65, height: 16 })
try {
  await commands.get("quota.show").run()
  await hud.flush()
  assert.match(hud.captureCharFrame(), /OpenAI.*72%/)
  await sidebar.flush()
  assert.match(sidebar.captureCharFrame(), /OpenAI/)
  assert.match(sidebar.captureCharFrame(), /Kimi Code/)
  assert.match(sidebar.captureCharFrame(), /72%/)
  const row = sidebar.captureCharFrame().split("\n").findIndex((line) => line.includes("● OpenAI"))
  assert.ok(row >= 0)
  const clicksBefore = dialogsShown
  const requestsBeforeClick = requests
  await sidebar.mockMouse.pressDown(2, row)
  assert.equal(dialogsShown, clicksBefore, "press/hold alone must not open the dialog")
  await sidebar.mockMouse.release(2, row)
  assert.equal(dialogsShown, clicksBefore + 1, "a normal released click opens the quota dialog")
  assert.equal(requests, requestsBeforeClick, "cached sidebar clicks do not refresh")
  const beforeTab = requests
  const dashboard = await testRender(() => dialogRender!(), { width: 100, height: 24 })
  await dashboard.flush()
  assert.match(dashboard.captureCharFrame(), /72% left/)
  await commands.get("quota.next").run()
  assert.equal(requests, beforeTab, "tab changes must not fetch")
  dashboard.renderer.destroy()
  const second = await testRender(() => dialogRender!(), { width: 100, height: 24 })
  await second.flush()
  assert.match(second.captureCharFrame(), /Kimi Code/)
  second.renderer.destroy()
  await commands.get("quota.order").run()
  await hud.flush()
  assert.match(hud.captureCharFrame(), /Kimi Code.*85%/)
  await sidebar.flush()
  assert.ok(sidebar.captureCharFrame().indexOf("Kimi Code") < sidebar.captureCharFrame().indexOf("OpenAI"), "saved order also reorders sidebar")
  const beforeRedraw = requests
  await sidebar.flush()
  assert.equal(requests, beforeRedraw, "sidebar redraws must reuse snapshots")
  await stores.get("preferences")[1]((draft: any) => { draft.sidebar = false })
  await sidebar.flush()
  assert.doesNotMatch(sidebar.captureCharFrame(), /Quota|OpenAI|Kimi Code/)
  console.log("UI smoke passed: reactive HUD/sidebar, instant tabs, saved ordering and no requests on redraw.")
} finally {
  if (typeof dispose === "function") dispose()
  hud.renderer.destroy()
  sidebar.renderer.destroy()
}

import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { jsx } from "@opentui/solid/jsx-runtime"
import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { clickAction } from "./click.js"
import { QuotaRpc } from "./rpc.js"
import { QuotaDialog, type QuotaDashboardData } from "./quota-dialog.js"
import { loadOptionalOpenCodeGoConfig } from "./config.js"
import {
  copilotView,
  openAIView,
  kimiView,
  openCodeGoView,
  formatHud,
  formatResetCountdown,
  quotaErrorMessage,
  type QuotaProviderView,
} from "./format.js"
import { getOpenAIQuota, listResetCredits, consumeResetCredit } from "./openai.js"
import { getKimiQuota } from "./kimi.js"
import { getOpenCodeGoQuota } from "./opencode-go.js"
import { readAdditionalAuthFiles, resolveOpenAIAuth, resolveKimiAuth, type OpenAIResolvedAuth } from "./opencode-auth.js"
import { collectAlerts, DEFAULT_PREFERENCES, normalizePreferences, orderProviders, parseOrder, providerKey, serviceOf, SERVICES, type AlertState, type QuotaPreferences } from "./preferences.js"

const plugin = Plugin.define({
  id: "whosydd.opencode-quota",
  setup(context) {
    const [preferences, savePreferences] = context.storage.store<QuotaPreferences>("preferences", {
      initial: normalizePreferences({ ...DEFAULT_PREFERENCES, ...context.options }),
    })
    const [alerts, saveAlerts] = context.storage.store<{ windows: AlertState }>("thresholds", { initial: { windows: {} } })
    const [live, updateLive] = context.storage.memory<{ data: QuotaDashboardData; busy: boolean; now: number }>("dashboard", {
      initial: { data: { providers: [], errors: [], fetchedAt: 0 }, busy: false, now: Date.now() },
    })
    let disposed = false
    let accounts = new Map<string, NonNullable<OpenAIResolvedAuth>>()
    let inFlight: Promise<void> | undefined
    let inFlightFresh = false
    let lastActive = Date.now()
    let lastAttemptAt = 0
    let selectedKey: string | undefined
    let dialogVersion = 0
    const sorted = () => orderProviders(live.data.providers, normalizePreferences(preferences).order)
    const sidebarEnabled = () => normalizePreferences(preferences).sidebar
    const pollingEnabled = () => preferences.hud || sidebarEnabled() || preferences.alerts

    function refresh(fresh = false): Promise<void> {
      if (inFlight) return fresh && !inFlightFresh ? inFlight.then(() => refresh(true)) : inFlight
      inFlightFresh = fresh
      lastAttemptAt = Date.now()
      updateLive((draft) => { draft.busy = true })
      inFlight = (async () => {
        try {
          const result = await buildQuotaDashboard(context, fresh)
          if (disposed) return
          accounts = result.accounts
          updateLive((draft) => {
            // Keep the last successful snapshot visibly stale on complete failure.
            if (!result.data.providers.length && draft.data.providers.length) draft.data.errors = result.data.errors
            else draft.data = result.data
          })
          if (preferences.alerts) {
            const next = collectAlerts(result.data.providers, alerts.windows)
            await saveAlerts((draft) => { draft.windows = next.state })
            if (next.messages.length) {
              const message = next.messages.join("\n")
              context.ui.toast.show({ title: "Low quota", message, variant: "warning", duration: 8000 })
              void context.attention.notify({ title: "Low quota", message, notification: { when: "blurred" }, sound: false }).catch(() => {})
            }
          }
        } catch (error) {
          if (!disposed) updateLive((draft) => { draft.data.errors = [quotaErrorMessage(error)] })
        } finally {
          if (!disposed) updateLive((draft) => { draft.busy = false })
        }
      })().finally(() => { inFlight = undefined })
      return inFlight
    }

    function present(index?: number): void {
      if (disposed) return
      const providers = sorted()
      const selected = index ?? Math.max(0, providers.findIndex((provider) => providerKey(provider) === selectedKey))
      const total = providers.length + Number(live.data.errors.length > 0)
      const safeIndex = Math.max(0, Math.min(selected, Math.max(0, total - 1)))
      if (providers[safeIndex]) selectedKey = providerKey(providers[safeIndex]!)
      const data = { ...live.data, providers }
      const version = ++dialogVersion
      let resetBusy = false
      context.ui.dialog.set({ size: total <= 1 ? "medium" : "large", centered: true })
      context.ui.dialog.show(() => <QuotaDialog context={context} data={data} selected={safeIndex}
        onSelect={(next) => { context.ui.dialog.clear(); present(next) }}
        onRefresh={async () => { await refresh(true); if (version !== dialogVersion) return; context.ui.dialog.clear(); present() }}
        onSettings={settings}
        onMove={async (direction) => {
          const provider = providers[safeIndex]
          if (!provider) return
          const service = serviceOf(provider)
          const order = normalizePreferences(preferences).order
          const from = order.indexOf(service)
          const to = Math.max(0, Math.min(order.length - 1, from + direction))
          ;[order[from], order[to]] = [order[to]!, order[from]!]
          await savePreferences((draft) => { draft.order = order })
          context.ui.dialog.clear(); present()
        }}
        onReset={async (account) => {
          if (resetBusy) return
          resetBusy = true
          try { await redeemReset(context, data, accounts, account, async () => { await refresh(true); present() }) }
          finally { resetBusy = false }
        }} />, () => { dialogVersion++ })
    }

    async function open(): Promise<void> {
      lastActive = Date.now()
      context.ui.toast.show({ message: "Fetching quota…", variant: "info" })
      await refresh(true)
      present()
    }

    async function changeOrder(): Promise<void> {
      const value = await context.ui.dialog.prompt({ title: "Quota service order", description: "First service also appears in the HUD. IDs: openai, copilot, kimi, go. Omitted services go last.", value: normalizePreferences(preferences).order.join(", ") })
      if (value === undefined) return
      try {
        const order = parseOrder(value)
        await savePreferences((draft) => { draft.order = order })
        selectedKey = undefined
        context.ui.toast.show({ message: `Quota order: ${order.join(" → ")}`, variant: "success" })
      } catch (error) {
        await context.ui.dialog.alert({ title: "Invalid order", message: errorMessage(error) })
      }
    }

    async function settings(): Promise<void> {
      const action = await context.ui.dialog.select({ title: "Quota settings", options: [
        { title: "Choose first service", value: "first", description: "First tab and HUD service" },
        { title: "Reorder all services", value: "order" },
        { title: `HUD: ${preferences.hud ? "on" : "off"}`, value: "hud" },
        { title: `Quota sidebar: ${sidebarEnabled() ? "on" : "off"}`, value: "sidebar" },
        { title: `Low-quota alerts: ${preferences.alerts ? "on" : "off"}`, value: "alerts", description: "20% / 5%, once per threshold and window" },
        { title: `Active refresh: ${preferences.refreshSeconds}s`, value: "refresh" },
      ] })
      if (action === "order") await changeOrder()
      if (action === "first") {
        const first = await context.ui.dialog.select({ title: "First quota service", options: SERVICES.map((service) => ({ title: service, value: service })) })
        if (first) {
          await savePreferences((draft) => { draft.order = [first, ...normalizePreferences(draft).order.filter((service) => service !== first)] })
          selectedKey = undefined
        }
      }
      if (action === "hud" || action === "alerts" || action === "sidebar") await savePreferences((draft) => { draft[action] = !normalizePreferences(draft)[action] })
      if (action === "refresh") {
        const seconds = await context.ui.dialog.select({ title: "Refresh while active", options: [30, 60, 120, 300, 900].map((value) => ({ title: `${value} seconds`, value })) })
        if (seconds) await savePreferences((draft) => { draft.refreshSeconds = seconds })
      }
      present()
    }

    const unregisterCommands = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "quota.show",
              title: "Show quota",
              group: "Quota",
              palette: true,
              slash: { name: "quota" },
              suggested: true,
              run: open,
            },
            { id: "quota.settings", title: "Quota settings", group: "Quota", palette: true, slash: { name: "quota-settings" }, run: settings },
            { id: "quota.order", title: "Reorder quota services", group: "Quota", palette: true, slash: { name: "quota-order" }, run: changeOrder },
          ],
          bindings: ["quota.show", "quota.settings", "quota.order"],
        }))
        return null
      },
    })
    const unregisterHud = context.ui.slot({
      append: "prompt.footer.status",
      render: () => jsx("box", { ...clickAction(() => { void open() }), children: jsx("text", {
        selectable: false,
        get fg() {
          const low = Math.min(...(sorted()[0]?.windows.map((window) => window.percentRemaining) ?? [100]))
          return low <= 5 ? context.theme.text.feedback.error.base : low <= 20 ? context.theme.text.feedback.warning.base : context.theme.text.muted
        },
        get children() { return preferences.hud ? `${live.busy ? "↻ " : ""}${formatHud(sorted()[0], live.now, live.data.fetchedAt, live.data.errors.length)}` : "" },
      }) }),
    })
    const unregisterSidebar = context.ui.slot({
      append: "sidebar.content",
      render: () => Show({
        get when() { return sidebarEnabled() },
        get children() { return jsx("box", {
          flexDirection: "column", gap: 1,
          children: [
            jsx("box", { ...clickAction(() => { lastActive = Date.now(); if (live.data.fetchedAt) present(); else void open() }), children: jsx("text", { selectable: false, attributes: TextAttributes.BOLD, fg: context.theme.text.feedback.info.base, get children() { return `Quota  ›${live.busy ? "  updating" : ""}${live.now - live.data.fetchedAt > 300_000 && live.data.fetchedAt ? "  stale" : ""}` } }) }),
            jsx("scrollbox", {
              width: "100%", scrollY: true,
              get height() { return Math.min(20, Math.max(1, sorted().reduce((lines, provider) => lines + 2 + Number(Boolean(provider.account)) + provider.windows.length * 2, 0))) },
              children: jsx("box", { flexDirection: "column", children: For({
                get each() { return sorted() },
                children: (provider: QuotaProviderView, index: () => number) => jsx("box", {
                  flexDirection: "column", paddingBottom: 1,
                  ...clickAction(() => { lastActive = Date.now(); present(index()) }),
                  children: [
                    jsx("text", { selectable: false, attributes: TextAttributes.BOLD, fg: serviceOf(provider) === "kimi" ? context.theme.text.feedback.success.base : serviceOf(provider) === "copilot" ? context.theme.text.feedback.warning.base : context.theme.text.feedback.info.base, get children() { return `● ${provider.title}  ›` } }),
                    Show({ get when() { return provider.account }, get children() { return jsx("text", { selectable: false, fg: context.theme.text.muted, wrapMode: "none", truncate: true, get children() { return provider.account ?? "" } }) } }),
                    For({ get each() { return provider.windows }, children: (window: QuotaProviderView["windows"][number]) => jsx("box", {
                      flexDirection: "column",
                      children: [
                        jsx("box", { flexDirection: "row", gap: 1, children: [
                          jsx("text", { selectable: false, fg: context.theme.text.base, width: 12, wrapMode: "none", truncate: true, get children() { return window.label.replace(/-hour limit$/, "h").replace(/-day limit$/, "d").replace(/ limit$/, "") } }),
                          jsx("text", { selectable: false, children: [
                            jsx("span", { get style() { return { fg: window.percentRemaining <= 5 ? context.theme.text.feedback.error.base : window.percentRemaining <= 20 ? context.theme.text.feedback.warning.base : context.theme.text.feedback.success.base } }, get children() { return "━".repeat(Math.max(0, Math.min(8, Math.round(window.percentRemaining * 8 / 100)))) } }),
                            jsx("span", { style: { fg: context.theme.text.muted }, get children() { return "─".repeat(8 - Math.max(0, Math.min(8, Math.round(window.percentRemaining * 8 / 100)))) } }),
                          ] }),
                          jsx("text", { selectable: false, get fg() { return window.percentRemaining <= 5 ? context.theme.text.feedback.error.base : window.percentRemaining <= 20 ? context.theme.text.feedback.warning.base : context.theme.text.feedback.success.base }, get children() { return `${window.percentRemaining}% left` } }),
                        ] }),
                        jsx("text", { selectable: false, fg: context.theme.text.muted, wrapMode: "none", truncate: true, get children() { live.now; return window.resetAt ? `  Reset in ${formatResetCountdown(new Date(window.resetAt).toISOString())}` : "  No reset time reported" } }),
                      ],
                    }) }),
                  ],
                }),
              }) }),
            }),
            jsx("text", { selectable: false, fg: context.theme.text.muted, get children() { return live.data.errors.length ? `${live.data.errors.length} quota error(s) · /quota` : live.data.providers.length ? "Click service to open · /quota" : "Connect account · /quota" } }),
          ],
        }) },
      }),
    })
    const stopActivity = context.data.on("session.execution.started", () => { lastActive = Date.now(); if (pollingEnabled() && Date.now() - lastAttemptAt >= normalizePreferences(preferences).refreshSeconds * 1000) void refresh() })
    const timer = setInterval(() => {
      updateLive((draft) => { draft.now = Date.now() })
      const running = context.data.session.list().some((session) => context.data.session.status(session.id) === "running")
      if (running) lastActive = Date.now()
      if (pollingEnabled() && Date.now() - lastActive < 300_000 && Date.now() - lastAttemptAt >= normalizePreferences(preferences).refreshSeconds * 1000) void refresh()
    }, 10_000)
    if (pollingEnabled()) void refresh()
    return () => { disposed = true; clearInterval(timer); stopActivity(); unregisterHud(); unregisterSidebar(); unregisterCommands() }
  },
})

async function redeemReset(context: Context, data: QuotaDashboardData, accounts: Map<string, NonNullable<OpenAIResolvedAuth>>, account: string, onRedeemed: () => Promise<void>): Promise<void> {
  const options = data.providers.filter((provider) => provider.reset?.account === account).flatMap((provider) => provider.reset?.credits.map((credit) => ({
    title: `${provider.title} · ${credit.title}`,
    description: credit.expiresAt ? `Expires ${new Date(credit.expiresAt).toLocaleString()}` : undefined,
    value: JSON.stringify([provider.reset!.account, credit.id]),
  })) ?? [])
  if (!options.length) {
    context.ui.toast.show({ message: "No redeemable OpenAI resets loaded.", variant: "info" })
    return
  }
  const choice = await context.ui.dialog.select({ title: "Select saved reset", options })
  if (!choice) return
  const [name, id] = JSON.parse(choice) as [string, string]
  const accountLabel = data.providers.find((provider) => provider.reset?.account === name)?.account ?? "OpenAI"
  const auth = accounts.get(name)
  if (!auth) {
    const provider = data.providers.find((item) => item.reset?.account === name)
    if (!provider) return
  }
  let selectedCredit: Awaited<ReturnType<typeof listResetCredits>>["credits"][number] | undefined
  try {
    const current = auth ? await listResetCredits(auth) : { credits: data.providers.find((item) => item.reset?.account === name)?.reset?.credits ?? [] }
    selectedCredit = current.credits.find((credit) => credit.id === id)
    if (!selectedCredit) {
      context.ui.toast.show({ message: "That reset is no longer available. Refresh /quota.", variant: "warning" })
      return
    }
  } catch (error) {
    await context.ui.dialog.alert({ title: "Reset unavailable", message: errorMessage(error) })
    return
  }
  const confirmed = await context.ui.dialog.confirm({
    title: "Spend 1 saved reset?",
    message: `Account: ${accountLabel}\n${selectedCredit.title}${selectedCredit.expiresAt ? ` · expires ${new Date(selectedCredit.expiresAt).toLocaleString()}` : ""}\nThis is irreversible and may move your weekly reset date. Cancel keeps the reset.`,
    label: { confirm: "Yes, spend reset", cancel: "Keep reset" },
  })
  if (!confirmed) return
  try {
    const message = auth ? await consumeResetCredit(auth, id) : ((await context.client.rpc(QuotaRpc).redeem({ credentialID: name, creditID: id })) as { message: string }).message
    context.ui.toast.show({ message, variant: "success" })
    await onRedeemed()
  } catch (error) {
    await context.ui.dialog.alert({ title: "Reset failed", message: errorMessage(error) })
  }
}

async function buildQuotaDashboard(context: Context, fresh = false): Promise<{ data: QuotaDashboardData; accounts: Map<string, NonNullable<OpenAIResolvedAuth>> }> {
  const tasks: Array<Promise<QuotaProviderView>> = []
  const errors: string[] = []
  const accounts = new Map<string, NonNullable<OpenAIResolvedAuth>>()

  try {
    if (loadOptionalOpenCodeGoConfig()) {
      tasks.push(getOpenCodeGoQuota().then(openCodeGoView))
    }
  } catch (error) {
    errors.push(errorMessage(error))
  }

  try {
    const snapshot = await context.client.rpc(QuotaRpc).snapshot({ fresh }) as { providers: QuotaProviderView[]; errors: string[] }
    for (const provider of snapshot.providers) tasks.push(Promise.resolve(provider as QuotaProviderView))
    errors.push(...snapshot.errors)
  } catch {
    errors.push("V2 quota service unavailable. Configure the quota plugin in opencode.jsonc and restart OpenCode.")
  }

  try {
    const sources = await readAdditionalAuthFiles()
    for (const source of sources) {
      const openai = resolveOpenAIAuth(source.auth)
      if (openai) {
        const name = openai.email ?? openai.accountId ?? source.name
        if (![...accounts.values()].some((account) =>
          (Boolean(account.accountId) && account.accountId === openai.accountId) || account.accessToken === openai.accessToken,
        )) {
          const uniqueName = accounts.has(name) ? `${name} (${source.name})` : name
          accounts.set(uniqueName, openai)
          tasks.push(getOpenAIQuota(openai).then((snapshot) => {
            if (!snapshot) throw new Error(`OpenAI (${uniqueName}) quota unavailable.`)
            return { ...openAIView(snapshot, uniqueName), id: `external:${uniqueName}` }
          }).catch((error) => { throw new Error(`OpenAI (${uniqueName}): ${errorMessage(error)}`) }))
        }
      }
      const kimi = resolveKimiAuth(source.auth)
      if (kimi) tasks.push(getKimiQuota(kimi, source.name).then(kimiView))
    }
    const kimiKeys = process.env.OPENCODE_QUOTA_KIMI_KEYS?.trim()
    if (kimiKeys) {
      let entries: unknown
      try { entries = JSON.parse(kimiKeys) } catch { throw new Error("OPENCODE_QUOTA_KIMI_KEYS must be a JSON object of account names to API keys.") }
      if (!entries || typeof entries !== "object" || Array.isArray(entries) || !Object.values(entries).every((key) => typeof key === "string" && key.length >= 10)) {
        throw new Error("OPENCODE_QUOTA_KIMI_KEYS must be a JSON object of account names to API keys.")
      }
      for (const [name, token] of Object.entries(entries as Record<string, string>)) {
        if (!name.trim()) continue
        tasks.push(getKimiQuota({ accessToken: token }, name).then(kimiView))
      }
    }
  } catch (error) { errors.push(errorMessage(error)) }

  if (tasks.length === 0 && errors.length === 0) errors.push("No quota providers configured. Connect an account in /connect.")

  const results = await Promise.allSettled(tasks)
  const providers: QuotaProviderView[] = []

  for (const result of results) {
    if (result.status === "fulfilled") {
      providers.push(result.value)
      continue
    }

    errors.push(errorMessage(result.reason))
  }

  return { data: { providers, errors, fetchedAt: Date.now() }, accounts }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to fetch quota."
}

export default plugin

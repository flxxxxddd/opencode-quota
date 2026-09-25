import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { QuotaRpc } from "./rpc.js"
import { QuotaDialog, type QuotaDashboardData } from "./quota-dialog.js"
import { loadOptionalOpenCodeGoConfig } from "./config.js"
import {
  copilotView,
  openAIView,
  kimiView,
  openCodeGoView,
  type QuotaProviderView,
} from "./format.js"
import { getOpenAIQuota, listResetCredits, consumeResetCredit } from "./openai.js"
import { getKimiQuota } from "./kimi.js"
import { getOpenCodeGoQuota } from "./opencode-go.js"
import { readAdditionalAuthFiles, resolveOpenAIAuth, resolveKimiAuth, type OpenAIResolvedAuth } from "./opencode-auth.js"

const plugin = Plugin.define({
  id: "whosydd.opencode-quota",
  setup(context) {
    return context.ui.slot({
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
              run: () => showQuotaDialog(context),
            },
          ],
          bindings: ["quota.show"],
        }))
        return null
      },
    })
  },
})

async function showQuotaDialog(context: Context): Promise<void> {
  context.ui.toast.show({ message: "Fetching quota…", variant: "info" })

  try {
    const { data, accounts } = await buildQuotaDashboard(context)
    let resetBusy = false
    context.ui.dialog.set({ size: data.providers.length === 1 && data.errors.length === 0 ? "medium" : "large", centered: true })
    context.ui.dialog.show(() => <QuotaDialog context={context} data={data} onReset={async (account) => {
      if (resetBusy) return
      resetBusy = true
      try { await redeemReset(context, data, accounts, account) } finally { resetBusy = false }
    }} />)
  } catch (error) {
    await context.ui.dialog.alert({
      title: "Quota Error",
      message: error instanceof Error ? error.message : "Failed to fetch quota.",
    })
  }
}

async function redeemReset(context: Context, data: QuotaDashboardData, accounts: Map<string, NonNullable<OpenAIResolvedAuth>>, account: string): Promise<void> {
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
    await showQuotaDialog(context)
  } catch (error) {
    await context.ui.dialog.alert({ title: "Reset failed", message: errorMessage(error) })
  }
}

async function buildQuotaDashboard(context: Context): Promise<{ data: QuotaDashboardData; accounts: Map<string, NonNullable<OpenAIResolvedAuth>> }> {
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
    const snapshot = await context.client.rpc(QuotaRpc).snapshot({}) as { providers: QuotaProviderView[]; errors: string[] }
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
            return openAIView(snapshot, uniqueName)
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

  if (tasks.length === 0) {
    if (errors.length > 0) {
      throw new Error(errors.join("\n\n"))
    }

    throw new Error(
      "No quota providers are configured. Log in through OpenCode or configure OpenCode Go / Kimi credentials.",
    )
  }

  const results = await Promise.allSettled(tasks)
  const providers: QuotaProviderView[] = []

  for (const result of results) {
    if (result.status === "fulfilled") {
      providers.push(result.value)
      continue
    }

    errors.push(errorMessage(result.reason))
  }

  if (providers.length === 0) {
    throw new Error(errors.join("\n\n"))
  }

  return { data: { providers, errors, fetchedAt: Date.now() }, accounts }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to fetch quota."
}

export default plugin

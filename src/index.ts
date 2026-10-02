import { Plugin } from "@opencode/plugin"
import { QuotaRpc } from "./rpc.js"
import { getOpenAIQuota, listResetCredits, consumeResetCredit } from "./openai.js"
import { getGitHubCopilotQuota } from "./github-copilot.js"
import { getKimiQuota } from "./kimi.js"
import { openAIView, copilotView, kimiView, quotaErrorMessage, type QuotaProviderView } from "./format.js"
import { resolveOpenAIAuth, type OpenAIResolvedAuth } from "./opencode-auth.js"

const OPENAI_IDS = new Set(["openai", "codex", "chatgpt"])
const KIMI_IDS = new Set(["kimi-coding", "kimi", "kimi-code-plan-global", "kimi-code-plan-cn"])

const plugin = Plugin.define({
  id: "whosydd.opencode-quota",
  async setup(ctx) {
    let cached: { providers: QuotaProviderView[]; errors: string[] } | undefined
    let cachedAt = 0
    let pending: Promise<{ providers: QuotaProviderView[]; errors: string[] }> | undefined
    async function openAIAccount(connection: { type: "credential"; id: string; label: string; method: "key" | "oauth" }): Promise<NonNullable<OpenAIResolvedAuth> | null> {
      if (connection.method !== "oauth") return null
      const credential = await ctx.integration.connection.resolve(connection)
      if (credential?.type !== "oauth") return null
      const metadata = credential.metadata ?? {}
      const accountId = typeof metadata.accountId === "string" ? metadata.accountId : undefined
      return resolveOpenAIAuth({ openai: { type: "oauth", access: credential.access, expires: credential.expires, accountId } })
    }

    async function snapshot() {
      const integrations = await ctx.integration.list()
      const providers: QuotaProviderView[] = []
      const errors: string[] = []
      const jobs: Array<Promise<QuotaProviderView | undefined>> = []
      for (const integration of integrations.data) {
        if (!OPENAI_IDS.has(integration.id) && !KIMI_IDS.has(integration.id) && integration.id !== "github-copilot") continue
        for (const connection of integration.connections) {
          if (connection.type !== "credential") continue
          jobs.push((async () => {
            try {
              if (OPENAI_IDS.has(integration.id)) {
                const auth = await openAIAccount(connection)
                if (!auth) return undefined
                const snapshot = await getOpenAIQuota(auth)
                if (!snapshot) return undefined
                const view = openAIView(snapshot, auth.email ?? connection.label)
                view.id = connection.id
                // The credential ID is an opaque selector, never an access token.
                if (view.reset) view.reset.account = connection.id
                return view
              } else if (integration.id === "github-copilot" && connection.method === "oauth") {
                const credential = await ctx.integration.connection.resolve(connection)
                if (credential?.type !== "oauth") return undefined
                return { ...copilotView(await getGitHubCopilotQuota({ accessToken: credential.access, expiresAt: credential.expires })), id: connection.id, account: connection.label }
              } else if (KIMI_IDS.has(integration.id)) {
                const credential = await ctx.integration.connection.resolve(connection)
                const token = credential?.type === "oauth" ? credential.access : credential?.type === "key" ? credential.key : undefined
                if (!token) return undefined
                return { ...kimiView(await getKimiQuota({ accessToken: token, expiresAt: credential?.type === "oauth" ? credential.expires : undefined }, connection.label)), id: connection.id }
              }
              return undefined
            } catch (error) {
              errors.push(`${integration.name} (${connection.label}): ${quotaErrorMessage(error)}`)
              return undefined
            }
          })())
        }
      }
      providers.push(...(await Promise.all(jobs)).filter((view): view is QuotaProviderView => view !== undefined))
      // RPC output is validated against the schema as strict JSON: strip
      // undefined fields so optional view properties do not fail the call.
      return JSON.parse(JSON.stringify({ providers, errors })) as { providers: QuotaProviderView[]; errors: string[] }
    }

    await ctx.rpc.register(QuotaRpc, {
      snapshot: async (input) => {
        if (!(input as { fresh?: boolean }).fresh && cached && Date.now() - cachedAt < 60_000) return cached
        if (pending) return pending
        pending = snapshot().then((value) => { cached = value; cachedAt = Date.now(); return value }).finally(() => { pending = undefined })
        return pending
      },
      redeem: async (input) => {
        const { credentialID, creditID } = input as { credentialID: string; creditID: string }
        const integrations = await ctx.integration.list()
        const connection = integrations.data
          .filter((integration) => OPENAI_IDS.has(integration.id))
          .flatMap((integration) => integration.connections)
          .find((candidate) => candidate.type === "credential" && candidate.id === credentialID)
        if (!connection || connection.type !== "credential") throw new Error("OpenAI account no longer connected.")
        const auth = await openAIAccount(connection)
        if (!auth) throw new Error("OpenAI OAuth session unavailable.")
        const available = await listResetCredits(auth)
        if (!available.credits.some((credit) => credit.id === creditID)) throw new Error("Reset no longer available.")
        const message = await consumeResetCredit(auth, creditID)
        cached = undefined
        return { message }
      },
    })
  },
})

export default plugin

import { Plugin } from "@opencode/plugin"
import { QuotaRpc } from "./rpc.js"
import { getOpenAIQuota, listResetCredits, consumeResetCredit } from "./openai.js"
import { getGitHubCopilotQuota } from "./github-copilot.js"
import { getKimiQuota } from "./kimi.js"
import { openAIView, copilotView, kimiView, type QuotaProviderView } from "./format.js"
import { resolveOpenAIAuth, type OpenAIResolvedAuth } from "./opencode-auth.js"

const OPENAI_IDS = new Set(["openai", "codex", "chatgpt"])
const KIMI_IDS = new Set(["kimi-coding", "kimi"])

const plugin = Plugin.define({
  id: "whosydd.opencode-quota",
  async setup(ctx) {
    async function openAIAccount(connection: { type: "credential"; id: string; label: string; method: "key" | "oauth" }): Promise<NonNullable<OpenAIResolvedAuth> | null> {
      if (connection.method !== "oauth") return null
      const credential = await ctx.integration.connection.resolve(connection)
      if (credential?.type !== "oauth") return null
      const metadata = credential.metadata ?? {}
      const accountId = typeof metadata.accountId === "string" ? metadata.accountId : undefined
      return resolveOpenAIAuth({ openai: { type: "oauth", access: credential.access, expires: credential.expires, accountId } })
    }

    await ctx.rpc.register(QuotaRpc, {
      snapshot: async () => {
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
                  const view = openAIView(snapshot, connection.label)
                  // The credential ID is an opaque selector, never an access token.
                  if (view.reset) view.reset.account = connection.id
                  return view
                } else if (integration.id === "github-copilot" && connection.method === "oauth") {
                  const credential = await ctx.integration.connection.resolve(connection)
                  if (credential?.type !== "oauth") return undefined
                  return copilotView(await getGitHubCopilotQuota({ accessToken: credential.access, expiresAt: credential.expires }))
                } else if (KIMI_IDS.has(integration.id)) {
                  const credential = await ctx.integration.connection.resolve(connection)
                  const token = credential?.type === "oauth" ? credential.access : credential?.type === "key" ? credential.key : undefined
                  if (!token) return undefined
                  return kimiView(await getKimiQuota({ accessToken: token, expiresAt: credential?.type === "oauth" ? credential.expires : undefined }, connection.label))
                }
                return undefined
              } catch {
                errors.push(`${integration.name} (${connection.label}) could not be updated. Check your connection in /connect.`)
                return undefined
              }
            })())
          }
        }
        providers.push(...(await Promise.all(jobs)).filter((view): view is QuotaProviderView => view !== undefined))
        return { providers, errors }
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
        return { message: await consumeResetCredit(auth, creditID) }
      },
    })
  },
})

export default plugin

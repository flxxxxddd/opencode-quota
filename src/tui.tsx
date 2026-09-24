import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { QuotaDialog, type QuotaDashboardData } from "./quota-dialog.js"
import { loadOptionalOpenCodeGoConfig } from "./config.js"
import {
  copilotView,
  openAIView,
  openCodeGoView,
  type QuotaProviderView,
} from "./format.js"
import { getGitHubCopilotQuota } from "./github-copilot.js"
import { getOpenAIQuota } from "./openai.js"
import { getOpenCodeGoQuota } from "./opencode-go.js"
import { readAuthFileCached, resolveOpenAIAuth, resolveCopilotAuth } from "./opencode-auth.js"

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
    const data = await buildQuotaDashboard()
    context.ui.dialog.set({ size: "large", centered: true })
    context.ui.dialog.show(() => <QuotaDialog context={context} data={data} />)
  } catch (error) {
    await context.ui.dialog.alert({
      title: "Quota Error",
      message: error instanceof Error ? error.message : "Failed to fetch quota.",
    })
  }
}

async function buildQuotaDashboard(): Promise<QuotaDashboardData> {
  const tasks: Array<Promise<QuotaProviderView>> = []
  const errors: string[] = []

  try {
    if (loadOptionalOpenCodeGoConfig()) {
      tasks.push(getOpenCodeGoQuota().then(openCodeGoView))
    }
  } catch (error) {
    errors.push(errorMessage(error))
  }

  try {
    const auth = await readAuthFileCached()
    const hasOAuthCopilot = resolveCopilotAuth(auth) !== null

    if (hasOAuthCopilot) {
      tasks.push(getGitHubCopilotQuota().then(copilotView))
    }
  } catch (error) {
    errors.push(errorMessage(error))
  }

  try {
    const auth = await readAuthFileCached()
    const hasOpenAI = resolveOpenAIAuth(auth) !== null

    if (hasOpenAI) {
      tasks.push(
        getOpenAIQuota().then((snapshot) => {
          if (!snapshot) throw new Error("OpenAI quota data not available.")
          return openAIView(snapshot)
        }),
      )
    }
  } catch (error) {
    errors.push(errorMessage(error))
  }

  if (tasks.length === 0) {
    if (errors.length > 0) {
      throw new Error(errors.join("\n\n"))
    }

    throw new Error(
      "No quota providers are configured. Set OpenCode Go credentials in environment variables, and log in to GitHub Copilot and/or OpenAI through OpenCode.",
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

  return { providers, errors, fetchedAt: Date.now() }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to fetch quota."
}

export default plugin

import type { Context } from "@opencode/plugin/tui/context"
import type { JSX } from "@opentui/solid"
import { createSignal } from "solid-js"
import { formatResetCountdown, formatTimestamp, type QuotaProviderView, type QuotaWindowView } from "./format.js"

const BAR_WIDTH = 20

export type QuotaDashboardData = {
  providers: QuotaProviderView[]
  errors: string[]
  fetchedAt: number
}

function short(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

function tabName(provider: QuotaProviderView, providers: QuotaProviderView[]): string {
  const same = providers.filter((item) => item.title === provider.title)
  const name = provider.title === "GitHub Copilot" ? "Copilot" : provider.title === "Kimi Code" ? "Kimi" : provider.title
  return same.length > 1 ? `${name} ${same.indexOf(provider) + 1}` : name
}

export function QuotaDialog(props: { context: Context; data: QuotaDashboardData; onReset: (account: string) => Promise<void> }): JSX.Element {
  const { context, data } = props
  const theme = context.theme
  const total = data.providers.length + Number(data.errors.length > 0)
  const [selected, setSelected] = createSignal(0)
  const provider = () => data.providers[selected()]
  const move = (offset: number) => setSelected((index) => (index + offset + total) % total)

  // Custom dialogs run under the TUI's pushed "modal" input mode, so a
  // "global" layer never matches while the dialog is open.
  context.keymap.layer(() => ({
    mode: "modal",
    priority: 100,
    commands: [
      { id: "quota.close", title: "Close quota", bind: "escape", run: () => context.ui.dialog.clear() },
      { id: "quota.previous", title: "Previous quota tab", bind: "left,h,shift+tab", run: () => { if (total > 1) move(-1) } },
      { id: "quota.next", title: "Next quota tab", bind: "right,l,tab", run: () => { if (total > 1) move(1) } },
      {
        id: "quota.reset",
        title: "Redeem OpenAI reset",
        bind: "r",
        run: () => {
          const reset = provider()?.reset
          if (reset?.credits.length) return props.onReset(reset.account)
        },
      },
    ],
    bindings: ["quota.close", "quota.previous", "quota.next", "quota.reset"],
  }))

  return (
    <box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.base} attributes={1}>QUOTA</text>
        <text fg={theme.text.muted}>{data.errors.length ? "!  " : ""}{total > 1 ? `${selected() + 1} / ${total}   ` : ""}Esc close</text>
      </box>

      {total > 1 ? (
        <box flexDirection="row" gap={1}>
          <text fg={theme.text.muted}>‹</text>
          {data.providers.map((item, index) => Math.abs(index - selected()) <= 1 ? (
            <box onMouseDown={() => setSelected(index)}>
              <text fg={selected() === index ? theme.text.base : theme.text.muted} attributes={selected() === index ? 1 : 0}>
                {selected() === index ? `[ ${tabName(item, data.providers)} ]` : `  ${tabName(item, data.providers)}  `}
              </text>
            </box>
          ) : null)}
          {data.errors.length && Math.abs(data.providers.length - selected()) <= 1 ? (
            <box onMouseDown={() => setSelected(data.providers.length)}>
              <text fg={selected() === data.providers.length ? theme.text.feedback.warning.base : theme.text.muted}>
                {selected() === data.providers.length ? "[ Issues ]" : "  Issues  "}
              </text>
            </box>
          ) : null}
          <text fg={theme.text.muted}>›</text>
        </box>
      ) : null}

      {provider() ? (
        <box flexDirection="column" gap={1} paddingX={1} paddingY={1} border borderColor={theme.border.base}>
          <box flexDirection="row" gap={1}>
            <text fg={theme.text.base} attributes={1}>{provider()!.title}</text>
            {provider()!.subtitle ? <text fg={theme.text.muted}>· {short(provider()!.subtitle!, 18)}</text> : null}
          </box>
          {provider()!.account ? <text fg={theme.text.muted}>{short(provider()!.account!, 52)}</text> : null}

          {provider()!.windows.map((window) => <QuotaWindow context={context} window={window} />)}

          {provider()!.reset ? (
            <box flexDirection="column" gap={0} paddingTop={1}>
              <text fg={theme.text.base}>Saved resets  {provider()!.reset!.count} available{provider()!.reset!.credits.length ? "  ·  R to use" : ""}</text>
              {provider()!.reset!.credits[0]?.expiresAt ? (
                <text fg={theme.text.muted}>Next expires {formatTimestamp(provider()!.reset!.credits[0]!.expiresAt!)}</text>
              ) : null}
            </box>
          ) : null}
          {provider()!.notes?.map((note) => <text fg={theme.text.feedback.warning.base}>{short(note, 66)}</text>)}
        </box>
      ) : (
        <box flexDirection="column" gap={1} paddingX={1} paddingY={1} border borderColor={theme.border.base}>
          <text fg={theme.text.feedback.warning.base} attributes={1}>Could not load some accounts</text>
          {data.errors.map((error) => <text fg={theme.text.muted}>• {short(error, 66)}</text>)}
        </box>
      )}

      <text fg={theme.text.muted}>{total > 1 ? "← → / h l switch   ·   " : ""}Updated {formatTimestamp(data.fetchedAt)}</text>
    </box>
  )
}

function QuotaWindow(props: { context: Context; window: QuotaWindowView }): JSX.Element {
  const { context, window } = props
  const theme = context.theme
  const remaining = Math.max(0, Math.min(100, Math.round(window.percentRemaining)))
  const color = remaining >= 50
    ? theme.text.feedback.success.base
    : remaining >= 20
      ? theme.text.feedback.warning.base
      : theme.text.feedback.error.base
  const filledWidth = Math.round((remaining / 100) * BAR_WIDTH)
  const countdown = window.resetAt !== undefined && Number.isFinite(window.resetAt)
    ? formatResetCountdown(new Date(window.resetAt).toISOString())
    : undefined

  return (
    <box flexDirection="column" gap={0}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.base}>{short(window.label, 30)}</text>
        <text fg={color} attributes={1}>{remaining}% left</text>
      </box>
      <box flexDirection="row">
        <text fg={color}>{"━".repeat(filledWidth)}</text>
        <text fg={theme.text.muted}>{"─".repeat(BAR_WIDTH - filledWidth)}</text>
      </box>
      <text fg={theme.text.muted}>{countdown ? `Resets in ${countdown}` : "Reset time unavailable"}{window.detail ? `  ·  ${window.detail}` : ""}</text>
    </box>
  )
}

import type { Context } from "@opencode/plugin/tui/context"
import type { JSX } from "@opentui/solid"
import { formatResetCountdown, formatTimestamp, type QuotaProviderView, type QuotaWindowView } from "./format.js"

const BAR_WIDTH = 22

export type QuotaDashboardData = {
  providers: QuotaProviderView[]
  errors: string[]
  fetchedAt: number
}

export function QuotaDialog(props: { context: Context; data: QuotaDashboardData }): JSX.Element {
  const { context, data } = props
  const theme = context.theme

  context.keymap.layer(() => ({
    mode: "global",
    priority: 100,
    commands: [
      {
        id: "quota.close",
        title: "Close quota",
        bind: "escape",
        run: () => context.ui.dialog.clear(),
      },
    ],
  }))

  return (
    <box flexDirection="column" gap={1} paddingX={1} paddingY={1}>
      <box flexDirection="row" justifyContent="space-between" alignItems="center">
        <text fg={theme.text.base} attributes={1}>Quota</text>
        <text fg={theme.text.muted}>ESC to close</text>
      </box>

      {data.providers.map((provider) => (
        <box
          flexDirection="column"
          gap={1}
          paddingX={1}
          paddingY={1}
          border={true}
          borderColor={theme.border.base}
        >
          <box flexDirection="row" justifyContent="space-between" alignItems="center">
            <text fg={theme.text.base} attributes={1}>{provider.title}</text>
            {provider.subtitle ? <text fg={theme.text.muted}>{provider.subtitle}</text> : null}
          </box>

          {provider.windows.map((window) => (
            <QuotaWindow context={context} window={window} />
          ))}

          {provider.notes?.map((note) => (
            <text fg={theme.text.feedback.warning.base}>{note}</text>
          ))}
        </box>
      ))}

      {data.errors.length > 0 ? (
        <box flexDirection="column" gap={1} paddingX={1}>
          <text fg={theme.text.feedback.warning.base} attributes={1}>Some providers could not be updated</text>
          {data.errors.map((error) => <text fg={theme.text.muted}>• {error}</text>)}
        </box>
      ) : null}

      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.muted}>Updated {formatTimestamp(data.fetchedAt)}</text>
        <text fg={theme.text.muted}>Fresh data · Esc to close</text>
      </box>
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
        <text fg={theme.text.base}>{window.label}</text>
        {countdown ? <text fg={theme.text.muted}>↻ {countdown}</text> : null}
      </box>
      <box flexDirection="row" gap={1}>
        <text fg={color}>{"█".repeat(filledWidth)}</text>
        <text fg={theme.background.raised.max}>{"░".repeat(BAR_WIDTH - filledWidth)}</text>
        <text fg={color} attributes={1}>{remaining}% left</text>
      </box>
      {window.detail ? <text fg={theme.text.muted}>{window.detail}</text> : null}
    </box>
  )
}

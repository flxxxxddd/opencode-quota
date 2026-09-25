import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const plugin = fileURLToPath(new URL("../dist/", import.meta.url))

function parseInline(name) {
  if (!process.env[name]) return {}
  try {
    const value = JSON.parse(process.env[name])
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error()
    return value
  } catch {
    console.error(`${name} must be a JSON object.`)
    process.exit(1)
  }
}

// Load the server plugin (OAuth resolution + quota RPC) and the TUI plugin
// from this checkout only, without touching the user's config files.
const env = {
  ...process.env,
  OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...parseInline("OPENCODE_CONFIG_CONTENT"), plugins: [plugin] }),
  OPENCODE_CLI_CONFIG_CONTENT: JSON.stringify({ ...parseInline("OPENCODE_CLI_CONFIG_CONTENT"), plugins: [plugin] }),
}

console.log(`Starting OpenCode with local quota plugin: ${plugin}`)
console.log("Other configured plugins are disabled for this run; global config files are unchanged.")
const child = spawn("opencode", process.argv.slice(2), { stdio: "inherit", env })
child.on("error", (error) => {
  console.error(`Could not start opencode: ${error.message}`)
  process.exitCode = 1
})
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})

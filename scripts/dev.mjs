import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const plugin = fileURLToPath(new URL("../dist/", import.meta.url))
let inline = {}

if (process.env.OPENCODE_CLI_CONFIG_CONTENT) {
  try {
    inline = JSON.parse(process.env.OPENCODE_CLI_CONFIG_CONTENT)
    if (!inline || typeof inline !== "object" || Array.isArray(inline)) throw new Error("Expected a JSON object")
  } catch {
    console.error("OPENCODE_CLI_CONFIG_CONTENT must be a JSON object.")
    process.exit(1)
  }
}

// CLI plugin arrays replace the global list. This isolates the checkout from
// an installed release, while leaving the user's cli.json untouched.
const env = {
  ...process.env,
  OPENCODE_CLI_CONFIG_CONTENT: JSON.stringify({ ...inline, plugins: [plugin] }),
}

console.log(`Starting OpenCode with local quota plugin: ${plugin}`)
console.log("Other cli.json plugins are disabled for this run; global settings are unchanged.")
const child = spawn("opencode", process.argv.slice(2), { stdio: "inherit", env })
child.on("error", (error) => {
  console.error(`Could not start opencode: ${error.message}`)
  process.exitCode = 1
})
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})

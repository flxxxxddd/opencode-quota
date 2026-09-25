import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export type OpenAIOAuthData = {
  type: string
  access?: string
  key?: string
  refresh?: string
  expires?: number
  accountId?: string
}

export type CopilotAuthData = {
  type: string
  refresh?: string
  access?: string
  expires?: number
}

export type AuthData = {
  "github-copilot"?: CopilotAuthData
  copilot?: CopilotAuthData
  "copilot-chat"?: CopilotAuthData
  "github-copilot-chat"?: CopilotAuthData
  openai?: OpenAIOAuthData
  codex?: OpenAIOAuthData
  chatgpt?: OpenAIOAuthData
  opencode?: OpenAIOAuthData
  "kimi-coding"?: OpenAIOAuthData
  kimi?: OpenAIOAuthData
}

const AUTH_CACHE_MAX_AGE_MS = 5_000

type AuthCacheEntry = {
  timestamp: number
  value: AuthData | null
  inFlight?: Promise<AuthData | null>
}

let authCache: AuthCacheEntry | null = null

function getAuthPaths(): string[] {
  const home = homedir()
  const xdgDataHome = process.env.XDG_DATA_HOME?.trim()
  const candidates: string[] = []

  if (xdgDataHome) {
    candidates.push(join(xdgDataHome, "opencode", "auth.json"))
  }

  candidates.push(join(home, ".local", "share", "opencode", "auth.json"))

  if (process.platform === "darwin") {
    candidates.push(join(home, "Library", "Application Support", "opencode", "auth.json"))
  }

  const seen = new Set<string>()
  return candidates.filter((p) => {
    if (seen.has(p)) return false
    seen.add(p)
    return true
  })
}

export async function readAuthFile(): Promise<AuthData | null> {
  const paths = getAuthPaths()

  for (const path of paths) {
    let content: string
    try {
      content = await readFile(path, "utf-8")
    } catch {
      continue
    }

    try {
      return JSON.parse(content) as AuthData
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Auth file at ${path} contains invalid JSON: ${error.message}`)
      }
      continue
    }
  }

  return null
}

export async function readAuthFileCached(params?: { maxAgeMs?: number }): Promise<AuthData | null> {
  const maxAgeMs = Math.max(0, params?.maxAgeMs ?? AUTH_CACHE_MAX_AGE_MS)
  const now = Date.now()

  if (authCache && now - authCache.timestamp <= maxAgeMs) {
    return authCache.value
  }

  if (authCache?.inFlight) {
    return authCache.inFlight
  }

  const inFlight = (async () => {
    const value = await readAuthFile()
    authCache = { timestamp: Date.now(), value }
    return value
  })()

  authCache = {
    timestamp: authCache?.timestamp ?? 0,
    value: authCache?.value ?? null,
    inFlight,
  }

  try {
    return await inFlight
  } finally {
    if (authCache?.inFlight === inFlight) {
      authCache.inFlight = undefined
    }
  }
}

// Additional OpenCode auth files can be supplied for accounts that cannot coexist
// in OpenCode's single-provider auth.json. Never write credentials to this plugin.
export async function readAdditionalAuthFiles(): Promise<Array<{ name: string; auth: AuthData }>> {
  const raw = process.env.OPENCODE_QUOTA_AUTH_FILES?.trim()
  if (!raw) return []
  let entries: unknown
  try { entries = JSON.parse(raw) } catch { throw new Error("OPENCODE_QUOTA_AUTH_FILES must be a JSON array of file paths.") }
  if (!Array.isArray(entries) || !entries.every((entry) => typeof entry === "string" && entry.trim())) {
    throw new Error("OPENCODE_QUOTA_AUTH_FILES must be a JSON array of file paths.")
  }
  const result: Array<{ name: string; auth: AuthData }> = []
  for (const path of new Set(entries as string[])) {
    let content: string
    try { content = await readFile(path, "utf-8") } catch { throw new Error(`Cannot read additional auth file: ${path}`) }
    let auth: unknown
    try { auth = JSON.parse(content) } catch { throw new Error(`Invalid JSON in additional auth file: ${path}`) }
    if (!auth || typeof auth !== "object" || Array.isArray(auth)) throw new Error(`Invalid auth data in: ${path}`)
    result.push({ name: path.split(/[\\/]/).pop() ?? path, auth: auth as AuthData })
  }
  return result
}

export type OpenAIResolvedAuth = {
  accessToken: string
  email?: string
  accountId?: string
  expiresAt?: number
} | null

const OPENAI_AUTH_KEYS: Array<keyof AuthData> = ["openai", "codex", "chatgpt", "opencode"]

export function resolveOpenAIAuth(auth: AuthData | null): OpenAIResolvedAuth {
  for (const key of OPENAI_AUTH_KEYS) {
    const entry = auth?.[key]
    if (!entry || entry.type !== "oauth") continue

    const accessToken = typeof entry.access === "string" ? entry.access.trim() : ""
    if (!accessToken) continue

    const jwt = parseJwt(accessToken) as Record<string, unknown> | null
    const profile = jwt?.["https://api.openai.com/profile"] as Record<string, unknown> | undefined
    const authObj = jwt?.["https://api.openai.com/auth"] as Record<string, unknown> | undefined
    const email = typeof profile?.email === "string" ? profile.email : undefined
    const accountId = typeof authObj?.chatgpt_account_id === "string" ? authObj.chatgpt_account_id : (entry as OpenAIOAuthData).accountId

    const expiresAt = typeof entry.expires === "number" && Number.isFinite(entry.expires) ? entry.expires : undefined

    return { accessToken, email, accountId, expiresAt }
  }

  return null
}

export function resolveKimiAuth(auth: AuthData | null): OpenAIResolvedAuth {
  for (const key of ["kimi-coding", "kimi"] as const) {
    const entry = auth?.[key]
    if (!entry || (entry.type !== "oauth" && entry.type !== "api")) continue
    const token = entry.type === "api" ? entry.key?.trim() : entry.access?.trim()
    if (!token) continue
    return { accessToken: token, expiresAt: entry.expires }
  }
  return null
}

export type CopilotResolvedAuth = {
  accessToken: string
  expiresAt?: number
} | null

const COPILOT_AUTH_KEYS: Array<keyof AuthData> = [
  "github-copilot",
  "copilot",
  "copilot-chat",
  "github-copilot-chat",
]

export function resolveCopilotAuth(auth: AuthData | null): CopilotResolvedAuth {
  for (const key of COPILOT_AUTH_KEYS) {
    const entry = auth?.[key]
    if (!entry) continue
    if (entry.type !== "oauth") continue

    const accessToken = entry.access?.trim()
    if (!accessToken) continue

    const expiresAt = typeof entry.expires === "number" && Number.isFinite(entry.expires) && entry.expires > 0 ? entry.expires : undefined

    return { accessToken, expiresAt }
  }

  return null
}

export function isAuthExpired(expiresAt?: number): boolean {
  return typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Date.now()
}

function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null

    const base64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/")
    const padLen = (4 - (base64.length % 4)) % 4
    const padded = base64 + "=".repeat(padLen)
    const decoded = decodeBase64(padded)
    return JSON.parse(decoded) as Record<string, unknown>
  } catch {
    return null
  }
}

function decodeBase64(str: string): string {
  if (typeof globalThis.atob === "function") {
    return globalThis.atob(str)
  }
  return Buffer.from(str, "base64").toString("utf-8")
}

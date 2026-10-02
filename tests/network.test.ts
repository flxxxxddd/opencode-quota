import test from "node:test"
import assert from "node:assert/strict"
import { quotaFetch, QuotaRequestError } from "../src/network.js"

test("network wrapper preserves status and body", async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('{"ok":true}', { status: 429 })
  try {
    const response = await quotaFetch("https://example.invalid", {}, "Test", 100)
    assert.equal(response.status, 429)
    assert.deepEqual(await response.json(), { ok: true })
  } finally { globalThis.fetch = original }
})
test("deadline cancels slow requests without exposing secrets", async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(new Error("Authorization: secret")), { once: true })
  })
  try {
    await assert.rejects(quotaFetch("https://example.invalid", {}, "Test", 10), (error: unknown) => error instanceof QuotaRequestError && error.kind === "timeout" && !error.message.includes("secret"))
  } finally { globalThis.fetch = original }
})
test("deadline includes response body consumption", async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (_url, init) => new Response(new ReadableStream({ start(controller) {
    init!.signal!.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true })
  } }))
  try {
    await assert.rejects(quotaFetch("https://example.invalid", {}, "Test", 10), (error: unknown) => error instanceof QuotaRequestError && error.kind === "timeout")
  } finally { globalThis.fetch = original }
})
test("caller cancellation is propagated", async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    if (init!.signal!.aborted) throw new Error("aborted")
    return new Response("ok")
  }
  try {
    const controller = new AbortController(); controller.abort()
    await assert.rejects(quotaFetch("https://example.invalid", { signal: controller.signal }, "Test", 100), QuotaRequestError)
  } finally { globalThis.fetch = original }
})

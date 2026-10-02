/** Bounded requests, including response bodies. Never include headers/body in errors. */
export class QuotaRequestError extends Error {
  constructor(readonly kind: "timeout" | "network", readonly service: string) {
    super(`${service}: ${kind === "timeout" ? "request timed out" : "network unavailable"}. Try refreshing quota.`)
  }
}

export async function quotaFetch(url: string, init: RequestInit = {}, service = "Quota", timeoutMs = 12_000): Promise<Response> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  init.signal?.addEventListener("abort", abort, { once: true })
  if (init.signal?.aborted) controller.abort()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    // Keep the deadline alive until the body is consumed, not merely headers.
    const body = await response.arrayBuffer()
    return new Response(body.byteLength ? body : null, { status: response.status, statusText: response.statusText, headers: response.headers })
  } catch {
    throw new QuotaRequestError(timedOut ? "timeout" : "network", service)
  } finally {
    clearTimeout(timer)
    init.signal?.removeEventListener("abort", abort)
  }
}

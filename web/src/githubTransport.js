// GitHub transport. All GitHub calls go through the secrets proxy — the browser
// no longer holds a GitHub PAT or talks to api.github.com directly. The proxy is
// passed explicitly to every call as `{ url, token }` (dependency injection: no
// module state, so callers and tests are hermetic).

// Build the proxy descriptor from stored config.
export function proxyFromConfig(cfg) {
  return { url: cfg?.proxyUrl ?? '', token: cfg?.proxyToken ?? '' }
}

// Base for GitHub API paths; paths themselves are unchanged (`/repos/...`), the
// proxy strips `/gh` and forwards to api.github.com.
export function githubBase(proxy) {
  return `${(proxy?.url ?? '').replace(/\/$/, '')}/gh`
}

// Auth header carrying the proxy caller token (not the GitHub PAT).
export function githubAuthHeaders(proxy) {
  return proxy?.token ? { Authorization: `Bearer ${proxy.token}` } : {}
}

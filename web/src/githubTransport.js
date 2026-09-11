// GitHub transport. All GitHub calls go through the secrets proxy — the browser
// no longer holds a GitHub PAT or talks to api.github.com directly. The proxy
// base URL is configured once at startup (and on settings save) from the stored
// config; the proxy caller token is passed per call and sent as the bearer.

let proxyBaseUrl = ''

// Set the proxy base URL (from config). Call at app startup and after Settings
// save, before any GitHub request.
export function configureGithubProxy(proxyUrl) {
  proxyBaseUrl = (proxyUrl || '').replace(/\/$/, '')
}

// Base for GitHub API paths; paths themselves are unchanged (`/repos/...`), the
// proxy strips `/gh` and forwards to api.github.com.
export function githubBase() {
  return `${proxyBaseUrl}/gh`
}

// Auth header carrying the proxy caller token (not the GitHub PAT).
export function githubAuthHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

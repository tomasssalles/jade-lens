// GitHub transport selection — the Phase 1 proxy-migration flag.
//
// When VITE_PROXY_URL is set, every GitHub API call routes through the secrets
// proxy (`${PROXY_URL}/gh/...`) and authenticates with the proxy caller token;
// the GitHub PAT lives server-side and is ignored here. When it's unset, calls
// go straight to api.github.com with the PAT (the pre-proxy behavior) — so with
// the flag off the app is byte-for-byte unchanged.

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '')
const PROXY_TOKEN = import.meta.env.VITE_PROXY_TOKEN || ''

export function proxyEnabled() {
  return PROXY_URL !== ''
}

// Base URL for GitHub API paths (paths themselves are unchanged: `/repos/...`).
export function githubBase() {
  return proxyEnabled() ? `${PROXY_URL}/gh` : 'https://api.github.com'
}

// Auth header: the proxy caller token in proxy mode, the GitHub PAT otherwise.
export function githubAuthHeaders(pat) {
  if (proxyEnabled()) {
    return PROXY_TOKEN ? { Authorization: `Bearer ${PROXY_TOKEN}` } : {}
  }
  return pat ? { Authorization: `Bearer ${pat}` } : {}
}

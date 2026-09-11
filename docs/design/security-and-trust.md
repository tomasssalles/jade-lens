# Security, hosting, and trust

Two related concerns shape how far a user can rely on JADE LENS with sensitive
data: **safety** (the technical attack surface) and **trust** (what a careful
auditor concludes from code, docs, and hosting boundaries). They correlate but
move independently; good moves push both. The **current stance** below (the
secrets proxy) is built; the further hardening is intended/future. The
complementary per-record protection of the data itself is the "protected-data
tier" (future work, summarised at the end).

## The cross-origin storage exposure problem

Browser storage (IndexedDB, LocalStorage, cookies) is scoped per **origin** —
scheme + host + port — *not per path*. Same-origin pages share storage and can
script each other's sessions (e.g. load one in an iframe with no same-origin-policy
barrier).

**GitHub Pages user pages share one origin across all projects under a username**
(`<username>.github.io`). So anything else the same operator hosts under that
username can read JADE LENS's stored credential, load JADE LENS same-origin to
capture state, or stand up a convincing lookalike. Same-origin phishing defeats
the usual defenses (URL warnings, anti-phishing filters, password-manager domain
matching, WebAuthn RP-ID binding) because they all key on origin. This is the
central safety issue in the default GitHub Pages hosting story. The credential now
exposed there is the **revocable proxy token** (below), not a long-lived PAT —
which shrinks, but does not eliminate, the blast radius.

## Current stance: the secrets proxy *(built)*

The browser holds **no GitHub PAT and no LLM/STT keys**. Those live server-side on
a **thin, stateless secrets proxy** each user self-hosts (see
[proxy/README.md](../../proxy/README.md) and
[proxy-implementation-plan.md](../planning/proxy-implementation-plan.md)). The only
secret in the browser is a **proxy caller token** — a bearer credential the app
sends on every request; the proxy validates it, injects the real secrets, and
forwards (GitHub calls scoped to the one configured `owner/repo`; LLM/STT later).
It is stored unencrypted in IndexedDB alongside the repo URL and proxy URL. The
settings UI carries the threat in one line (`web/src/SettingsForm.jsx`): *"Stored
as plain text in this browser. It authorizes your proxy — revoke and reissue it
there if it leaks."*

Why this is a smaller exposure than a browser-held PAT: the on-device secret is now
a **revocable, scoped, capped delegate**, not the irreplaceable keys. A leak is
repaired by **rotating the token on the proxy** (seconds); the underlying PAT and
provider keys never leave the proxy and don't rotate on a browser leak. Provider
**spend caps** bound the billing exposure of the LLM/STT keys. And the proxy is not
an open relay: it rejects any request without the caller token and confines GitHub
forwards to the single configured repo, so a stolen token — or a found proxy URL —
can't wield the PAT beyond that repo or spend past the caps.

**Framing note for the sections below:** they were written for a PAT-in-browser
model. With the proxy, the on-device credential is the **proxy token**, so "encrypt
the PAT", "re-auth to change the PAT", and "recover by rotating the PAT" now apply
to the proxy token; the real PAT/keys sit on the proxy and rotate at their
providers only if the proxy itself is compromised.

## Sharing: the proxy is per-user *(temporary limitation)*

The proxy holds one user's secrets and is locked to them by the caller token.
Sharing the app therefore never shares your secrets — but a second user must bring
their own: **each user self-hosts their own proxy** (own PAT/keys/token). A
browser-key fallback (each user pasting raw PAT/keys into their own browser) was
deliberately rejected as unfair to non-technical users — it re-exposes the raw
secrets we just moved server-side. Consequence: the app is **currently difficult to
share with non-technical users**, since the hardened path requires deploying a
proxy. Flagged as a temporary status in the README; the open question is how simple
proxy self-hosting can be made (one-command deploy).

## Hosting model for a multi-user / sensitive future

The structural fix is **origin isolation** — JADE LENS at an origin nothing else
of ours shares:

| Path | Cost | Trade-off |
|---|---|---|
| **Custom domain CNAME'd to GitHub Pages** (e.g. `jadelens.<domain>.com`) | ~$10–15/yr | Loosens the "$0 hosting" constraint to ≈ $1/month |
| **Per-project subdomain on Cloudflare/Netlify/Vercel** | $0 (free tier) | Adds another vendor |

Either fixes the same-origin phishing concern; the choice is brand/cost.

## Optional PAT encryption (once the origin is isolated)

With an isolated origin, plaintext is exposed only to someone with physical access
to an **unlocked** device; the OS device lock is the primary defense and app-level
encryption a second layer. JADE LENS would expose encryption as a user-optional
setting (lean recommendation: on):

- **Primary:** WebAuthn PRF extension (biometric) — the 32-byte secret never
  leaves the authenticator; a biometric tap on cold start derives the AES-GCM key.
- **Fallback:** master password (PBKDF2 / Argon2id) where PRF is unsupported or for
  cross-device portability.

## Re-authenticating for settings changes

Even with the PAT encrypted, an unlocked-device attacker could *replace* the
configured repo + PAT with an attacker-controlled pair and watch the user populate
it. Defense: require re-auth (biometric / password) for **settings changes**
(repo URL, PAT, master password), on top of the unlock for data access. Routine
reads don't re-prompt. Out of scope: an unlocked-device adversary reading the
user's data through the UI — they already have the device's calendar, email, etc.;
JADE LENS isn't a hardened vault against that.

## Recovery via PAT rotation

The password / PRF secret is **only** an encryption key for the PAT. Recovery is:
revoke the PAT on github.com → generate a new one → enter it with a new password.
No recovery codes, no escrow, no email reset; the same flow handles rotation and
new-device setup. Corollary: treat PATs as **easily-rotated, short-half-life**
credentials — a leak is repaired by rotation, not panic.

## Self-hosting as a trust escape hatch

The canonical deployment lives at one origin operated by the maintainer. Stricter
users can self-host: fork the public **code** repo, deploy it anywhere (their own
`*.github.io`, Cloudflare/Netlify/Vercel), and point it at their own private
**data** repo. The deployment URL is public; the data stays private behind the
user's PAT. What doesn't work: serving JADE LENS *from* the data repo — GitHub
Pages free won't serve private repos, so the data repo can't double as the
deployment source.

## Backend-mediated auth (deferred)

A GitHub App with installation tokens would shrink the credential window to
~1-hour tokens, but the App's private key can't live in a static SPA — it needs a
backend to mint tokens, which breaks "no server-side code we operate"
([jadelens.md](jadelens.md)) and adds a strongly-trusted operator to the chain.
Not on the roadmap unless trust/safety pressure justifies it. (The secrets proxy
above is not this: it's a thin, stateless, **user-self-hosted** forwarder holding
no data — the *maintainer* still operates no server; a self-hoster's trust chain
is just their own box.)

| Auth scheme | Long-lived token on device | Adds maintainer to trust chain | Backend | UX |
|---|---|---|---|---|
| Fine-grained PAT (today) | yes | no | no | manual PAT creation |
| OAuth Device Flow | yes | yes (OAuth App) | no | one-time browser approval |
| GitHub App + backend | no (server-mediated) | yes, strongly | yes | one-time install |

## Durable substrate (Supabase / Postgres): trust at rest

If query-heavy data later moves to a database ([versioning.md](versioning.md)), the
trust frame shifts from "your data is in your private repo" to "your data is in a
database we operate." Two patterns stay on the table: **server-side encryption at
rest with operator-held keys** (standard; operator can read in principle), or
**client-side encryption with per-user keys** (1Password / Standard Notes style;
operator hosts ciphertext only and literally cannot read). Client-side costs
feature flexibility (no server-side full-text search / cross-row aggregation /
indexing on encrypted columns), but for JADE LENS's envelope (personal text data,
single-user volumes) client-side search stays workable. The decision is which to
ship when we get there.

## Trust vs. safety, restated

Safety improvements (origin isolation, encryption, self-host) raise the technical
bar. Trust improvements (open source, audit-friendly architecture, visible
operator boundaries, transparent threat docs) help a careful user form a justified
belief about safety. The decisions above move both axes together where possible —
and make the discipline-only mitigations explicit where they're load-bearing, so
they don't quietly slip.

## Related future work: the protected-data tier

Complementary to the above (which protects *credentials* and the *origin*), a
future per-record protection of the **data itself**, all client-side: a UX-only
lock (PIN at start, "lock now" button), at-rest encryption for records flagged
`protected: true` in the index (key from password or WebAuthn PRF; applies to
IndexedDB and the remote substrate, with unprotected data staying plaintext for
readability), and vendor-trust filtering (each API key carries a trust label; the
adapter withholds protected records from untrusted keys). Tracked in
[the backlog](../planning/backlog.md).

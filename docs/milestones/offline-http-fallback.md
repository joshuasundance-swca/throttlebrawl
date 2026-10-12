# Installed game return: HTTP fallback

`[default]` A focused M5 offline-1 repair. A complete installed cache must remain usable when the host answers with an error rather than rejecting the connection. Successful network pages still take priority so updates remain visible.

The service worker currently returns any resolved network response before looking at the cache. A 429 or 503 therefore replaces the cached game with the host's error page. Repair only the network-first winner policy; preserve cache identity, atomic installation, scoped requests, gzip handling and cache-first assets.

## Automated acceptance

- For navigation, index, manifest and changelog, HTTP 429/500/503 with a healthy cached response returns the cached response and retains its contents. Without a cached response, the original error status/body reaches the caller.
- A healthy new network response still wins over an older cached response. An error never overwrites cached changelog data. Existing rejected-network, manual-timeout, scope, install and gzip controls remain.
- Extend the existing installed-game browser scenario: a service-worker-owned navigation receiving 503 opens the cached game; prove the request actually received 503. Then hold the worker's navigation network request and observe the cached initial screen within M5's five-second boot bound, followed by the usable menu. Measure production mode's first intersecting start-screen event inside the document; retain driver-visible start/menu assertions and a hidden-menu observer control. This avoids test-only boot dependencies and a late driver clock sample. Release and drain held callbacks in cleanup; only the exact already-handled route result during intentional release is expected, and unexpected errors remain failures. Do not sleep to accumulate time.
- Normal scoped units, hooks, types and full CI; one coordinated deployed-worker check. No local server/build/browser specs. Phone timing and native installation remain unverified.

This does not implement race resume after a page reload. That separate app integration must preserve career context, historical objectives and settlement before shipping.

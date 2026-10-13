# Installed game return: HTTP fallback

`[default]` A focused response-correctness repair within M5 offline-1. A complete installed cache must remain usable when the host answers with an error rather than rejecting the connection. Successful network pages still take priority so updates remain visible.

The original service-worker policy returned any resolved network response before looking at the cache. A 429 or 503 therefore replaced the cached game with the host's error page. Repair that winner condition, preserving the existing three-second network window, cache identity, atomic installation, scoped requests, gzip handling and cache-first assets.

## Automated acceptance

- For navigation, index, manifest and changelog, HTTP 429/500/503 with a healthy cached response returns the cached response and retains its contents. Without a cached response, the original error status/body reaches the caller.
- A healthy new network response still wins over an older cached response. An error never overwrites cached changelog data. Existing rejected-network, manual-timeout, scope, install and gzip controls remain.
- Extend the existing installed-game browser scenario: a service-worker-owned navigation receiving 503 opens the cached game; prove the request actually received 503. Then hold the worker's navigation network request and prove the cached start screen and menu remain usable. Use production mode, a first-intersection observer, driver-visible assertions and a hidden-menu observer control. Release and drain held callbacks in cleanup; only the exact already-handled route result during intentional release is expected, and unexpected errors remain failures. Do not sleep to accumulate time.
- Normal scoped units, hooks, types and full CI; one coordinated deployed-worker functional check. Phone timing and native installation remain unverified.

## Scope split and remaining acceptance

The initial repair grew to include a shorter page wait, a renderer lookup optimization and a new end-to-end first-visible `<5000` assertion. That candidate did not consistently meet the bound. Those changes and the exact timing assertion are preserved for [cached startup](./cached-startup.md), rather than presented as accepted performance work here. This focused repair retains the HTTP and hanging-network functional controls but moves the newly introduced timing coverage guarantee to that follow-up.

M5's under-five-second cached boot criterion is unchanged and remains unmet. Passing this repair does not complete offline-1 or establish startup-performance or phone acceptance. Race resume after a page reload is separate app integration and must preserve career context, historical objectives and settlement.

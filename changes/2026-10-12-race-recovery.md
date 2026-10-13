---
kind: new
audience: player
---

Career and Quick Play races save progress periodically and on pause or hide when device storage is available. Reopening offers the original race and restores it paused, with its original bike, road, rules and options. Unknown or incompatible saves stay on the device until explicitly discarded.

A completed career result whose profile write fails offers a retry or abandonment. Retries use the original starting profile and frozen result, and the attempt is removed only after the profile save succeeds. Quitting abandons recovery and follows the ordinary quit policy. Countdown, attract and measurement activity do not save ordinary race progress.

Coverage includes storage ownership and malformed-input controls, historical objectives and asks, frozen reward retries, reconstruction hashes, and browser reload/recovery paths. Device quota, phone reopening and concurrent-tab settlement remain unverified.

The existing Quick Play settings-reload checks explicitly discard a recovery offer before reopening options. Dedicated recovery checks exercise Resume instead of assuming that reload always opens the menu directly.

The stale boot-road integration check lets independent storage classification finish before observing the held road request. Its fixture has no storage, so it now verifies that boot notice separately and retains the unconditional zero-UI-write assertion after the retired road load completes. The existing non-retired road-load positive remains in place.

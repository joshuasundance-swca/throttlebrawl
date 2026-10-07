---
kind: dev
audience: dev
---

Browser test runners now have a preparation helper that replaces the stalled Ubuntu Azure HTTP mirror with the Ubuntu archive over HTTPS. It handles both Ubuntu source formats, leaves other source URIs (including security.ubuntu.com) and package signature settings unchanged, and limits APT transport waits to 30 seconds with two retries. These are transport limits, not a total installation deadline. Playwright still installs its full Chromium dependencies, in the suite and the production boot path.

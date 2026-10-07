---
kind: dev
audience: dev
---

Browser test runners now have a preparation helper that replaces the stalled Ubuntu Azure HTTP mirror with the Ubuntu archive over HTTPS. It handles both Ubuntu source formats, preserves security sources and package signature settings, and limits APT transport waits to 30 seconds with two retries. Playwright still installs its full Chromium dependencies.

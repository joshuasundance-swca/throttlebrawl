---
kind: dev
audience: dev
---
The build stamp check (`tests/e2e/ui-style-popups.spec.ts`, "build stamp at ...") waits for the changelog's and the credits' words before it measures them. Both screens fetch their words after they show, and the stamp steps away from them a frame after they land; the check measured in that gap twice: main's run on b29a168 at 360x640 ("Land elevation along" under the stamp) and train 439 at 412x915 (two credit entries' summaries). It now waits for the first changelog day heading and the first credit entry.
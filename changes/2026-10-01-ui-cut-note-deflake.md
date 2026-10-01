---
kind: dev
audience: dev
---
The Cut-note style test (`ui-polish-wo.spec.ts`, #227) no longer flakes on a loaded CI runner. It plants a stand-in radio whose cut always lands. It reads the note in the same page turn as the "Cut it" click, and times the 1.5 s re-check from the click on the page's own clock. `ui-radio-panel.spec.ts` still covers the real radio's cut path.

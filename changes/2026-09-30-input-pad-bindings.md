---
kind: dev
audience: dev
---
The input module reads the settings record's gamepad remaps: `setOptions({ padBindings })` takes the saved `gamepadBindings` (action id to tokens such as `button3`, or `axis2` for steering) and rebinds a live pad. Unknown actions and tokens are ignored, and an action with no valid token keeps its default, so a damaged record never leaves a control unbound.

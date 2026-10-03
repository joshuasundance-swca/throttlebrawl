---
kind: dev
audience: dev
---
The style pop-up layout tests now measure on a frozen frame. In the first drawn frame that shows the pop-ups, the test pauses each chip's animation a quarter of the way through its dwell (slid in, fully shown) and finishes the stack's move below the bark bubble, then measures. Before, it waited a few drawn frames, and on a software renderer at about half a second a frame the chips could start fading, or be removed by their 1.1 s timer, before they were measured (4 failures on 2026-10-02, on the laptop case). The checks themselves are unchanged. The "repeats merge into one chip" check also lost its fixed 150 ms wait: the second near miss is now fed in the frame that first shows the first chip.

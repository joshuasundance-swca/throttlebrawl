// Reduce motion for the interface (M5's a11y-1; docs/product-spec.md, "Accessibility"): the Reduce
// motion setting, or the phone's own preference, turns the HUD's animations and fades off. ui/ sets
// `data-motion="reduced"` on its root (index.ts `setReduceMotion`). The loading ring keeps turning,
// slower, because it is the only sign the game is working. The camera and the picture have their own
// reduce-motion rules (camera/chase.ts, render/calm.ts). [default]
export const REDUCE_MOTION_CSS = `
#ui[data-motion='reduced'] *, #ui[data-motion='reduced'] *::before, #ui[data-motion='reduced'] *::after {
  animation: none !important; transition: none !important; }
#ui[data-motion='reduced'] #busy::before { animation: tb-spin 1.6s linear infinite !important; }
`;

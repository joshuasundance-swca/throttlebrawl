// Camera views for render.py, shared by every catalog file (../catalog.mjs re-exports them). They
// live apart from catalog.mjs so the per-region files can import them without an import cycle.

/** One prop: a three-quarter front, a side and a three-quarter rear. */
export const VIEWS = ['front34', 'side', 'rear34'];
/** A kit of variants in a row along X: the front views show every variant. */
export const VARIANT_VIEWS = ['front34', 'front', 'rear34'];

// Route branches (W-Q contracts; interview, 2026-10-02: "junction choices in races", "Branching
// roads", and marked dirt shortcuts as extra routes: sandbars, fire roads, clear-cuts). Shared by
// road/ (the route queries), content/ (the route schema) and the career (found shortcuts and
// secrets), so the list is written once. A contract: a new kind is a small contract PR.

/**
 * What a branch off a route's main path is [default]:
 * - `shortcut`: shorter to the finish (often a marked dirt shortcut);
 * - `detour`: longer, for something on it (a jump, a weapon, fewer cops);
 * - `alternate`: another way of about the same length (the highway or the harbour road).
 */
export const ROUTE_BRANCH_KINDS = ['shortcut', 'detour', 'alternate'] as const;
export type RouteBranchKind = (typeof ROUTE_BRANCH_KINDS)[number];

/** Within this many metres of the main path's distance, a derived branch counts as an `alternate`. */
export const ROUTE_BRANCH_ALTERNATE_M = 15;

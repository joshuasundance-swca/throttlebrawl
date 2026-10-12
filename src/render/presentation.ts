/** Internal renderer ownership: capture before an async edge, test before live mutation. */
export interface PresentationScope {
  capture(): () => boolean;
}
export const UNOWNED_PRESENTATION: PresentationScope = { capture: () => () => true };

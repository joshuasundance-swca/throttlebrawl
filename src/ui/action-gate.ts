// UI looks up the APP gate through its owning root; each event owns one complete delivery.
export type UiAction = 'ordinary' | 'manual-pause' | 'back' | 'quit' | 'raw';
export interface UiActionOwner {
  actionGate(action: UiAction, deliver: () => void): void;
  captureNormal(): () => boolean;
}
const owners = new WeakMap<EventTarget, UiActionOwner>();
const deferred = new WeakMap<EventTarget, (() => void)[]>();
export function registerUiActions(root: EventTarget, owner: UiActionOwner): void {
  owners.set(root, owner);
}
function ownerOf(target: EventTarget | null): UiActionOwner | undefined {
  const root = rootOf(target);
  return root ? owners.get(root) : undefined;
}
function rootOf(target: EventTarget | null): EventTarget | undefined {
  let node = target;
  while (node) {
    const owner = owners.get(node);
    if (owner) return node;
    node = typeof Element !== 'undefined' && node instanceof Element ? node.parentElement : null;
  }
  return undefined;
}
export function gateUiEvent<E extends Event>(
  listener: (event: E) => unknown,
  root?: EventTarget,
  action: UiAction = 'ordinary',
): (event: E) => void {
  return (event) => {
    const actionRoot = rootOf(root ?? event.currentTarget);
    let delivered = false;
    const deliver = () => {
      if (delivered) return;
      delivered = true;
      const pending = actionRoot ? deferred.get(actionRoot) : undefined;
      if (pending && actionRoot) {
        deferred.delete(actionRoot);
        for (const install of pending) install();
      }
      listener(event);
    };
    const owner = ownerOf(root ?? event.currentTarget);
    const id =
      typeof Element !== 'undefined' && event.currentTarget instanceof Element ? event.currentTarget.id : '';
    const mapped = id === 'hud-pause' ? 'manual-pause' : id === 'pause-quit' ? 'quit' : action;
    if (owner) owner.actionGate(mapped, deliver);
    else deliver();
  };
}
export function captureUiCurrent(root: EventTarget): () => boolean {
  return ownerOf(root)?.captureNormal() ?? (() => true);
}
export function gateUiAction(root: EventTarget, deliver: () => void, action: UiAction = 'ordinary'): void {
  const owner = ownerOf(root);
  if (owner) owner.actionGate(action, deliver);
  else deliver();
}
export function guardUiCompletion<T>(root: EventTarget, listener: (value: T) => unknown): (value: T) => void {
  const current = captureUiCurrent(root);
  return (value) => {
    if (current()) listener(value);
  };
}
/** Lazy module installation may wait for the next ordinary action; user completions never replay. */
export function installUiWhenCurrent<T>(root: EventTarget, listener: (value: T) => void): (value: T) => void {
  return (value) => {
    const install = () => listener(value);
    if (captureUiCurrent(root)()) install();
    else {
      const pending = deferred.get(root) ?? [];
      pending.push(install);
      deferred.set(root, pending);
    }
  };
}

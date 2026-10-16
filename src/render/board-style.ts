// Pack style lookup stays synchronous without importing the lazy board meshes or Three.js.
export const SIGN_STYLES = ['default', 'mile-marker', 'historic', 'guide', 'blade', 'town'] as const;
export type SignStyle = (typeof SIGN_STYLES)[number];

/** The sign style a pack named, or null when it names none this build knows. */
export function signStyleOf(name: unknown): SignStyle | null {
  return (SIGN_STYLES as readonly unknown[]).includes(name) ? (name as SignStyle) : null;
}

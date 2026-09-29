// Ids (docs/content-packs.md, "IDs and references"; docs/architecture.md, "Content registry").

/** A sim entity id: a small non-negative integer, iterated in ascending order. */
export type EntityId = number;

/** A content id qualified by its pack: `base:rustbucket-400`. */
export type QualifiedId = string;

/** Qualifies a bare id with its pack; an id that already names a pack is returned as is. */
export function qualify(packId: string, id: string): QualifiedId {
  return id.includes(':') ? id : `${packId}:${id}`;
}

/** The local part of a qualified id. */
export function localId(id: QualifiedId): string {
  const i = id.indexOf(':');
  return i < 0 ? id : id.slice(i + 1);
}

/** A content reference for a vetoable item: `<packId>:<type>/<entryId>#<itemId>`. */
export function contentRef(packId: string, type: string, entryId: string, itemId: string): string {
  return `${packId}:${type}/${entryId}#${itemId}`;
}

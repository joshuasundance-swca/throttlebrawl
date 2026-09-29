// Shared pieces of every entry (docs/content-packs.md, "Conventions shared by every entry").
// The schema folder is a contract: changes land in a small contract PR. Objects are loose, so a
// field a later milestone adds never breaks an older loader; content-1 tightens what must be.
import { z } from 'zod';

/** Lowercase kebab-case, as every id and filename must be. */
export const idSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase kebab-case');

/** A bare id (same pack) or a qualified one (`base:lead-pipe`). */
export const refSchema = z
  .string()
  .regex(/^(?:[a-z0-9-]+:)?[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be an id or pack:id');

export const statusSchema = z.enum(['live', 'vetoed', 'draft']);

export const provenanceSchema = z.looseObject({
  origin: z.enum(['human', 'agent', 'ai-batch', 'gis-pipeline']),
  author: z.string().optional(),
  createdAt: z.string().optional(),
});

export const metaSchema = z.looseObject({
  status: statusSchema.optional(),
  notes: z.string().optional(),
  provenance: provenanceSchema.optional(),
});

/** The envelope every entry shares: type, id, optional name, tags and meta. */
export function entry<T extends string, S extends z.ZodRawShape>(type: T, shape: S) {
  return z.looseObject({
    type: z.literal(type),
    id: idSchema,
    name: z.string().optional(),
    tags: z.array(z.string()).optional(),
    meta: metaSchema.optional(),
    ...shape,
  });
}

export const nonNegative = z.number().min(0);
export const unit01 = z.number().min(0).max(1);

import { z } from 'zod';
const RemId = z.string().min(1).max(256).regex(/\S/, 'Rem IDs must not be whitespace-only');
const RemIds = z.array(RemId).max(1000);
export const InspectManySchema = z
  .object({
    schemaVersion: z.literal(1),
    remIds: RemIds.max(100).optional(),
    subtreeRootIds: RemIds.max(10).optional(),
    tagRemIds: RemIds.max(10).optional(),
    maxRems: z.number().int().min(1).max(1000).default(1000),
    ancestorDepth: z.number().int().min(0).max(20).default(20),
  })
  .strict()
  .refine(
    (v) =>
      (v.remIds?.length ?? 0) + (v.subtreeRootIds?.length ?? 0) + (v.tagRemIds?.length ?? 0) > 0,
    { message: 'At least one Rem ID selector is required' }
  );
const target = { remId: RemId };
export const ScopeExpectationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('parent'), ...target, value: RemId }).strict(),
  z
    .object({
      kind: z.literal('remType'),
      ...target,
      value: z.enum([
        'folder',
        'document',
        'dailyDocument',
        'concept',
        'descriptor',
        'portal',
        'text',
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal('tag'),
      ...target,
      value: RemId,
      present: z.boolean().default(true),
      inverse: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      kind: z.literal('powerup'),
      ...target,
      code: z.enum(['cc', 'u']),
      value: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('references'),
      ...target,
      value: RemIds,
      exact: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      kind: z.literal('children'),
      ...target,
      value: RemIds,
      exact: z.boolean().default(true),
    })
    .strict(),
  z.object({ kind: z.literal('ancestor'), ...target, value: RemId }).strict(),
  z.object({ kind: z.literal('cardRemIds'), ...target, value: RemIds }).strict(),
  z
    .object({ kind: z.literal('zeroCards'), ...target, noCardStructure: z.boolean().default(true) })
    .strict(),
]);
export const VerifyScopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    inspect: InspectManySchema,
    expectations: z.array(ScopeExpectationSchema).min(1).max(200),
  })
  .strict();

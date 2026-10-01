import { z } from 'zod';
const RemId = z.string().min(1).max(256).regex(/\S/);
const Key = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Title = z.string().min(1).max(1000).regex(/\S/);
const PlainSegment = z.union([z.string().max(10000), z.object({ remId: RemId }).strict()]);
const WikiSegment = z.union([PlainSegment, z.object({ pageKey: Key }).strict()]);
const PlainText = z.array(PlainSegment).min(1).max(100);
const WikiText = z.array(WikiSegment).min(1).max(100);
const patch = { key: Key, cardRemId: RemId, remId: RemId, expectedTextHash: Hash };
const PlainPatch = z.object({ ...patch, text: PlainText }).strict();
const WikiPatch = z.object({ ...patch, text: WikiText }).strict();
function size(plan: unknown, ctx: z.RefinementCtx): void {
  if (Buffer.byteLength(JSON.stringify(plan), 'utf8') > 100 * 1024)
    ctx.addIssue({ code: 'custom', message: 'JSON plan exceeds 100 KiB limit' });
}
function keys(entries: Array<{ key: string }>, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.key))
      ctx.addIssue({ code: 'custom', message: `Duplicate plan key: ${entry.key}` });
    seen.add(entry.key);
  }
}
export const FlashcardsPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    dailyRemId: RemId,
    homeRootId: RemId,
    tagRemId: RemId,
    title: Title.optional(),
    newCards: z
      .array(
        z.object({ key: Key, question: Title, answer: z.array(PlainText).min(1).max(100) }).strict()
      )
      .max(7)
      .optional(),
    answerPatches: z.array(PlainPatch).max(100).optional(),
    reusedCardRemIds: z.array(RemId).max(100).optional(),
  })
  .strict()
  .superRefine((plan, ctx) => {
    size(plan, ctx);
    keys([...(plan.newCards ?? []), ...(plan.answerPatches ?? [])], ctx);
    const count =
      (plan.newCards ?? []).reduce((n, c) => n + 1 + c.answer.length, 0) +
      ((plan.newCards?.length ?? 0) > 1 ? 1 : 0) +
      2 +
      (plan.reusedCardRemIds?.length ?? 0) +
      2 * (plan.answerPatches?.length ?? 0);
    if (count > 1000)
      ctx.addIssue({ code: 'custom', message: 'Flashcard receipt ID budget exceeds 1000 entries' });
    if (!(plan.newCards?.length || plan.answerPatches?.length || plan.reusedCardRemIds?.length))
      ctx.addIssue({
        code: 'custom',
        message: 'At least one new card, answer patch, or reused card is required',
      });
    if ((plan.newCards?.length ?? 0) >= 2 && !plan.title)
      ctx.addIssue({
        code: 'custom',
        path: ['title'],
        message: 'A cluster title is required for two or more new cards',
      });
  });
const WikiNode = z
  .object({ key: Key, remId: RemId.optional(), text: WikiText, expectedTextHash: Hash.optional() })
  .strict()
  .superRefine((node, ctx) => {
    if (node.remId && !node.expectedTextHash)
      ctx.addIssue({ code: 'custom', message: 'Existing nodes require expectedTextHash' });
    if (!node.remId && node.expectedTextHash)
      ctx.addIssue({ code: 'custom', message: 'New nodes must not include expectedTextHash' });
  });
export const WikiPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    wikiRootId: RemId,
    partitionRemId: RemId,
    indexRemId: RemId,
    logRemId: RemId,
    pages: z
      .array(
        z
          .object({
            key: Key,
            remId: RemId.optional(),
            title: Title,
            aliases: z.array(z.string().min(1).max(200).regex(/\S/)).max(20).optional(),
            nodes: z.array(WikiNode).max(100),
            summary: WikiText,
          })
          .strict()
      )
      .max(10),
    answerPatches: z.array(WikiPatch).max(100).optional(),
  })
  .strict()
  .superRefine((plan, ctx) => {
    size(plan, ctx);
    keys(
      [...plan.pages, ...plan.pages.flatMap((p) => p.nodes), ...(plan.answerPatches ?? [])],
      ctx
    );
    if (!plan.pages.length && !plan.answerPatches?.length)
      ctx.addIssue({ code: 'custom', message: 'At least one page or answer patch is required' });
    if (
      2 * plan.pages.length +
        plan.pages.reduce((n, p) => n + p.nodes.length, 0) +
        1 +
        2 * (plan.answerPatches?.length ?? 0) >
      1000
    )
      ctx.addIssue({ code: 'custom', message: 'WIKI receipt ID budget exceeds 1000 entries' });
    const pageKeys = new Set(plan.pages.map((p) => p.key));
    for (const text of [
      ...plan.pages.flatMap((p) => [p.summary, ...p.nodes.map((n) => n.text)]),
      ...(plan.answerPatches ?? []).map((p) => p.text),
    ])
      for (const segment of text)
        if (typeof segment === 'object' && 'pageKey' in segment && !pageKeys.has(segment.pageKey))
          ctx.addIssue({ code: 'custom', message: `Unknown pageKey: ${segment.pageKey}` });
  });
const envelope = {
  schemaVersion: z.literal(1),
  dryRun: z.boolean().default(true),
  idempotencyKey: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._-]+$/),
};
export const FlashcardsApplySchema = z.object({ ...envelope, plan: FlashcardsPlanSchema }).strict();
export const WikiApplySchema = z.object({ ...envelope, plan: WikiPlanSchema }).strict();

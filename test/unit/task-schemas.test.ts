import { describe, it, expect } from 'vitest';
import {
  FlashcardsApplySchema,
  FlashcardsPlanSchema,
  WikiApplySchema,
  WikiPlanSchema,
} from '../../src/schemas/task-schemas.js';
const hash = 'a'.repeat(64);
const card = { key: 'c', question: 'Question?', answer: [['Answer', { remId: 'source' }]] };
const flash = {
  schemaVersion: 1,
  dailyRemId: 'day',
  homeRootId: 'home',
  tagRemId: 'tag',
  newCards: [card],
};
const patch = {
  key: 'patch',
  cardRemId: 'card',
  remId: 'answer',
  expectedTextHash: hash,
  text: ['New'],
};
const page = {
  key: 'p',
  title: 'Page',
  nodes: [{ key: 'n', text: [{ pageKey: 'p' }] }],
  summary: ['Summary'],
};
const wiki = {
  schemaVersion: 1,
  wikiRootId: 'wiki',
  partitionRemId: 'part',
  indexRemId: 'index',
  logRemId: 'log',
  pages: [page],
};
describe('task plan contract', () => {
  it('defaults to preview and permits only reviewed envelope fields', () => {
    expect(
      FlashcardsApplySchema.parse({ schemaVersion: 1, plan: flash, idempotencyKey: 'batch' }).dryRun
    ).toBe(true);
    expect(
      WikiApplySchema.parse({
        schemaVersion: 1,
        plan: wiki,
        idempotencyKey: 'batch',
        dryRun: false,
      }).dryRun
    ).toBe(false);
    expect(
      WikiApplySchema.safeParse({
        schemaVersion: 1,
        plan: wiki,
        idempotencyKey: 'batch',
        deleteAll: true,
      }).success
    ).toBe(false);
  });
  it.each([
    { newCards: [] },
    { newCards: [card, { ...card, key: 'c2' }] },
    { newCards: Array(8).fill(card) },
    { newCards: [{ ...card, question: ' ' }] },
    { newCards: [{ ...card, answer: [] }] },
    { newCards: [{ ...card, answer: [[]] }] },
    { newCards: [{ ...card, answer: [[{ pageKey: 'p' }]] }] },
    { newCards: [{ ...card, answer: [[{ remId: 'r', extra: true }]] }] },
    { newCards: [{ ...card, answer: [['x'.repeat(10001)]] }] },
    { dailyRemId: ' ' },
    { tagRemId: 'x'.repeat(257) },
    { answerPatches: [{ ...patch, key: 'c' }] },
    { answerPatches: [{ ...patch, expectedTextHash: 'A'.repeat(64) }] },
    { reusedCardRemIds: Array(101).fill('r') },
    { answerPatches: Array(101).fill(patch) },
    { today: true },
  ])('rejects unsafe flashcard input %#', (v) =>
    expect(FlashcardsPlanSchema.safeParse({ ...flash, ...v }).success).toBe(false)
  );
  it.each([
    { pages: [] },
    { pages: Array(11).fill(page) },
    { pages: [{ ...page, aliases: Array(21).fill('alias') }] },
    { pages: [{ ...page, aliases: [' '] }] },
    { pages: [{ ...page, aliases: ['x'.repeat(201)] }] },
    { pages: [{ ...page, nodes: [{ key: 'n', remId: 'r', text: ['x'] }] }] },
    { pages: [{ ...page, nodes: [{ key: 'n', text: ['x'], expectedTextHash: hash }] }] },
    { pages: [{ ...page, summary: [{ pageKey: 'missing' }] }] },
    { pages: [{ ...page, nodes: [{ key: 'p', text: ['x'] }] }] },
    { answerPatches: [{ ...patch, key: 'n' }] },
    { answerPatches: [{ ...patch, text: [{ pageKey: 'missing' }] }] },
    { pages: [{ ...page, summary: [] }] },
    { pages: [{ ...page, summary: [{ pageKey: 'p', remId: 'r' }] }] },
    { pages: [{ ...page, nodes: Array(101).fill({ key: 'n', text: ['x'] }) }] },
  ])('rejects unsafe Wiki input %#', (v) =>
    expect(WikiPlanSchema.safeParse({ ...wiki, ...v }).success).toBe(false)
  );
  it('accepts omitted or false cardCluster and opts in only when true', () => {
    const omitted = FlashcardsPlanSchema.parse(flash);
    expect(omitted.cardCluster).toBeUndefined();
    expect(JSON.parse(JSON.stringify(omitted))).not.toHaveProperty('cardCluster');
    expect(FlashcardsPlanSchema.parse({ ...flash, cardCluster: false })).toMatchObject({
      cardCluster: false,
    });
    const optedIn = {
      ...flash,
      title: 'Topic',
      cardCluster: true as const,
      newCards: [card, { ...card, key: 'c2' }],
    };
    expect(FlashcardsPlanSchema.parse(optedIn).cardCluster).toBe(true);
    const envelope = FlashcardsApplySchema.parse({
      schemaVersion: 1,
      plan: flash,
      idempotencyKey: 'batch',
    });
    expect(envelope.plan.cardCluster).toBeUndefined();
    expect(JSON.parse(JSON.stringify(envelope.plan))).not.toHaveProperty('cardCluster');
    expect(
      FlashcardsApplySchema.parse({
        schemaVersion: 1,
        plan: optedIn,
        idempotencyKey: 'batch',
      }).plan.cardCluster
    ).toBe(true);
    for (const plan of [
      { ...flash, cardCluster: true },
      { ...optedIn, title: undefined },
      { ...flash, cardCluster: 'yes' },
      { ...flash, cardCluster: 1 },
    ])
      expect(FlashcardsPlanSchema.safeParse(plan).success).toBe(false);
  });
  it('supports guarded patches/reuse and exact existing nodes', () => {
    expect(
      FlashcardsPlanSchema.safeParse({ ...flash, newCards: [], answerPatches: [patch] }).success
    ).toBe(true);
    expect(
      FlashcardsPlanSchema.safeParse({ ...flash, newCards: [], reusedCardRemIds: ['r'] }).success
    ).toBe(true);
    expect(WikiPlanSchema.safeParse({ ...wiki, pages: [], answerPatches: [patch] }).success).toBe(
      true
    );
    expect(
      WikiPlanSchema.safeParse({
        ...wiki,
        pages: [
          {
            ...page,
            remId: 'p',
            nodes: [{ key: 'n', remId: 'n', text: [''], expectedTextHash: hash }],
          },
        ],
      }).success
    ).toBe(true);
  });
  it('enforces UTF8 size and idempotency bounds', () => {
    expect(
      FlashcardsPlanSchema.safeParse({
        ...flash,
        newCards: [{ ...card, answer: [Array(10).fill('é'.repeat(6000))] }],
      }).success
    ).toBe(false);
    for (const k of ['', 'bad key', 'x'.repeat(129)])
      expect(
        FlashcardsApplySchema.safeParse({ schemaVersion: 1, plan: flash, idempotencyKey: k })
          .success
      ).toBe(false);
  });
  it('bounds complete flashcard receipt including reused and patched targets', () => {
    const newCards = Array.from({ length: 7 }, (_, i) => ({
      ...card,
      key: `c${i}`,
      answer: Array.from({ length: 100 }, () => ['x']),
    }));
    const patches = Array.from({ length: 100 }, (_, i) => ({ ...patch, key: `patch${i}` }));
    const p = {
      ...flash,
      title: 'Cluster',
      newCards,
      reusedCardRemIds: Array(100).fill('r'),
      answerPatches: patches,
    };
    expect(FlashcardsPlanSchema.safeParse(p).success).toBe(false);
    expect(
      FlashcardsPlanSchema.safeParse({ ...p, answerPatches: patches.slice(0, 95) }).success
    ).toBe(true);
  });
  it('bounds complete Wiki receipt including patch pairs at1000/1001', () => {
    const pages = Array.from({ length: 10 }, (_, i) => ({
      ...page,
      key: `p${i}`,
      nodes: Array.from({ length: 78 }, (_, j) => ({ key: `n${i}-${j}`, text: ['x'] })),
    }));
    const answerPatches = Array.from({ length: 100 }, (_, i) => ({ ...patch, key: `patch${i}` }));
    expect(WikiPlanSchema.safeParse({ ...wiki, pages, answerPatches }).success).toBe(false);
    pages[0].nodes.pop();
    expect(WikiPlanSchema.safeParse({ ...wiki, pages, answerPatches }).success).toBe(true);
  });
});

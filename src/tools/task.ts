import { z } from 'zod';
import { FlashcardsApplySchema, WikiApplySchema } from '../schemas/task-schemas.js';
type InputSchema = { type: 'object'; properties?: Record<string, unknown>; [key: string]: unknown };
const id = { type: 'string' };
const ids = { type: 'array', items: id };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const entries = {
  type: 'array',
  items: {
    type: 'object',
    properties: { key: id, remId: id },
    required: ['key', 'remId'],
    additionalProperties: false,
  },
};
const outputSchema = {
  type: 'object' as const,
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    kind: { type: 'string', enum: ['flashcards', 'wiki'] },
    batchKey: id,
    planHash: hash,
    ids: { type: 'object', maxProperties: 1000, additionalProperties: id },
    facts: {
      type: 'array',
      maxItems: 1000,
      items: {
        type: 'object',
        properties: { remId: id, textHash: hash, cardIds: ids, reviewHash: hash },
        required: ['remId', 'textHash', 'cardIds', 'reviewHash'],
        additionalProperties: false,
      },
    },
    status: {
      type: 'string',
      enum: ['preview', 'verified', 'partial', 'unknown', 'incomplete', 'conflict'],
    },
    complete: { type: 'boolean' },
    created: entries,
    updated: entries,
    reused: entries,
    skipped: entries,
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: id,
          state: {
            type: 'string',
            enum: ['started', 'applied', 'verified', 'unknown', 'conflict', 'failed', 'incomplete'],
          },
          remIds: ids,
          error: id,
        },
        required: ['key', 'state', 'remIds'],
        additionalProperties: false,
      },
    },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: id,
          remId: id,
          status: { type: 'string', enum: ['passed', 'failed', 'incomplete'] },
          expected: {},
          actual: {},
          message: id,
        },
        required: ['kind', 'remId', 'status'],
        additionalProperties: false,
      },
    },
    readWindow: {
      type: 'object',
      properties: { startedAt: id, finishedAt: id },
      required: ['startedAt', 'finishedAt'],
      additionalProperties: false,
    },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        properties: { remId: id, code: id, message: id },
        required: ['code', 'message'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'schemaVersion',
    'kind',
    'batchKey',
    'planHash',
    'ids',
    'facts',
    'status',
    'complete',
    'created',
    'updated',
    'reused',
    'skipped',
    'steps',
    'checks',
    'readWindow',
    'errors',
  ],
  additionalProperties: false,
};
export const FLASHCARDS_APPLY_TOOL = {
  name: 'remnote_flashcards_apply',
  description:
    'Preview (dryRun=true by default) or apply a bounded exact-ID flashcard plan with structured answer segments, hash-guarded answer patches, and metadata-only idempotency receipts. Requires at least one new/patch/reused card; two or more new cards require a cluster title. Applies only to the explicit existing dailyRemId after native dailyDocument type validation. No date lookup or daily-document creation. No date scalar is supplied: ID/type cannot prove calendar freshness. The caller resolves/revalidates the intended date before a new batch and after midnight; replay keeps the original recorded diary. Every SDK mutation rechecks the live write gate immediately before its call, after awaited reads. No delete, replace, or move. Verify the receipt; partial/unknown/conflict/incomplete never means success and must not trigger blind replay.',
  inputSchema: {
    ...z.toJSONSchema(FlashcardsApplySchema, { io: 'input', target: 'draft-7' }),
    type: 'object',
  } as InputSchema,
  outputSchema,
};
export const WIKI_APPLY_TOOL = {
  name: 'remnote_wiki_apply',
  description:
    'Preview (dryRun=true by default) or apply a bounded exact-ID WIKI page plan, local pageKey references, and hash-guarded node/answer patches. Existing page titles must match. New nodes forbid hashes; existing nodes require hashes. Known-created Wiki objects must remain ordinary, plain, untagged non-card text before mutation. Every SDK mutation rechecks the live write gate immediately before its call, after awaited reads. Existing grouped-index entries are found through the full bounded tree and retain their parent; a missing/new grouped entry fails before writes and requires an explicit section-targeted fallback. No date lookup or daily-document creation. Metadata-only idempotency receipts; no delete, replace, move, or transactional rollback guarantee. Verify the receipt; never blindly replay partial or unknown writes.',
  inputSchema: {
    ...z.toJSONSchema(WikiApplySchema, { io: 'input', target: 'draft-7' }),
    type: 'object',
  } as InputSchema,
  outputSchema,
};

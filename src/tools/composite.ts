import { z } from 'zod';
import { InspectManySchema, VerifyScopeSchema } from '../schemas/composite-schemas.js';
type InputSchema = { type: 'object'; properties?: Record<string, unknown>; [key: string]: unknown };
const inspectInput: InputSchema = {
  ...z.toJSONSchema(InspectManySchema, { io: 'input', target: 'draft-7' }),
  type: 'object',
};
const verifyInput: InputSchema = {
  ...z.toJSONSchema(VerifyScopeSchema, { io: 'input', target: 'draft-7' }),
  type: 'object',
};
verifyInput.properties = { ...verifyInput.properties, inspect: inspectInput };
const id = { type: 'string' };
const ids = { type: 'array', items: id };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const receiptProperties = {
  schemaVersion: { type: 'integer', const: 1 },
  requestId: id,
  readWindow: {
    type: 'object',
    properties: { startedAt: id, finishedAt: id },
    required: ['startedAt', 'finishedAt'],
    additionalProperties: false,
  },
  complete: { type: 'boolean' },
  truncation: {
    anyOf: [
      { type: 'null' },
      {
        type: 'object',
        properties: { reason: id, remainingRemIds: ids },
        required: ['reason', 'remainingRemIds'],
        additionalProperties: false,
      },
    ],
  },
  objects: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        remId: id,
        contentIncluded: { type: 'boolean' },
        textHash: hash,
        title: id,
        text: {},
        backText: {},
        parentRemId: id,
        childrenRemIds: ids,
        ancestorRemIds: ids,
        remType: id,
        isFolder: { type: 'boolean' },
        isDocument: { type: 'boolean' },
        isCardItem: { type: 'boolean' },
        hasCardStructure: { type: 'boolean' },
        aliases: ids,
        tags: ids,
        references: ids,
        powerups: {
          type: 'object',
          properties: { cc: { type: 'boolean' }, u: { type: 'boolean' } },
          required: ['cc', 'u'],
          additionalProperties: false,
        },
        cards: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              cardId: id,
              remId: id,
              type: {
                anyOf: [
                  { type: 'string', enum: ['forward', 'backward'] },
                  {
                    type: 'object',
                    properties: { clozeId: id },
                    required: ['clozeId'],
                    additionalProperties: false,
                  },
                ],
              },
              createdAt: { type: 'number' },
              repetitionHistory: { type: 'array', items: { type: 'object' } },
              lastRepetitionTime: { type: 'number' },
              nextRepetitionTime: { type: 'number' },
              timesWrongInRow: { type: 'number' },
            },
            required: ['cardId', 'remId', 'type', 'createdAt', 'repetitionHistory'],
            additionalProperties: false,
          },
        },
        updatedAt: { type: 'number' },
        taggedRemIds: ids,
      },
      required: [
        'remId',
        'contentIncluded',
        'textHash',
        'childrenRemIds',
        'ancestorRemIds',
        'remType',
        'isFolder',
        'isDocument',
        'isCardItem',
        'hasCardStructure',
        'tags',
        'references',
        'powerups',
        'cards',
      ],
      oneOf: [
        {
          properties: { contentIncluded: { const: true } },
          required: ['title', 'text', 'aliases'],
        },
        {
          properties: { contentIncluded: { const: false } },
          not: {
            anyOf: ['title', 'text', 'backText', 'aliases'].map((field) => ({ required: [field] })),
          },
        },
      ],
      additionalProperties: false,
    },
  },
  scopes: {
    type: 'array',
    items: {
      type: 'object',
      properties: { rootRemId: id, remIds: ids, complete: { type: 'boolean' } },
      required: ['rootRemId', 'remIds', 'complete'],
      additionalProperties: false,
    },
  },
  checks: { type: 'array', maxItems: 0, items: {} },
  errors: {
    type: 'array',
    items: {
      type: 'object',
      properties: { remId: id, code: id, message: id },
      required: ['code', 'message'],
      additionalProperties: false,
    },
  },
};
const status = { type: 'string', enum: ['passed', 'failed', 'incomplete'] };
export const INSPECT_MANY_TOOL = {
  name: 'remnote_inspect_many',
  description:
    'Read selected Rem IDs, bounded explicit subtrees, and tag inverse membership in one deduplicated receipt (at least one nonempty selector is required) with structure, references, powerups, native cards, and raw-text hashes. Raw text/title/backText/aliases are included only for explicit remIds; subtree and tag-only objects are metadata-only. Live observations are not an atomic snapshot; incomplete receipts cannot prove absence. Read-only, no date lookup or content cache.',
  inputSchema: inspectInput,
  outputSchema: {
    type: 'object' as const,
    properties: receiptProperties,
    required: Object.keys(receiptProperties),
    additionalProperties: false,
  },
};
export const VERIFY_SCOPE_TOOL = {
  name: 'remnote_verify_scope',
  description:
    'Read a fresh bounded context and verify explicit parent, type, tag/inverse, powerup, reference, child, ancestor, and scoped card expectations. Scope checks require subtreeRootIds and inverse tag checks require tagRemIds. Missing or incomplete evidence never passes; this tool does not mutate RemNote.',
  inputSchema: verifyInput,
  outputSchema: {
    type: 'object' as const,
    properties: {
      ...receiptProperties,
      status,
      checks: {
        type: 'array',
        items: {
          type: 'object',
          properties: { kind: id, remId: id, status, expected: {}, actual: {}, message: id },
          required: ['kind', 'remId', 'status'],
          additionalProperties: false,
        },
      },
    },
    required: [...Object.keys(receiptProperties), 'status'],
    additionalProperties: false,
  },
};

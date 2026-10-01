import { beforeEach, describe, it, expect, vi } from 'vitest';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import {
  registerAllTools,
  INSPECT_MANY_TOOL,
  VERIFY_SCOPE_TOOL,
  FLASHCARDS_APPLY_TOOL,
  WIKI_APPLY_TOOL,
} from '../../src/tools/index.js';
import { createMockLogger } from '../setup.js';
const receipt = {
  schemaVersion: 1,
  requestId: 'r',
  readWindow: { startedAt: 'start', finishedAt: 'end' },
  complete: true,
  truncation: null,
  objects: [],
  scopes: [],
  checks: [],
  errors: [],
};
const identity = { sdkVersion: '0.0.46', sdkCatalogHash: 'a'.repeat(64) };
let handler: (x: unknown) => Promise<Record<string, unknown>>;
const ws = {
  sendRequest: vi.fn(),
  isConnected: vi.fn(),
  getSdkIdentity: vi.fn(),
  getBridgeVersion: vi.fn(),
  getServerVersion: vi.fn(),
};
beforeEach(() => {
  ws.sendRequest.mockReset().mockResolvedValue(receipt);
  ws.isConnected.mockReturnValue(true);
  ws.getSdkIdentity.mockReturnValue(identity);
  ws.getBridgeVersion.mockReturnValue('0.24.0');
  ws.getServerVersion.mockReturnValue('0.24.0');
  registerAllTools(
    {
      setRequestHandler: (s: unknown, f: typeof handler) => {
        if (s === CallToolRequestSchema) handler = f;
      },
    } as never,
    ws as never,
    createMockLogger()
  );
});
const call = (name: string, args: Record<string, unknown>) =>
  handler({ params: { name, arguments: args } });
describe('composite MCP receipts', () => {
  it.each(['inspect_many', 'verify_scope', 'flashcards_apply', 'wiki_apply'])(
    'dispatches %s once with60s deadline',
    async (action) => {
      const inspect = { schemaVersion: 1, remIds: ['r'] };
      const plan =
        action === 'flashcards_apply'
          ? {
              schemaVersion: 1,
              dailyRemId: 'd',
              homeRootId: 'h',
              tagRemId: 't',
              reusedCardRemIds: ['r'],
            }
          : {
              schemaVersion: 1,
              wikiRootId: 'w',
              partitionRemId: 'p',
              indexRemId: 'i',
              logRemId: 'l',
              pages: [{ key: 'p', title: 'Page', nodes: [], summary: ['Summary'] }],
            };
      const args =
        action === 'inspect_many'
          ? inspect
          : action === 'verify_scope'
            ? {
                schemaVersion: 1,
                inspect,
                expectations: [{ kind: 'parent', remId: 'r', value: 'p' }],
              }
            : { schemaVersion: 1, plan, idempotencyKey: 'batch' };
      expect((await call(`remnote_${action}`, args)).structuredContent).toEqual(receipt);
      expect(ws.sendRequest).toHaveBeenCalledTimes(1);
      expect(ws.sendRequest.mock.calls[0][0]).toBe(action);
      expect(ws.sendRequest.mock.calls[0][2]).toBe(60000);
    }
  );
  it('rejects empty selectors/unknown writes before dispatch', async () => {
    expect((await call('remnote_inspect_many', { schemaVersion: 1 })).isError).toBe(true);
    expect(
      (await call('remnote_inspect_many', { schemaVersion: 1, remIds: ['r'], writes: [] })).isError
    ).toBe(true);
    expect(ws.sendRequest).not.toHaveBeenCalled();
  });
  it('checks content minimization and native receipt schema', () => {
    const validate = new AjvJsonSchemaValidator().getValidator(INSPECT_MANY_TOOL.outputSchema);
    const meta = {
      remId: 'r',
      contentIncluded: false,
      textHash: 'a'.repeat(64),
      childrenRemIds: [],
      ancestorRemIds: [],
      remType: 'text',
      isFolder: false,
      isDocument: false,
      isCardItem: false,
      hasCardStructure: false,
      tags: [],
      references: [],
      powerups: { cc: false, u: false },
      cards: [],
    };
    expect(validate({ ...receipt, objects: [meta] }).valid).toBe(true);
    expect(validate({ ...receipt, objects: [{ ...meta, text: ['leak'] }] }).valid).toBe(false);
    expect(
      validate({
        ...receipt,
        objects: [{ ...meta, contentIncluded: true, title: 'Title', text: ['Title'], aliases: [] }],
      }).valid
    ).toBe(true);
    expect(validate({ ...receipt, objects: [{ ...meta, contentIncluded: true }] }).valid).toBe(
      false
    );
    expect(validate({ ...receipt, objects: [{ ...meta, textHash: 'bad' }] }).valid).toBe(false);
  });
  it('advertises compilable input and task output schemas with bounded metadata facts', () => {
    const validator = new AjvJsonSchemaValidator();
    for (const tool of [
      INSPECT_MANY_TOOL,
      VERIFY_SCOPE_TOOL,
      FLASHCARDS_APPLY_TOOL,
      WIKI_APPLY_TOOL,
    ])
      expect(() => validator.getValidator(tool.inputSchema)).not.toThrow();
    const output = {
      schemaVersion: 1,
      kind: 'wiki',
      batchKey: 'batch',
      planHash: 'a'.repeat(64),
      ids: { 'page:p': 'p' },
      facts: [{ remId: 'p', textHash: 'a'.repeat(64), cardIds: [], reviewHash: 'b'.repeat(64) }],
      status: 'verified',
      complete: true,
      created: [],
      updated: [],
      reused: [],
      skipped: [],
      steps: [],
      checks: [],
      readWindow: { startedAt: 'start', finishedAt: 'end' },
      errors: [],
    };
    const check = validator.getValidator(WIKI_APPLY_TOOL.outputSchema);
    expect(check(output).valid).toBe(true);
    expect(check({ ...output, facts: [{ ...output.facts[0], text: ['leak'] }] }).valid).toBe(false);
    expect(check({ ...output, facts: Array(1001).fill(output.facts[0]) }).valid).toBe(false);
    expect(
      check({
        ...output,
        ids: Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [String(i), 'r'])),
      }).valid
    ).toBe(false);
    expect(check({ ...output, status: 'success' }).valid).toBe(false);
  });
  it('advertises repaired diary and mutation boundaries', () => {
    expect(FLASHCARDS_APPLY_TOOL.description).toContain('ID/type cannot prove calendar freshness');
    expect(FLASHCARDS_APPLY_TOOL.description).toContain('original recorded diary');
    expect(WIKI_APPLY_TOOL.description).toContain('full bounded tree');
    expect(WIKI_APPLY_TOOL.description).toContain('section-targeted fallback');
    for (const t of [FLASHCARDS_APPLY_TOOL, WIKI_APPLY_TOOL])
      expect(t.description).toContain('live write gate immediately before its call');
  });
});
describe('server-local SDK identity', () => {
  it('returns tiny identity without WebSocket catalog request', async () => {
    expect(
      (await call('remnote_get_sdk_capabilities', { identityOnly: true })).structuredContent
    ).toEqual({
      ...identity,
      serverVersion: '0.24.0',
      bridgeVersion: '0.24.0',
      identityOnly: true,
      capabilities: [],
    });
    expect(ws.sendRequest).not.toHaveBeenCalled();
  });
  it('fails closed disconnected/missing identity/catalog mismatch', async () => {
    ws.isConnected.mockReturnValue(false);
    expect((await call('remnote_get_sdk_capabilities', { identityOnly: true })).isError).toBe(true);
    ws.isConnected.mockReturnValue(true);
    ws.getSdkIdentity.mockReturnValue(null);
    expect((await call('remnote_get_sdk_capabilities', {})).isError).toBe(true);
    expect(ws.sendRequest).not.toHaveBeenCalled();
    ws.getSdkIdentity.mockReturnValue(identity);
    ws.sendRequest.mockResolvedValue({
      ...identity,
      sdkCatalogHash: 'b'.repeat(64),
      capabilities: [],
    });
    expect((await call('remnote_get_sdk_capabilities', {})).isError).toBe(true);
  });
  it('forwards expected catalog hash for execution-time guard', async () => {
    await call('remnote_sdk_call', {
      capability: 'rem:getChildrenRem',
      expectedCatalogHash: identity.sdkCatalogHash,
    });
    expect(ws.sendRequest).toHaveBeenCalledWith('sdk_call', {
      capability: 'rem:getChildrenRem',
      expectedCatalogHash: identity.sdkCatalogHash,
      args: [],
      allowDestructive: false,
    });
  });
});

import { afterEach, describe, it, expect, vi } from 'vitest';
import { createProgram } from '../../../src/remnote-cli/cli.js';
import { McpServerClient } from '../../../src/remnote-cli/client/mcp-server-client.js';
import { readContentFileOrStdin } from '../../../src/remnote-cli/commands/content-input.js';
vi.mock('../../../src/remnote-cli/commands/content-input.js', () => ({
  readContentFileOrStdin: vi.fn(),
}));
const inspect = { schemaVersion: 1, remIds: ['r'] };
const receipt = {
  schemaVersion: 1,
  requestId: 'request',
  readWindow: { startedAt: 'start', finishedAt: 'end' },
  complete: true,
  truncation: null,
  objects: [],
  scopes: [],
  checks: [],
  errors: [],
};
const plans = {
  flashcards: {
    schemaVersion: 1,
    dailyRemId: 'day',
    homeRootId: 'home',
    tagRemId: 'tag',
    reusedCardRemIds: ['card'],
  },
  wiki: {
    schemaVersion: 1,
    wikiRootId: 'wiki',
    partitionRemId: 'part',
    indexRemId: 'index',
    logRemId: 'log',
    pages: [{ key: 'p', title: 'Page', nodes: [], summary: ['Summary'] }],
  },
};
const taskReceipt = {
  schemaVersion: 1,
  kind: 'flashcards',
  batchKey: 'batch',
  planHash: 'a'.repeat(64),
  ids: { 'card:c': 'r' },
  facts: [{ remId: 'r', textHash: 'a'.repeat(64), cardIds: ['c'], reviewHash: 'b'.repeat(64) }],
  status: 'preview',
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
afterEach(() => {
  process.exitCode = 0;
});
describe('four composite commands', () => {
  it.each(['-', '/tmp/request.json'])('reads context from %s preserving receipt', async (path) => {
    vi.mocked(readContentFileOrStdin).mockResolvedValue(JSON.stringify(inspect));
    const execute = vi.spyOn(McpServerClient.prototype, 'execute').mockResolvedValue(receipt);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createProgram('test').parseAsync(['context', '--request', path], { from: 'user' });
    expect(readContentFileOrStdin).toHaveBeenCalledWith(path);
    expect(execute).toHaveBeenCalledExactlyOnceWith('inspect_many', {
      ...inspect,
      maxRems: 1000,
      ancestorDepth: 20,
    });
    expect(JSON.parse(log.mock.calls[0][0])).toEqual(receipt);
  });
  it.each(['passed', 'failed', 'incomplete'])(
    'emits complete verify %s receipt and appropriate code',
    async (status) => {
      vi.mocked(readContentFileOrStdin).mockResolvedValue(
        JSON.stringify({
          schemaVersion: 1,
          inspect,
          expectations: [{ kind: 'parent', remId: 'r', value: 'p' }],
        })
      );
      vi.spyOn(McpServerClient.prototype, 'execute').mockResolvedValue({ ...receipt, status });
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      await createProgram('test').parseAsync(['--text', 'verify', 'scope', '--expect', '-'], {
        from: 'user',
      });
      expect(JSON.parse(log.mock.calls[0][0])).toEqual({ ...receipt, status });
      expect(process.exitCode ?? 0).toBe(status === 'passed' ? 0 : 1);
    }
  );
  it.each([{ complete: false }, { errors: [{ code: 'failed', message: 'Read failed' }] }])(
    'context fails closed %#',
    async (v) => {
      vi.mocked(readContentFileOrStdin).mockResolvedValue(JSON.stringify(inspect));
      vi.spyOn(McpServerClient.prototype, 'execute').mockResolvedValue({ ...receipt, ...v });
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await createProgram('test').parseAsync(['context', '--request', '-'], { from: 'user' });
      expect(process.exitCode).toBe(1);
    }
  );
  it.each(['{bad', '[]', '{"schemaVersion":1,"today":true}'])(
    'rejects invalid input before dispatch %#',
    async (input) => {
      vi.mocked(readContentFileOrStdin).mockResolvedValue(input);
      const execute = vi.spyOn(McpServerClient.prototype, 'execute');
      await createProgram('test').parseAsync(['context', '--request', '-'], { from: 'user' });
      expect(execute).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    }
  );
  it.each(['flashcards', 'wiki'] as const)(
    'wraps %s inner plan, defaults preview',
    async (kind) => {
      vi.mocked(readContentFileOrStdin).mockResolvedValue(JSON.stringify(plans[kind]));
      const execute = vi
        .spyOn(McpServerClient.prototype, 'execute')
        .mockResolvedValue({ ...taskReceipt, kind });
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      await createProgram('test').parseAsync(
        [kind, 'apply', '--plan', '-', '--idempotency-key', 'batch'],
        { from: 'user' }
      );
      expect(execute).toHaveBeenCalledExactlyOnceWith(`${kind}_apply`, {
        schemaVersion: 1,
        plan: plans[kind],
        idempotencyKey: 'batch',
        dryRun: true,
      });
      expect(JSON.parse(log.mock.calls[0][0])).toEqual({ ...taskReceipt, kind });
    }
  );
  it.each(['preview', 'verified', 'partial', 'unknown', 'incomplete', 'conflict'])(
    'applied receipt %s only succeeds for verified',
    async (status) => {
      vi.mocked(readContentFileOrStdin).mockResolvedValue(JSON.stringify(plans.flashcards));
      const execute = vi
        .spyOn(McpServerClient.prototype, 'execute')
        .mockResolvedValue({ ...taskReceipt, status });
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      await createProgram('test').parseAsync(
        ['--text', 'flashcards', 'apply', '--plan', '-', '--idempotency-key', 'batch', '--apply'],
        { from: 'user' }
      );
      expect(execute).toHaveBeenCalledWith('flashcards_apply', {
        schemaVersion: 1,
        plan: plans.flashcards,
        idempotencyKey: 'batch',
        dryRun: false,
      });
      expect(JSON.parse(log.mock.calls[0][0])).toEqual({ ...taskReceipt, status });
      expect(process.exitCode ?? 0).toBe(status === 'verified' ? 0 : 1);
    }
  );
  it('never retries failed apply and rejects malformed plans locally', async () => {
    vi.mocked(readContentFileOrStdin).mockResolvedValue('{}');
    const execute = vi
      .spyOn(McpServerClient.prototype, 'execute')
      .mockRejectedValue(new Error('Outcome unknown'));
    await createProgram('test').parseAsync(
      ['wiki', 'apply', '--plan', '-', '--idempotency-key', 'batch', '--apply'],
      { from: 'user' }
    );
    expect(execute).not.toHaveBeenCalled();
    vi.mocked(readContentFileOrStdin).mockResolvedValue(JSON.stringify(plans.wiki));
    await createProgram('test').parseAsync(
      ['wiki', 'apply', '--plan', '-', '--idempotency-key', 'batch', '--apply'],
      { from: 'user' }
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });
  it('leaf helps expose examples, checks, schemas and repaired safety boundaries', () => {
    const p = createProgram('test');
    const out: string[] = [];
    for (const name of ['context', 'verify', 'flashcards', 'wiki']) {
      const c = p.commands.find((c) => c.name() === name)!;
      const leaf = c.commands[0] ?? c;
      leaf.configureOutput({ writeOut: (t) => out.push(t) });
      leaf.outputHelp();
    }
    const text = out.join('');
    for (const phrase of [
      '"schemaVersion":1',
      'parent',
      'ancestor',
      'remType',
      'tag',
      'powerup',
      'references',
      'children',
      'cardRemIds',
      'zeroCards',
      'dailyRemId',
      'answerPatches',
      'expectedTextHash',
      'pageKey',
      'facts',
      'ids',
      'calendar freshness',
      'after midnight',
      'original recorded diary',
      'full bounded tree',
      'section-targeted fallback',
      'live write gate',
      'never narrow away required',
    ])
      expect(text).toContain(phrase);
  });
});

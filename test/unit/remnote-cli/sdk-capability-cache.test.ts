import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { getSdkCapabilities } from '../../../src/remnote-cli/client/sdk-capability-cache.js';
import { McpServerClient } from '../../../src/remnote-cli/client/mcp-server-client.js';
import { createProgram } from '../../../src/remnote-cli/cli.js';
const capability = {
  id: 'rem:getChildrenRem',
  target: 'rem',
  method: 'getChildrenRem',
  group: 'rem',
  command: 'object-get-children-rem',
  signatures: [],
  status: 'supported',
  mode: 'read',
};
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const identity = {
  sdkVersion: '0.0.46',
  sdkCatalogHash: digest({ sdkVersion: '0.0.46', capabilities: [capability] }),
  serverVersion: '0.24.0',
  bridgeVersion: '0.24.0',
};
const catalog = { ...identity, capabilities: [capability] };
const endpoint = 'http://localhost:3001';
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sdk-cache-test-'));
  vi.stubEnv('REMNOTE_CLI_CACHE_DIR', dir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
const clientFor = (c = catalog) => ({
  execute: vi.fn(async (_action: string, payload: Record<string, unknown>) =>
    payload.identityOnly ? { ...c, identityOnly: true, capabilities: [] } : c
  ),
});
describe('live identity catalog integrity cache', () => {
  it('fetches once and uses tiny live identity on warm normalized endpoint', async () => {
    const c = clientFor();
    expect(await getSdkCapabilities(c, endpoint)).toEqual(catalog);
    expect(await getSdkCapabilities(c, endpoint + '/mcp/')).toEqual(catalog);
    expect(c.execute.mock.calls).toEqual([
      ['get_sdk_capabilities', { identityOnly: true }],
      ['get_sdk_capabilities', {}],
      ['get_sdk_capabilities', { identityOnly: true }],
    ]);
    const [name] = await readdir(dir);
    expect(JSON.parse(await readFile(join(dir, name), 'utf8')).catalog).toEqual(catalog);
  });
  it.each(['sdkVersion', 'serverVersion', 'bridgeVersion', 'sdkCatalogHash'] as const)(
    'invalidates exact %s',
    async (key) => {
      await getSdkCapabilities(clientFor(), endpoint);
      const next = { ...catalog, [key]: '0.25.0' };
      if (key === 'sdkCatalogHash') next.capabilities = [{ ...capability, command: 'new-command' }];
      next.sdkCatalogHash = digest({
        sdkVersion: next.sdkVersion,
        capabilities: next.capabilities,
      });
      const c = clientFor(next);
      await getSdkCapabilities(c, endpoint);
      expect(c.execute).toHaveBeenCalledTimes(2);
    }
  );
  it('isolates CLI version and endpoint and never stores query secrets', async () => {
    const c = clientFor();
    await getSdkCapabilities(c, endpoint, '0.24.0');
    await getSdkCapabilities(c, endpoint, '0.24.1');
    await getSdkCapabilities(c, endpoint + '/base?token=private', '0.24.1');
    await getSdkCapabilities(c, endpoint + '/base/mcp?token=private', '0.24.1');
    expect(c.execute).toHaveBeenCalledTimes(7);
    for (const file of await readdir(dir))
      expect(await readFile(join(dir, file), 'utf8')).not.toContain('private');
  });
  it('never uses stale offline/malformed identity', async () => {
    await getSdkCapabilities(clientFor(), endpoint);
    await expect(
      getSdkCapabilities({ execute: vi.fn().mockRejectedValue(new Error('offline')) }, endpoint)
    ).rejects.toThrow('offline');
    await expect(
      getSdkCapabilities({ execute: vi.fn().mockResolvedValue({ sdkVersion: 'x' }) }, endpoint)
    ).rejects.toThrow();
    await expect(
      getSdkCapabilities(
        { execute: vi.fn().mockResolvedValue({ ...catalog, identityOnly: true }) },
        endpoint
      )
    ).rejects.toThrow('identity response');
  });
  it('refetches invalid JSON or schema-valid altered mapping even with rewritten payload digest', async () => {
    await getSdkCapabilities(clientFor(), endpoint);
    const [name] = await readdir(dir);
    const path = join(dir, name);
    await writeFile(path, '{bad');
    const c = clientFor();
    await getSdkCapabilities(c, endpoint);
    const record = JSON.parse(await readFile(path, 'utf8'));
    record.catalog.capabilities[0].id = 'rem:remove';
    record.payloadHash = digest(record.catalog);
    await writeFile(path, JSON.stringify(record));
    expect(await getSdkCapabilities(c, endpoint)).toEqual(catalog);
    expect(c.execute).toHaveBeenCalledTimes(4);
  });
  it('rejects invalid full catalog and discovery identity races', async () => {
    const c = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ ...identity, identityOnly: true, capabilities: [] })
        .mockResolvedValueOnce({ ...catalog, sdkCatalogHash: 'b'.repeat(64) }),
    };
    await expect(getSdkCapabilities(c, endpoint)).rejects.toThrow('content hash');
    const race = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ ...identity, identityOnly: true, capabilities: [] })
        .mockResolvedValueOnce({ ...catalog, bridgeVersion: '0.24.1' }),
    };
    await expect(getSdkCapabilities(race, endpoint)).rejects.toThrow('changed during discovery');
    expect(await readdir(dir)).toEqual([]);
  });
  it('preserves raw generated object key order and tolerates cache write failure', async () => {
    const ordered = {
      mode: 'read',
      status: 'supported',
      signatures: [],
      command: 'x',
      group: 'rem',
      method: 'x',
      target: 'rem',
      id: 'rem:x',
    };
    const c = {
      ...catalog,
      capabilities: [ordered],
      sdkCatalogHash: digest({ sdkVersion: identity.sdkVersion, capabilities: [ordered] }),
    };
    expect(await getSdkCapabilities(clientFor(c), endpoint)).toEqual(c);
    const file = join(dir, 'blocked');
    await writeFile(file, 'file');
    vi.stubEnv('REMNOTE_CLI_CACHE_DIR', file);
    expect(await getSdkCapabilities(clientFor(), endpoint)).toEqual(catalog);
  });
  it('warm SDK calls send the expected hash and never cache live KB content', async () => {
    const execute = vi
      .spyOn(McpServerClient.prototype, 'execute')
      .mockImplementation(async (action, payload) =>
        action === 'sdk_call'
          ? { capability: capability.id, value: 'private KB content' }
          : payload.identityOnly
            ? { ...identity, identityOnly: true, capabilities: [] }
            : catalog
      );
    vi.spyOn(console, 'log').mockImplementation(() => {});
    for (let i = 0; i < 2; i++)
      await createProgram('test').parseAsync(
        ['sdk', 'rem', capability.command, '--target-id', 'r'],
        { from: 'user' }
      );
    expect(
      execute.mock.calls.filter(([a, p]) => a === 'get_sdk_capabilities' && !p.identityOnly)
    ).toHaveLength(1);
    expect(execute.mock.calls.filter(([a]) => a === 'sdk_call')).toEqual(
      Array(2).fill([
        'sdk_call',
        { capability: capability.id, expectedCatalogHash: identity.sdkCatalogHash, targetId: 'r' },
      ])
    );
    for (const file of await readdir(dir))
      expect(await readFile(join(dir, file), 'utf8')).not.toContain('private KB');
  });
});

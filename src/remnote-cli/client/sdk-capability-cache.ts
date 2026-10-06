import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { normalizeMcpUrl, type McpServerClient } from './mcp-server-client.js';
const require = createRequire(import.meta.url);
const packageJson = require('../../../package.json') as { version: string };
const IdentitySchema = z.object({
  sdkVersion: z.string().min(1),
  sdkCatalogHash: z.string().regex(/^[a-f0-9]{64}$/),
  serverVersion: z.string().min(1),
  bridgeVersion: z.string().min(1),
});
const CapabilitySchema = z
  .object({
    id: z.string().min(1),
    target: z.string(),
    namespace: z.string().optional(),
    method: z.string(),
    group: z.string(),
    command: z.string(),
    signatures: z.array(z.string()),
    summary: z.string().optional(),
    status: z.string(),
    mode: z.string(),
    reason: z.string().optional(),
  })
  .strict();
const CatalogSchema = IdentitySchema.extend({
  capabilities: z.array(CapabilitySchema),
  identityOnly: z.boolean().optional(),
}).strict();
const CacheSchema = z
  .object({
    schemaVersion: z.literal(2),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
    key: z.string(),
    catalog: CatalogSchema,
  })
  .strict();
export type Capability = z.infer<typeof CapabilitySchema>;
export type CapabilityResult = z.infer<typeof CatalogSchema>;
function identityKey(value: z.infer<typeof IdentitySchema>): string {
  return JSON.stringify(IdentitySchema.parse(value));
}
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function verifiedCatalog(value: unknown): CapabilityResult {
  CatalogSchema.parse(value);
  // Validate the original property order, not Zod's reordered object, against the generated registry hash.
  const original = value as CapabilityResult;
  if (
    digest({ sdkVersion: original.sdkVersion, capabilities: original.capabilities }) !==
    original.sdkCatalogHash
  )
    throw new Error('SDK catalog content hash mismatch; refusing unverified capabilities');
  return original;
}
/** Persist only public metadata; every use first requires a fresh accepted live bridge identity. */
export async function getSdkCapabilities(
  client: Pick<McpServerClient, 'execute'>,
  endpoint: string,
  cliVersion = packageJson.version
): Promise<CapabilityResult> {
  const live = CatalogSchema.parse(
    await client.execute('get_sdk_capabilities', { identityOnly: true })
  );
  if (live.identityOnly !== true || live.capabilities.length !== 0)
    throw new Error('Live SDK identity response is invalid; refusing cached capabilities');
  // Endpoint credentials/query secrets never appear in persisted keys.
  const key = digest({
    endpoint: normalizeMcpUrl(endpoint),
    cliVersion,
    identity: identityKey(live),
  });
  const directory =
    process.env.REMNOTE_CLI_CACHE_DIR ??
    join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'remnote-cli');
  const path = join(directory, `${key}.json`);
  try {
    const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
    const cached = CacheSchema.parse(raw);
    const original = (raw as { catalog: unknown }).catalog;
    if (
      cached.payloadHash === digest(original) &&
      cached.key === key &&
      cached.catalog.identityOnly !== true &&
      identityKey(cached.catalog) === identityKey(live)
    )
      return verifiedCatalog(original);
  } catch {
    /* Missing, unreadable, or corrupt metadata is a miss, never an offline fallback. */
  }
  const catalog = verifiedCatalog(await client.execute('get_sdk_capabilities', {}));
  if (catalog.identityOnly === true || identityKey(catalog) !== identityKey(live))
    throw new Error('Live SDK catalog changed during discovery; retry with a fresh identity');
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(
      temporary,
      JSON.stringify({ schemaVersion: 2, key, payloadHash: digest(catalog), catalog }),
      { mode: 0o600, flag: 'wx' }
    );
    await rename(temporary, path);
  } catch {
    /* Cache I/O failure does not prevent freshly verified use. */
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return catalog;
}

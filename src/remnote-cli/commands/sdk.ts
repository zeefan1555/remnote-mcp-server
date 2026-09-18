import { Command } from 'commander';
import { createCommandClient } from '../client/command-client.js';
import { EXIT } from '../config.js';
import { formatError, formatResult, type OutputFormat } from '../output/formatter.js';
import { readContentFileOrStdin } from './content-input.js';

type Capability = {
  id: string;
  target: string;
  namespace?: string;
  method: string;
  group: string;
  command: string;
  signatures: string[];
  summary?: string;
  status: string;
  mode: string;
  reason?: string;
};

type CapabilityResult = { sdkVersion: string; capabilities: Capability[] };

const SDK_GROUPS = [
  ['app', 'Application lifecycle and platform operations'],
  ['card', 'Card lookup and Card object operations'],
  ['date', 'Daily document operations'],
  ['editor', 'Current editor and selection operations'],
  ['event', 'Plugin event operations'],
  ['focus', 'Focused Rem and portal operations'],
  ['kb', 'Knowledge base information'],
  ['messaging', 'Plugin message broadcasting'],
  ['powerup', 'Power-up lookup operations'],
  ['queue', 'Active review queue operations'],
  ['reader', 'Reader and PDF operations'],
  ['rem', 'Rem lookup and Rem object operations'],
  ['richText', 'Rich-text conversion and inspection'],
  ['scheduler', 'Custom scheduler operations'],
  ['search', 'Search and Query builder operations'],
  ['settings', 'Plugin setting operations'],
  ['storage', 'Plugin storage operations'],
  ['widget', 'Widget context and popup operations'],
  ['window', 'Pane, page, and floating-window operations'],
] as const;

function cliGroupName(group: string): string {
  return group.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function formatCapability(capability: Capability): string {
  const reason = capability.reason ? ` reason=${capability.reason}` : '';
  return `sdk ${cliGroupName(capability.group)} ${capability.command}: capability=${capability.id} status=${capability.status} mode=${capability.mode}${reason}`;
}

function parseArgsJson(value: string): unknown[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error('SDK args must be a JSON array');
  return parsed;
}

function outputFormat(program: Command): OutputFormat {
  return program.opts().text ? 'text' : 'json';
}

function reportError(error: unknown, format: OutputFormat): never {
  console.error(formatError(error instanceof Error ? error.message : String(error), format));
  process.exit(EXIT.ERROR);
}

function groupHelp(result: CapabilityResult, group: string): string {
  const commandName = cliGroupName(group);
  const capabilities = result.capabilities
    .filter((capability) => capability.group === group)
    .sort((left, right) => left.command.localeCompare(right.command));
  return [
    `sdk ${commandName} - RemNote SDK ${result.sdkVersion}`,
    '',
    `Usage: remnote-cli sdk ${commandName} <command> [options]`,
    '',
    'Commands:',
    ...capabilities.map(
      (capability) =>
        `  ${capability.command.padEnd(42)} ${capability.status}/${capability.mode}${capability.summary ? ` - ${capability.summary}` : ''}`
    ),
    '',
    `Run "remnote-cli sdk ${commandName} <command> --help" for exact SDK signatures and arguments.`,
  ].join('\n');
}

function capabilityHelp(result: CapabilityResult, capability: Capability): string {
  const commandName = cliGroupName(capability.group);
  const example = [
    'remnote-cli',
    'sdk',
    commandName,
    capability.command,
    ...(capability.target === 'rem'
      ? ['--target-id', 'REM_ID']
      : capability.target === 'card'
        ? ['--target-id', 'CARD_ID']
        : []),
    '--args-json',
    "'[]'",
    ...(capability.mode === 'destructive' ? ['--allow-destructive'] : []),
  ].join(' ');

  return [
    `sdk ${commandName} ${capability.command}`,
    '',
    capability.summary ?? 'No SDK description is available.',
    '',
    `Capability: ${capability.id}`,
    `Status: ${capability.status}`,
    `Mode: ${capability.mode}`,
    `Target: ${capability.target}${capability.target === 'rem' || capability.target === 'card' ? ' (requires --target-id)' : ''}`,
    ...(capability.reason ? [`Reason: ${capability.reason}`] : []),
    '',
    'SDK signature:',
    ...capability.signatures.map((signature) => `  ${signature}`),
    '',
    'Arguments:',
    '  --args-json <json-array>  Positional SDK arguments',
    '  --args-file <path|->      Read the JSON array from a file or stdin',
    '  --target-id <id>          Required for RemObject and Card methods',
    '  --allow-destructive       Required for destructive capabilities',
    '',
    `Example: ${example}`,
  ].join('\n');
}

async function readArgs(opts: {
  argsJson?: string;
  argsFile?: string;
}): Promise<unknown[] | undefined> {
  if (opts.argsJson !== undefined && opts.argsFile !== undefined) {
    throw new Error('Cannot use --args-json and --args-file together');
  }
  const source =
    opts.argsFile !== undefined ? await readContentFileOrStdin(opts.argsFile) : opts.argsJson;
  return source === undefined ? undefined : parseArgsJson(source);
}

function registerCapabilityCatalog(sdk: Command, program: Command): void {
  sdk
    .command('capabilities')
    .description('List and search RemNote Plugin SDK commands')
    .option('--group <group>', 'Filter by SDK command group')
    .option('--status <status>', 'Filter by exact status')
    .option('--mode <mode>', 'Filter by exact mode')
    .option('--query <text>', 'Search command names, capability IDs, and descriptions')
    .action(async (opts) => {
      const format = outputFormat(program);
      const client = createCommandClient(program);
      try {
        const result = (await client.execute('get_sdk_capabilities', {})) as CapabilityResult;
        const query = typeof opts.query === 'string' ? opts.query.toLowerCase() : undefined;
        const capabilities = result.capabilities.filter(
          (capability) =>
            (!opts.group || capability.group === opts.group) &&
            (!opts.status || capability.status === opts.status) &&
            (!opts.mode || capability.mode === opts.mode) &&
            (!query ||
              `${capability.command} ${capability.id} ${capability.summary ?? ''}`
                .toLowerCase()
                .includes(query))
        );
        console.log(
          formatResult({ ...result, capabilities }, format, () =>
            [
              `RemNote SDK ${result.sdkVersion}: ${capabilities.length} capabilities`,
              ...capabilities.map(formatCapability),
            ].join('\n')
          )
        );
      } catch (error) {
        reportError(error, format);
      } finally {
        await client.close();
      }
    });
}

function registerCapabilityGroup(
  sdk: Command,
  program: Command,
  group: string,
  description: string
): void {
  const commandName = cliGroupName(group);
  const sdkGroup = sdk
    .command(`${commandName} [method]`)
    .description(description)
    .helpOption(false)
    .option('-h, --help', 'Show this SDK group or method help')
    .option('--target-id <id>', 'Target Rem or Card ID')
    .option('--args-json <json-array>', 'Positional arguments as a JSON array')
    .option('--args-file <path|->', 'Read positional JSON arguments from a file or stdin')
    .option('--allow-destructive', 'Allow a capability marked destructive');

  sdkGroup.action(async (method: string | undefined, opts) => {
    const format = outputFormat(program);
    const client = createCommandClient(program);
    try {
      const result = (await client.execute('get_sdk_capabilities', {})) as CapabilityResult;
      if (!method) {
        console.log(groupHelp(result, group));
        return;
      }

      const capability = result.capabilities.find(
        (candidate) => candidate.group === group && candidate.command === method
      );
      if (!capability) throw new Error(`Unknown SDK command: sdk ${commandName} ${method}`);
      if (opts.help) {
        console.log(capabilityHelp(result, capability));
        return;
      }
      if (capability.status !== 'supported') {
        throw new Error(
          `Unsupported SDK command sdk ${commandName} ${method}: ${capability.reason ?? 'no executable CLI path'}`
        );
      }

      const payload: Record<string, unknown> = { capability: capability.id };
      if (opts.targetId !== undefined) payload.targetId = opts.targetId as string;
      const args = await readArgs(opts as { argsJson?: string; argsFile?: string });
      if (args !== undefined) payload.args = args;
      if (opts.allowDestructive) payload.allowDestructive = true;

      const callResult = await client.execute('sdk_call', payload);
      console.log(formatResult(callResult, format));
    } catch (error) {
      reportError(error, format);
    } finally {
      await client.close();
    }
  });
}

export function registerSdkCommands(program: Command): void {
  const sdk = program.command('sdk').description('Low-level RemNote Plugin SDK access');
  sdk.action(() => sdk.outputHelp());
  registerCapabilityCatalog(sdk, program);
  for (const [group, description] of SDK_GROUPS) {
    registerCapabilityGroup(sdk, program, group, description);
  }
}

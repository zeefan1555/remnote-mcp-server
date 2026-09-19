import { Command } from 'commander';
import { createCommandClient } from '../client/command-client.js';
import { EXIT } from '../config.js';
import { formatError, formatResult, type OutputFormat } from '../output/formatter.js';

function formatOutlineText(data: unknown): string {
  const result = data as Record<string, unknown>;
  const action = result.collapsed === true ? 'collapse' : 'expand';
  const mode = result.dryRun === true ? 'Preview' : 'Applied';
  return `${mode} ${action} for ${String(result.rootTitle)} [${String(result.rootRemId)}]: scanned=${String(result.scanned)}, eligible=${String(result.eligible)}, changed=${String(result.changed)}`;
}

function registerOutlineAction(
  outline: Command,
  program: Command,
  name: 'collapse' | 'expand',
  collapsed: boolean
): void {
  outline
    .command(name)
    .description(
      `${name === 'collapse' ? 'Collapse' : 'Expand'} every non-leaf Rem below a root Rem`
    )
    .option('--today', "Use today's daily document as the root")
    .option('--root-id <remId>', 'Root Rem ID')
    .option('--apply', 'Apply the change; otherwise preview only')
    .action(async (opts) => {
      const format: OutputFormat = program.opts().text ? 'text' : 'json';
      const client = createCommandClient(program);
      try {
        const payload: Record<string, unknown> = {
          collapsed,
          dryRun: opts.apply !== true,
        };
        if (opts.today) payload.today = true;
        if (opts.rootId) payload.rootRemId = opts.rootId;
        const result = await client.execute('set_outline_collapsed', payload);
        console.log(formatResult(result, format, formatOutlineText));
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error), format));
        process.exit(EXIT.ERROR);
      } finally {
        await client.close();
      }
    });
}

export function registerOutlineCommand(program: Command): void {
  const outline = program.command('outline').description('Preview or change outline folding');
  outline.action(() => outline.outputHelp());
  registerOutlineAction(outline, program, 'collapse', true);
  registerOutlineAction(outline, program, 'expand', false);
}

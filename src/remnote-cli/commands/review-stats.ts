import { Command } from 'commander';
import { createCommandClient } from '../client/command-client.js';
import { formatError, formatResult, type OutputFormat } from '../output/formatter.js';
import { EXIT } from '../config.js';

function formatCardType(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { clozeId?: unknown }).clozeId === 'string'
  ) {
    return `cloze:${(value as { clozeId: string }).clozeId}`;
  }
  return String(value);
}

function formatReviewStatsText(data: unknown): string {
  const results = (data as { results?: Array<Record<string, unknown>> }).results ?? [];
  if (results.length === 0) return 'No review statistics returned.';

  return results
    .flatMap((result) => {
      const remId = String(result.remId ?? '');
      const cards = Array.isArray(result.cards)
        ? (result.cards as Array<Record<string, unknown>>)
        : [];
      if (cards.length === 0) return [`Rem ${remId}: no generated cards.`];

      return cards.map((card) => {
        const lines = [
          `Rem ${remId}: card ${String(card.cardId)} (${formatCardType(card.type)})`,
          `  createdAt: ${String(card.createdAt)}`,
          `  repetitions: ${Array.isArray(card.repetitionHistory) ? card.repetitionHistory.length : 0}`,
        ];
        for (const field of ['lastRepetitionTime', 'nextRepetitionTime', 'timesWrongInRow']) {
          if (card[field] !== undefined) lines.push(`  ${field}: ${String(card[field])}`);
        }
        return lines.join('\n');
      });
    })
    .join('\n');
}

export function registerReviewStatsCommand(program: Command): void {
  program
    .command('review-stats')
    .description('Read native review facts for cards in an exact Rem scope')
    .argument('[rem-ids...]', 'One or more exact Rem IDs')
    .option('--today', "Inspect today's daily document and descendants")
    .option('--root-id <remId>', 'Inspect this Rem and all descendants')
    .option('--tag-id <tagRemId>', 'Inspect directly tagged Rems and all descendants')
    .action(async (remIds: string[] | undefined, opts) => {
      const globalOpts = program.opts();
      const format: OutputFormat = globalOpts.text ? 'text' : 'json';
      const client = createCommandClient(program);

      try {
        const payload: Record<string, unknown> = {};
        if (remIds?.length) payload.remIds = remIds;
        if (opts.today) payload.today = true;
        if (opts.rootId) payload.rootRemId = opts.rootId;
        if (opts.tagId) payload.tagRemId = opts.tagId;
        const result = await client.execute('get_review_stats', payload);
        console.log(formatResult(result, format, formatReviewStatsText));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(formatError(message, format));
        process.exit(EXIT.ERROR);
      } finally {
        await client.close();
      }
    });
}

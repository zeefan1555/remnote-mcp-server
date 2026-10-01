import { Command } from 'commander';
import { FlashcardsApplySchema, WikiApplySchema } from '../../schemas/task-schemas.js';
import { createCommandClient } from '../client/command-client.js';
import { readContentFileOrStdin } from './content-input.js';
import { EXIT } from '../config.js';
import { formatError, formatResult } from '../output/formatter.js';
const commonHelp = [
  'The file contains the inner plan, not a request envelope. schemaVersion must be 1.',
  'TextSegments = ["literal text", {"remId":"EXACT_ID"}, ...] (1..100 segments).',
  'AnswerPatch = {"key":"patch-key","cardRemId":"CARD_REM_ID","remId":"ANSWER_REM_ID","expectedTextHash":"64 lowercase SHA256 hex characters","text":TextSegments}.',
  'Keys: 1..64 ASCII letters/digits/._- and unique across all plan objects/patches.',
  'Idempotency key: 1..128 of the same characters. Plan JSON <=100KiB; IDs <=256 chars.',
  'Title/question: nonblank <=1000 chars; strings in TextSegments <=10000 chars (empty allowed).',
  'Default is read-only preview. --apply explicitly applies; preserve the same key for a reviewed plan.',
  'Preview and apply never look up dates or create daily documents.',
  'Every SDK mutation rechecks the live write gate immediately before its call, after awaited reads.',
  'Receipts contain metadata only, including ids mapping semantic keys to exact Rem IDs (max1000).',
  'Use ids such as card:<key>, answer:<key>:<zero-index>, page:<key>, node:<key>, index:<pageKey>, log:batch; never infer IDs from creation order.',
  'facts contains up to 1000 selected {remId,textHash,cardIds,reviewHash} entries, without text/history bodies.',
  'Use exact-ID reads for semantic review of final text; receipt hashes do not replace that review.',
  'No deletes, replacements, moves, or rollback guarantee.',
  'Partial/unknown/incomplete/conflict receipts exit nonzero; do not blindly replay writes.',
];
const help = {
  flashcards: [
    'Plan shape:',
    '  {"schemaVersion":1,"dailyRemId":"DAILY_ID","homeRootId":"HOME_ID","tagRemId":"TAG_ID","title":"Optional cluster title","newCards":[{"key":"card-a","question":"Question?","answer":[["Answer."]]}],"answerPatches":[],"reusedCardRemIds":[]}',
    'newCards, answerPatches, reusedCardRemIds and title are optional; at least one new/patch/reused card is required.',
    'newCards <=7; answer lines 1..100; answerPatches/reusedCardRemIds <=100.',
    'A title is required for two or more new cards. pageKey segments are forbidden.',
    'dailyRemId must name an explicit existing dailyDocument; native type validation cannot prove calendar freshness.',
    'No date scalar is supplied. The caller resolves/revalidates the intended date before a new batch and after midnight.',
    'Replay uses the original recorded diary; it never switches an existing batch to a newly resolved date.',
    'Receipt budget: sum(1 + answer lines per newCard) + (newCards.length > 1 ? 1 : 0) + 2 + reused IDs + 2*patches <=1000.',
  ],
  wiki: [
    'Plan shape:',
    '  {"schemaVersion":1,"wikiRootId":"WIKI_ID","partitionRemId":"PARTITION_ID","indexRemId":"INDEX_ID","logRemId":"LOG_ID","pages":[{"key":"page-a","title":"Page title","aliases":[],"nodes":[{"key":"node-a","text":["Content."]}],"summary":["Summary."]}],"answerPatches":[]}',
    'pages is required (0..10); answerPatches is optional (<=100); at least one page/patch is required.',
    'A page may also contain remId for an existing page; its title must match. aliases is optional (<=20 nonblank strings, <=200 chars).',
    'nodes is required (0..100). Existing nodes add remId and expectedTextHash; new nodes must omit both.',
    'Known-created Wiki objects must remain ordinary, plain, untagged non-card text before mutation.',
    'Existing grouped-index entries are traversed through the full bounded tree and keep their parent.',
    'A missing/new grouped entry fails before writes; use an explicit section-targeted fallback with reviewed exact IDs.',
    'summary is required TextSegments. WIKI TextSegments also allow {"pageKey":"page-a"} referring to an input page key.',
    'Receipt budget: 2*pages + total nodes + 1 + 2*answerPatches <=1000.',
  ],
};
export function registerTaskCommands(program: Command): void {
  for (const kind of ['flashcards', 'wiki'] as const)
    program
      .command(kind)
      .description(`Plan and apply bounded ${kind} tasks`)
      .command('apply')
      .description(`Preview a ${kind} plan; use --apply to perform guarded writes`)
      .requiredOption(
        '--plan <path|->',
        'Read the inner schemaVersion=1 JSON plan from a file or stdin'
      )
      .requiredOption(
        '--idempotency-key <key>',
        'Stable key for this exact plan; never change it to blindly retry'
      )
      .option('--apply', 'Apply the plan (default: read-only preview)')
      .addHelpText('after', ['', ...help[kind], '', ...commonHelp].join('\n'))
      .action(async (opts: { plan: string; idempotencyKey: string; apply?: boolean }) => {
        const format = program.opts().text ? 'text' : 'json';
        const client = createCommandClient(program);
        try {
          const plan: unknown = JSON.parse(await readContentFileOrStdin(opts.plan));
          const schema = kind === 'flashcards' ? FlashcardsApplySchema : WikiApplySchema;
          const result = (await client.execute(
            `${kind}_apply`,
            schema.parse({
              schemaVersion: 1,
              plan,
              idempotencyKey: opts.idempotencyKey,
              dryRun: !opts.apply,
            })
          )) as Record<string, unknown>;
          console.log(formatResult(result, format, () => JSON.stringify(result, null, 2)));
          if (
            result.complete !== true ||
            result.status !== (opts.apply ? 'verified' : 'preview') ||
            !Array.isArray(result.errors) ||
            result.errors.length > 0
          )
            process.exitCode = EXIT.ERROR;
        } catch (error) {
          console.error(
            formatError(error instanceof Error ? error.message : String(error), format)
          );
          process.exitCode = EXIT.ERROR;
        } finally {
          await client.close();
        }
      });
}

import { Command } from 'commander';
import { createCommandClient } from '../client/command-client.js';
import { EXIT } from '../config.js';
import { formatError, formatResult, type OutputFormat } from '../output/formatter.js';

function formatTodoListText(data: unknown): string {
  const todos = (data as { todos?: Array<Record<string, unknown>> }).todos ?? [];
  if (todos.length === 0) return 'No tagged todos found.';
  return todos
    .map((todo, index) => {
      const nativeStatus = todo.isTodo
        ? `native=${String(todo.todoStatus ?? 'unknown')}`
        : 'native=not-a-todo';
      return `${index + 1}. ${String(todo.title || '(untitled)')} [${String(todo.remId)}] ${nativeStatus}`;
    })
    .join('\n');
}

function formatTodoUpdateText(data: unknown): string {
  const result = data as Record<string, unknown>;
  return `${result.dryRun === true ? 'Preview' : 'Applied'} TODO update for ${String(result.title)} [${String(result.remId)}]: changed=${String(result.changed)}, native=${String(result.newTodoStatus ?? 'not-a-todo')}`;
}

function registerTodoUpdate(
  todo: Command,
  program: Command,
  name: 'complete' | 'reopen',
  finished: boolean
): void {
  todo
    .command(`${name} <rem-id>`)
    .description(`${name === 'complete' ? 'Complete' : 'Reopen'} a todo and swap its status tags`)
    .requiredOption('--todo-tag-id <remId>', 'Exact TODO tag Rem ID')
    .requiredOption('--done-tag-id <remId>', 'Exact DONE tag Rem ID')
    .option('--apply', 'Apply the change; otherwise preview only')
    .action(async (remId: string, opts) => {
      const format: OutputFormat = program.opts().text ? 'text' : 'json';
      const client = createCommandClient(program);
      try {
        const result = await client.execute('update_todo', {
          remId,
          finished,
          todoTagRemId: opts.todoTagId,
          doneTagRemId: opts.doneTagId,
          dryRun: opts.apply !== true,
        });
        console.log(formatResult(result, format, formatTodoUpdateText));
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error), format));
        process.exit(EXIT.ERROR);
      } finally {
        await client.close();
      }
    });
}

export function registerTodoCommand(program: Command): void {
  const todo = program.command('todo').description('List and update tagged RemNote todos');
  todo.action(() => todo.outputHelp());

  todo
    .command('list')
    .description('List Rems carrying an exact TODO tag')
    .requiredOption('--tag-id <remId>', 'Exact TODO tag Rem ID')
    .action(async (opts) => {
      const format: OutputFormat = program.opts().text ? 'text' : 'json';
      const client = createCommandClient(program);
      try {
        const result = await client.execute('list_todos', { tagRemId: opts.tagId });
        console.log(formatResult(result, format, formatTodoListText));
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error), format));
        process.exit(EXIT.ERROR);
      } finally {
        await client.close();
      }
    });

  registerTodoUpdate(todo, program, 'complete', true);
  registerTodoUpdate(todo, program, 'reopen', false);
}

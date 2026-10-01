/**
 * Workflow 05: Error Cases
 *
 * Validates that the server handles invalid inputs gracefully:
 * nonexistent IDs, missing required fields, empty queries.
 */

import { assertTruthy } from '../assertions.js';
import { ToolError } from '../mcp-test-client.js';
import type { WorkflowContext, WorkflowResult, SharedState, StepResult } from '../types.js';

export async function errorCasesWorkflow(
  ctx: WorkflowContext,
  _state: SharedState
): Promise<WorkflowResult> {
  const steps: StepResult[] = [];

  // Step 1: Verify error on empty create (bridge-side validation)
  {
    const start = Date.now();
    try {
      try {
        await ctx.client.callTool('remnote_create_note', {});
        throw new Error('Should have failed on empty input');
      } catch (e: unknown) {
        // Success case: bridge should throw 'create_note requires either title or content'
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('Should have failed')) {
          throw e;
        }
      }
      steps.push({
        label: 'Verify error on empty create',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Verify error on empty create',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  // Step 2: Read nonexistent note returns error
  {
    const start = Date.now();
    try {
      const errorText = await ctx.client.callToolExpectError('remnote_read_note', {
        remId: 'nonexistent-id-00000',
      });
      assertTruthy(errorText, 'should return error text for nonexistent read');
      steps.push({
        label: 'Read nonexistent note returns error',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      // If callToolExpectError itself throws a ToolError, that's also valid
      if (e instanceof ToolError) {
        steps.push({
          label: 'Read nonexistent note returns error',
          passed: true,
          durationMs: Date.now() - start,
        });
      } else {
        steps.push({
          label: 'Read nonexistent note returns error',
          passed: false,
          durationMs: Date.now() - start,
          error: (e as Error).message,
        });
      }
    }
  }

  // Step 3: Update nonexistent note returns error
  {
    const start = Date.now();
    try {
      const errorText = await ctx.client.callToolExpectError('remnote_update_note', {
        remId: 'nonexistent-id-00000',
        title: 'Nope',
      });
      assertTruthy(errorText, 'should return error text for nonexistent update');
      steps.push({
        label: 'Update nonexistent note returns error',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      if (e instanceof ToolError) {
        steps.push({
          label: 'Update nonexistent note returns error',
          passed: true,
          durationMs: Date.now() - start,
        });
      } else {
        steps.push({
          label: 'Update nonexistent note returns error',
          passed: false,
          durationMs: Date.now() - start,
          error: (e as Error).message,
        });
      }
    }
  }

  // Step 4: Old mixed update fields return validation error
  {
    const start = Date.now();
    try {
      const errorText = await ctx.client.callToolExpectError('remnote_update_note', {
        remId: 'rem-123',
        appendContent: 'append',
      });
      assertTruthy(
        errorText.includes('Unrecognized') || errorText.includes('appendContent'),
        'should reject old mixed update fields'
      );
      steps.push({
        label: 'Old mixed update fields return validation error',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      if (e instanceof ToolError) {
        steps.push({
          label: 'Old mixed update fields return validation error',
          passed: true,
          durationMs: Date.now() - start,
        });
      } else {
        steps.push({
          label: 'Old mixed update fields return validation error',
          passed: false,
          durationMs: Date.now() - start,
          error: (e as Error).message,
        });
      }
    }
  }

  // Step 5: Contradictory alias operations fail schema validation
  {
    const start = Date.now();
    try {
      const errorText = await ctx.client.callToolExpectError('remnote_update_note', {
        remId: 'validation-only-rem-id',
        addAliases: ['Same   Alias'],
        removeAliases: [' Same Alias '],
      });
      assertTruthy(
        errorText.includes('Alias cannot be both added and removed'),
        'should reject contradictory normalized alias operations'
      );
      steps.push({
        label: 'Contradictory alias operations return validation error',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      if (e instanceof ToolError) {
        steps.push({
          label: 'Contradictory alias operations return validation error',
          passed: true,
          durationMs: Date.now() - start,
        });
      } else {
        steps.push({
          label: 'Contradictory alias operations return validation error',
          passed: false,
          durationMs: Date.now() - start,
          error: (e as Error).message,
        });
      }
    }
  }

  // Step 6: Search with empty query handled gracefully
  {
    const start = Date.now();
    try {
      // Empty query might return empty results or an error — both are acceptable
      try {
        const result = await ctx.client.callTool('remnote_search', { query: '' });
        // If it succeeds, it should at least have a results field
        assertTruthy(result !== undefined, 'should return some response');
      } catch (e) {
        // ToolError is acceptable — server rejected empty query
        if (!(e instanceof ToolError)) {
          throw e;
        }
      }
      steps.push({
        label: 'Search with empty query handled gracefully',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Search with empty query handled gracefully',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  // Preview-only probes never create fixtures or daily documents.
  for (const kind of ['flashcards', 'wiki'] as const) {
    const start = Date.now();
    const missing = `missing-task-${ctx.runId}`;
    const plan =
      kind === 'flashcards'
        ? {
            schemaVersion: 1,
            dailyRemId: missing,
            homeRootId: missing,
            tagRemId: missing,
            newCards: [{ key: 'card', question: 'Preview?', answer: [['No write.']] }],
          }
        : {
            schemaVersion: 1,
            wikiRootId: missing,
            partitionRemId: missing,
            indexRemId: missing,
            logRemId: missing,
            pages: [{ key: 'page', title: 'Preview', nodes: [], summary: ['No write.'] }],
          };
    try {
      const receipt = await ctx.client.callTool(`remnote_${kind}_apply`, {
        schemaVersion: 1,
        plan,
        dryRun: true,
        idempotencyKey: `preview-${kind}-${ctx.runId.replace(/[^A-Za-z0-9._-]/g, '-')}`,
      });
      assertTruthy(
        receipt.status === 'incomplete' && receipt.complete === false,
        'missing target cannot pass'
      );
      assertTruthy(
        Array.isArray(receipt.created) && receipt.created.length === 0,
        'preview creates no Rems'
      );
      steps.push({
        label: `${kind} missing-target preview receipt`,
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: `${kind} missing-target preview receipt`,
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  return { name: 'Error Cases', steps, skipped: false };
}

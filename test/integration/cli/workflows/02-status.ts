/**
 * Workflow 02: Status Check (gatekeeper)
 *
 * Verifies the CLI can communicate with RemNote via the bridge.
 * If this fails, remaining workflows are skipped.
 *
 * Prerequisites: MCP server must be running AND RemNote bridge must be connected.
 */

import { assertHasField, assertTruthy } from '../assertions.js';
import type { WorkflowContext, WorkflowResult, SharedState, StepResult } from '../types.js';

export async function statusWorkflow(
  ctx: WorkflowContext,
  state: SharedState
): Promise<WorkflowResult> {
  const steps: StepResult[] = [];

  // Step 1: Check bridge connection status
  {
    const start = Date.now();
    try {
      const result = await ctx.cli.runExpectSuccess(['status']);
      const r = result as Record<string, unknown>;
      assertHasField(r, 'connected', 'status result');
      assertTruthy(r.connected, 'bridge should be connected');
      steps.push({ label: 'Bridge connected', passed: true, durationMs: Date.now() - start });
    } catch (e) {
      steps.push({
        label: 'Bridge connected',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  // Step 2: Verify plugin version is reported
  {
    const start = Date.now();
    try {
      const result = await ctx.cli.runExpectSuccess(['status']);
      const r = result as Record<string, unknown>;
      assertHasField(r, 'pluginVersion', 'status result pluginVersion');
      assertTruthy(typeof r.pluginVersion === 'string', 'pluginVersion should be a string');
      steps.push({
        label: 'Plugin version reported',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Plugin version reported',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  // Step 3: Fail fast on bridge/CLI version mismatch
  {
    const start = Date.now();
    try {
      const result = await ctx.cli.runExpectSuccess(['status']);
      const r = result as Record<string, unknown>;
      assertHasField(r, 'cliVersion', 'status result cliVersion');
      assertTruthy(typeof r.cliVersion === 'string', 'cliVersion should be a string');
      assertTruthy(
        !('version_warning' in r),
        `version mismatch detected (cli=${String(r.cliVersion)}, bridge=${String(r.pluginVersion)}): ${String(
          r.version_warning
        )}`
      );
      steps.push({
        label: 'CLI/bridge versions are compatible',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'CLI/bridge versions are compatible',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  // Step 4: Capture write/replace policy flags
  {
    const start = Date.now();
    try {
      const result = await ctx.cli.runExpectSuccess(['status']);
      const r = result as Record<string, unknown>;
      assertHasField(r, 'acceptWriteOperations', 'status result acceptWriteOperations');
      assertTruthy(
        typeof r.acceptWriteOperations === 'boolean',
        'acceptWriteOperations should be a boolean'
      );
      assertHasField(r, 'acceptReplaceOperation', 'status result acceptReplaceOperation');
      assertTruthy(
        typeof r.acceptReplaceOperation === 'boolean',
        'acceptReplaceOperation should be a boolean'
      );
      state.acceptWriteOperations = r.acceptWriteOperations as boolean;
      state.acceptReplaceOperation = r.acceptReplaceOperation as boolean;
      steps.push({
        label: 'Bridge write/replace policy flags reported',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Bridge write/replace policy flags reported',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  // Step 5: SDK capability discovery is available through the CLI
  {
    const start = Date.now();
    try {
      const result = (await ctx.cli.runExpectSuccess(['sdk', 'capabilities'])) as Record<
        string,
        unknown
      >;
      assertHasField(result, 'sdkVersion', 'SDK capability result');
      assertHasField(result, 'capabilities', 'SDK capability result');
      assertTruthy(typeof result.sdkVersion === 'string', 'sdkVersion should be a string');
      assertTruthy(Array.isArray(result.capabilities), 'capabilities should be an array');
      const platformCapability = (result.capabilities as Array<Record<string, unknown>>).find(
        (capability) => capability.id === 'namespace:app.getPlatform'
      );
      assertTruthy(platformCapability, 'namespace:app.getPlatform should be discoverable');
      assertTruthy(
        platformCapability.group === 'app' && platformCapability.command === 'get-platform',
        'platform capability should expose its generated CLI command'
      );
      assertTruthy(
        Array.isArray(platformCapability.signatures),
        'platform capability should expose SDK signatures'
      );
      const callResult = (await ctx.cli.runExpectSuccess([
        'sdk',
        'app',
        'get-platform',
        '--args-json',
        '[]',
      ])) as Record<string, unknown>;
      assertTruthy(
        callResult.capability === 'namespace:app.getPlatform',
        'SDK call should echo the capability ID'
      );
      assertTruthy(typeof callResult.value === 'string', 'SDK platform should be a string');
      steps.push({
        label: 'Plugin SDK capability discovery and read call work',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Plugin SDK capability discovery and read call work',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  return { name: 'Status Check', steps, skipped: false };
}

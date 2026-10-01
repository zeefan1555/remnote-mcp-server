import { describe, it, expect } from 'vitest';
import { InspectManySchema, VerifyScopeSchema } from '../../src/schemas/composite-schemas.js';
const inspect = { schemaVersion: 1, remIds: ['r'] };
describe('read receipt schemas', () => {
  it('defaults bounded traversal and requires selectors', () => {
    expect(InspectManySchema.parse(inspect)).toEqual({
      ...inspect,
      maxRems: 1000,
      ancestorDepth: 20,
    });
    for (const key of ['remIds', 'subtreeRootIds', 'tagRemIds'])
      expect(InspectManySchema.safeParse({ schemaVersion: 1, [key]: ['r'] }).success).toBe(true);
    expect(InspectManySchema.safeParse({ schemaVersion: 1 }).success).toBe(false);
  });
  it.each([
    { schemaVersion: 2 },
    { remIds: [] },
    { remIds: [''] },
    { remIds: ['  '] },
    { remIds: ['x'.repeat(257)] },
    { remIds: Array(101).fill('r') },
    { subtreeRootIds: Array(11).fill('r') },
    { tagRemIds: Array(11).fill('r') },
    { maxRems: 0 },
    { maxRems: 1001 },
    { maxRems: 1.5 },
    { ancestorDepth: -1 },
    { ancestorDepth: 21 },
    { today: true },
    { writes: [] },
  ])('rejects unbounded/unknown input %#', (v) =>
    expect(InspectManySchema.safeParse({ ...inspect, ...v }).success).toBe(false)
  );
  it('accepts every expectation with fail-closed defaults', () => {
    const expectations = [
      { kind: 'parent', remId: 'r', value: 'p' },
      { kind: 'remType', remId: 'r', value: 'text' },
      { kind: 'tag', remId: 'r', value: 't' },
      { kind: 'powerup', remId: 'r', code: 'cc', value: false },
      { kind: 'references', remId: 'r', value: [] },
      { kind: 'children', remId: 'r', value: [] },
      { kind: 'ancestor', remId: 'r', value: 'a' },
      { kind: 'cardRemIds', remId: 'r', value: [] },
      { kind: 'zeroCards', remId: 'r' },
    ];
    const r = VerifyScopeSchema.parse({ schemaVersion: 1, inspect, expectations });
    expect(r.expectations[2]).toMatchObject({ present: true, inverse: true });
    expect(r.expectations[4]).toMatchObject({ exact: true });
    expect(r.expectations[8]).toMatchObject({ noCardStructure: true });
  });
  it.each(
    [
      [],
      Array(201).fill({ kind: 'zeroCards', remId: 'r' }),
      [{ kind: 'other', remId: 'r' }],
      [{ kind: 'zeroCards', remId: 'r', extra: true }],
      [{ kind: 'children', remId: 'r', value: Array(1001).fill('c') }],
    ].map((x) => [x])
  )('rejects invalid expectations %#', (expectations) =>
    expect(VerifyScopeSchema.safeParse({ schemaVersion: 1, inspect, expectations }).success).toBe(
      false
    )
  );
});

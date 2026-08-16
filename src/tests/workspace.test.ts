import { test, describe } from 'node:test';
import assert from 'node:assert';
import { type Automaton } from '../lib/types.ts';
import { ValidationError } from '../lib/validator.ts';
import { EMPTY_LANGUAGE_REGEX } from '../lib/core/stateElimination.ts';
import {
  type WorkspaceItem,
  addRegexToWorkspace,
  compileRegexInWorkspace,
  eliminateEpsilonInWorkspace,
  subsetConstructionInWorkspace,
  minimizeInWorkspace,
  generateRegexInWorkspace,
  compareWorkspaceItems
} from '../lib/core/workspace.ts';

describe('Workspace Adapters and Lineage', () => {
  test('Full pipeline transformation and parent-child equivalence checks', () => {
    let workspace: WorkspaceItem[] = [];

    // 1. Add Regex
    workspace = addRegexToWorkspace(workspace, '(a|b)*abb');
    assert.strictEqual(workspace.length, 1);
    const regexItem = workspace[0];
    assert.strictEqual(regexItem.createdBy, 'typedFresh');
    assert.strictEqual(regexItem.payload.kind, 'regex');
    assert.strictEqual(regexItem.parentId, null);

    // 2. Compile to ENFA
    workspace = compileRegexInWorkspace(workspace, regexItem.id);
    assert.strictEqual(workspace.length, 2);
    const enfaItem = workspace[1];
    assert.strictEqual(enfaItem.createdBy, 'compileRegex');
    assert.strictEqual(enfaItem.payload.kind, 'automaton');
    assert.strictEqual(enfaItem.parentId, regexItem.id);
    assert.strictEqual(enfaItem.payload.automaton.type, 'ENFA');

    // 3. Eliminate epsilon to NFA
    workspace = eliminateEpsilonInWorkspace(workspace, enfaItem.id);
    assert.strictEqual(workspace.length, 3);
    const nfaItem = workspace[2];
    assert.strictEqual(nfaItem.createdBy, 'eliminateEpsilon');
    assert.strictEqual(nfaItem.payload.kind, 'automaton');
    assert.strictEqual(nfaItem.parentId, enfaItem.id);
    assert.strictEqual(nfaItem.payload.automaton.type, 'NFA');

    // 4. Subset construction to DFA
    workspace = subsetConstructionInWorkspace(workspace, nfaItem.id);
    assert.strictEqual(workspace.length, 4);
    const dfaItem = workspace[3];
    assert.strictEqual(dfaItem.createdBy, 'subsetConstruction');
    assert.strictEqual(dfaItem.payload.kind, 'automaton');
    assert.strictEqual(dfaItem.parentId, nfaItem.id);
    assert.strictEqual(dfaItem.payload.automaton.type, 'DFA');

    // 5. Minimize DFA
    workspace = minimizeInWorkspace(workspace, dfaItem.id);
    assert.strictEqual(workspace.length, 5);
    const minDfaItem = workspace[4];
    assert.strictEqual(minDfaItem.createdBy, 'minimize');
    assert.strictEqual(minDfaItem.payload.kind, 'automaton');
    assert.strictEqual(minDfaItem.parentId, dfaItem.id);
    assert.strictEqual(minDfaItem.payload.automaton.type, 'DFA');

    // 6. Generate Regex
    workspace = generateRegexInWorkspace(workspace, minDfaItem.id);
    assert.strictEqual(workspace.length, 6);
    const genRegexItem = workspace[5];
    assert.strictEqual(genRegexItem.createdBy, 'generateRegex');
    assert.strictEqual(genRegexItem.payload.kind, 'regex');
    assert.strictEqual(genRegexItem.parentId, minDfaItem.id);

    // Verify consecutive parent-child pairs are equivalent
    assert.strictEqual(compareWorkspaceItems(regexItem, enfaItem).equivalent, true);
    assert.strictEqual(compareWorkspaceItems(enfaItem, nfaItem).equivalent, true);
    assert.strictEqual(compareWorkspaceItems(nfaItem, dfaItem).equivalent, true);
    assert.strictEqual(compareWorkspaceItems(dfaItem, minDfaItem).equivalent, true);
    assert.strictEqual(compareWorkspaceItems(minDfaItem, genRegexItem).equivalent, true);
  });

  test('Save Canvas Automaton to workspace is un-mutated', () => {
    let workspace: WorkspaceItem[] = [];
    const canvasAutomaton: Automaton = {
      type: 'DFA',
      states: ['A', 'B'],
      alphabet: ['a'],
      transitions: [{ from: 'A', to: 'B', label: 'a' }],
      startState: 'A',
      acceptStates: ['B']
    };

    const newItem: WorkspaceItem = {
      id: 'custom-id',
      label: 'Canvas Save',
      parentId: null,
      createdBy: 'canvasSave',
      payload: { kind: 'automaton', automaton: canvasAutomaton }
    };

    workspace = [...workspace, newItem];
    assert.strictEqual(workspace.length, 1);
    const payload = workspace[0].payload;
    if (payload.kind === 'automaton') {
      assert.deepStrictEqual(payload.automaton, canvasAutomaton);
    } else {
      assert.fail('Expected automaton payload kind.');
    }
  });

  test('Deliberately non-equivalent items return equivalent: false with counterexample', () => {
    let workspace: WorkspaceItem[] = [];
    workspace = addRegexToWorkspace(workspace, 'a');
    workspace = addRegexToWorkspace(workspace, 'b');

    const result = compareWorkspaceItems(workspace[0], workspace[1]);
    assert.strictEqual(result.equivalent, false);
    assert.ok(result.counterexample === 'a' || result.counterexample === 'b');
  });

  test('Adapter functions throw ValidationError when itemId not found', () => {
    const workspace: WorkspaceItem[] = [];
    assert.throws(() => compileRegexInWorkspace(workspace, 'non-existent'), ValidationError);
  });

  test('Adapter functions throw ValidationError when payload kind or type does not match', () => {
    let workspace: WorkspaceItem[] = [];
    workspace = addRegexToWorkspace(workspace, 'a');
    const regexItem = workspace[0];

    // Try running eliminateEpsilon on a regex item
    assert.throws(
      () => eliminateEpsilonInWorkspace(workspace, regexItem.id),
      ValidationError
    );

    // Compile regexItem to ENFA
    workspace = compileRegexInWorkspace(workspace, regexItem.id);
    const enfaItem = workspace[1];

    // Try running subsetConstruction (requires NFA) on the ENFA item
    assert.throws(
      () => subsetConstructionInWorkspace(workspace, enfaItem.id),
      ValidationError
    );
  });

  test('compileRegexInWorkspace on EMPTY_LANGUAGE_REGEX throws ValidationError instead of LexerError', () => {
    let workspace: WorkspaceItem[] = [];
    workspace = addRegexToWorkspace(workspace, EMPTY_LANGUAGE_REGEX);
    const emptyRegexItem = workspace[0];

    assert.throws(
      () => compileRegexInWorkspace(workspace, emptyRegexItem.id),
      (err: any) => {
        return err instanceof ValidationError && err.message.includes('cannot compile the empty-language sentinel');
      }
    );
  });

  test('eliminateEpsilonInWorkspace mutation safety regression test', () => {
    let workspace: WorkspaceItem[] = [];
    workspace = addRegexToWorkspace(workspace, 'a|b');
    workspace = compileRegexInWorkspace(workspace, workspace[0].id);
    const enfaItem = workspace[1];
    
    // Create reference deep copy of the original item before call
    const payload = enfaItem.payload;
    if (payload.kind !== 'automaton') assert.fail('expected automaton');
    const originalAutomatonCopy = JSON.parse(JSON.stringify(payload.automaton));

    // Call workspace adapter
    const updated = eliminateEpsilonInWorkspace(workspace, enfaItem.id);

    // Assert original item still in workspace has not been mutated
    const originalItemInWorkspace = updated.find(i => i.id === enfaItem.id)!;
    const currentPayload = originalItemInWorkspace.payload;
    if (currentPayload.kind !== 'automaton') assert.fail('expected automaton');
    assert.deepStrictEqual(currentPayload.automaton, originalAutomatonCopy);
  });

  test('subsetConstructionInWorkspace mutation safety regression test', () => {
    let workspace: WorkspaceItem[] = [];
    workspace = addRegexToWorkspace(workspace, 'a');
    workspace = compileRegexInWorkspace(workspace, workspace[0].id);
    workspace = eliminateEpsilonInWorkspace(workspace, workspace[1].id);
    const nfaItem = workspace[2];
    
    const payload = nfaItem.payload;
    if (payload.kind !== 'automaton') assert.fail('expected automaton');
    const originalAutomatonCopy = JSON.parse(JSON.stringify(payload.automaton));

    // Call workspace adapter
    const updated = subsetConstructionInWorkspace(workspace, nfaItem.id);

    // Assert original item still in workspace has not been mutated
    const originalItemInWorkspace = updated.find(i => i.id === nfaItem.id)!;
    const currentPayload = originalItemInWorkspace.payload;
    if (currentPayload.kind !== 'automaton') assert.fail('expected automaton');
    assert.deepStrictEqual(currentPayload.automaton, originalAutomatonCopy);
  });

  test('minimizeInWorkspace mutation safety regression test', () => {
    let workspace: WorkspaceItem[] = [];
    workspace = addRegexToWorkspace(workspace, 'a');
    workspace = compileRegexInWorkspace(workspace, workspace[0].id);
    workspace = eliminateEpsilonInWorkspace(workspace, workspace[1].id);
    workspace = subsetConstructionInWorkspace(workspace, workspace[2].id);
    const dfaItem = workspace[3];
    
    const payload = dfaItem.payload;
    if (payload.kind !== 'automaton') assert.fail('expected automaton');
    const originalAutomatonCopy = JSON.parse(JSON.stringify(payload.automaton));

    // Call workspace adapter
    const updated = minimizeInWorkspace(workspace, dfaItem.id);

    // Assert original item still in workspace has not been mutated
    const originalItemInWorkspace = updated.find(i => i.id === dfaItem.id)!;
    const currentPayload = originalItemInWorkspace.payload;
    if (currentPayload.kind !== 'automaton') assert.fail('expected automaton');
    assert.deepStrictEqual(currentPayload.automaton, originalAutomatonCopy);
  });
});

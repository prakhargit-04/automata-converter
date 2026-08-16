import { test, describe } from 'node:test';
import assert from 'node:assert';
import { type Automaton, EPSILON } from '../lib/types.ts';
import { ValidationError } from '../lib/validator.ts';
import { buildTransitionTable } from '../lib/core/transitionTable.ts';

describe('Transition Table Builder', () => {
  test('Complete DFA maps correctly with no empty cell arrays', () => {
    const dfa: Automaton = {
      type: 'DFA',
      states: ['q0', 'q1'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 'q0', to: 'q1', label: 'a' },
        { from: 'q0', to: 'q0', label: 'b' },
        { from: 'q1', to: 'q1', label: 'a' },
        { from: 'q1', to: 'q0', label: 'b' }
      ],
      startState: 'q0',
      acceptStates: ['q1']
    };

    const table = buildTransitionTable(dfa);
    assert.deepStrictEqual(table.columns, ['a', 'b']);
    assert.strictEqual(table.rows.length, 2);

    const r0 = table.rows[0];
    assert.strictEqual(r0.state, 'q0');
    assert.strictEqual(r0.isStart, true);
    assert.strictEqual(r0.isAccept, false);
    assert.deepStrictEqual(r0.cells['a'], ['q1']);
    assert.deepStrictEqual(r0.cells['b'], ['q0']);

    const r1 = table.rows[1];
    assert.strictEqual(r1.state, 'q1');
    assert.strictEqual(r1.isStart, false);
    assert.strictEqual(r1.isAccept, true);
    assert.deepStrictEqual(r1.cells['a'], ['q1']);
    assert.deepStrictEqual(r1.cells['b'], ['q0']);
  });

  test('Incomplete DFA maps missing transitions to empty arrays', () => {
    const dfa: Automaton = {
      type: 'DFA',
      states: ['q0', 'q1'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 'q0', to: 'q1', label: 'a' } // missing transition from q0 on b, and all from q1
      ],
      startState: 'q0',
      acceptStates: ['q1']
    };

    const table = buildTransitionTable(dfa);
    assert.deepStrictEqual(table.columns, ['a', 'b']);
    
    const r0 = table.rows[0];
    assert.deepStrictEqual(r0.cells['a'], ['q1']);
    assert.deepStrictEqual(r0.cells['b'], []); // empty array

    const r1 = table.rows[1];
    assert.deepStrictEqual(r1.cells['a'], []);
    assert.deepStrictEqual(r1.cells['b'], []);
  });

  test('NFA with multiple transitions on same symbol preserves order', () => {
    const nfa: Automaton = {
      type: 'NFA',
      states: ['q0', 'q1'],
      alphabet: ['a'],
      transitions: [
        { from: 'q0', to: 'q1', label: 'a' },
        { from: 'q0', to: 'q0', label: 'a' } // two transitions from q0 on 'a'
      ],
      startState: 'q0',
      acceptStates: ['q1']
    };

    const table = buildTransitionTable(nfa);
    assert.deepStrictEqual(table.columns, ['a']);
    
    const r0 = table.rows[0];
    assert.deepStrictEqual(r0.cells['a'], ['q1', 'q0']); // order preserved
  });

  test('ENFA with epsilon transitions appends EPSILON column last', () => {
    const enfa: Automaton = {
      type: 'ENFA',
      states: ['q0', 'q1'],
      alphabet: ['a'],
      transitions: [
        { from: 'q0', to: 'q1', label: EPSILON },
        { from: 'q0', to: 'q0', label: 'a' }
      ],
      startState: 'q0',
      acceptStates: ['q1']
    };

    const table = buildTransitionTable(enfa);
    assert.deepStrictEqual(table.columns, ['a', EPSILON]); // EPSILON column is appended last
    
    const r0 = table.rows[0];
    assert.deepStrictEqual(r0.cells['a'], ['q0']);
    assert.deepStrictEqual(r0.cells[EPSILON], ['q1']);
  });

  test('ENFA with zero epsilon transitions omits EPSILON column', () => {
    const enfa: Automaton = {
      type: 'ENFA',
      states: ['q0', 'q1'],
      alphabet: ['a'],
      transitions: [
        { from: 'q0', to: 'q1', label: 'a' }
      ],
      startState: 'q0',
      acceptStates: ['q1']
    };

    const table = buildTransitionTable(enfa);
    assert.deepStrictEqual(table.columns, ['a']); // no EPSILON column
  });

  test('Malformed automaton (startState not in states) throws ValidationError', () => {
    const bad: Automaton = {
      type: 'DFA',
      states: ['q0'],
      alphabet: ['a'],
      transitions: [],
      startState: 'invalid-state',
      acceptStates: []
    };

    assert.throws(() => buildTransitionTable(bad), ValidationError);
  });

  test('Row order matches states array order exactly (deliberately non-alphabetical)', () => {
    const dfa: Automaton = {
      type: 'DFA',
      states: ['qB', 'qA', 'qC'], // non-alphabetical states order
      alphabet: ['a'],
      transitions: [],
      startState: 'qA',
      acceptStates: []
    };

    const table = buildTransitionTable(dfa);
    assert.strictEqual(table.rows[0].state, 'qB');
    assert.strictEqual(table.rows[1].state, 'qA');
    assert.strictEqual(table.rows[2].state, 'qC');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { type Automaton } from '../lib/types.ts';
import { ValidationError } from '../lib/validator.ts';
import { move, epsilonClosure, completeDFA } from '../lib/core/primitives.ts';
import { simulateDFA, simulateNFA, simulateENFA } from '../lib/core/simulator.ts';

// Intentionally incomplete DFA: accepts only "a"
const incompleteDFA: Automaton = {
  type: 'DFA',
  states: ['A', 'B'],
  alphabet: ['a', 'b'],
  transitions: [
    { from: 'A', to: 'B', label: 'a' }
  ],
  startState: 'A',
  acceptStates: ['B']
};

// Complete DFA: accepts strings ending in "b"
const completeDFAFixture: Automaton = {
  type: 'DFA',
  states: ['A', 'B'],
  alphabet: ['a', 'b'],
  transitions: [
    { from: 'A', to: 'A', label: 'a' },
    { from: 'A', to: 'B', label: 'b' },
    { from: 'B', to: 'A', label: 'a' },
    { from: 'B', to: 'B', label: 'b' }
  ],
  startState: 'A',
  acceptStates: ['B']
};

// NFA: accepts strings containing "ab"
const nfaFixture: Automaton = {
  type: 'NFA',
  states: ['q0', 'q1', 'q2'],
  alphabet: ['a', 'b'],
  transitions: [
    { from: 'q0', to: 'q0', label: 'a' },
    { from: 'q0', to: 'q0', label: 'b' },
    { from: 'q0', to: 'q1', label: 'a' }, // duplicate "a" transitions
    { from: 'q1', to: 'q2', label: 'b' }
  ],
  startState: 'q0',
  acceptStates: ['q2']
};

// ENFA: has epsilon start->accept, accepts "ab" repeats
const enfaFixture: Automaton = {
  type: 'ENFA',
  states: ['start', 'accept', 'middle'],
  alphabet: ['a', 'b'],
  transitions: [
    { from: 'start', to: 'accept', label: 'ε' },
    { from: 'accept', to: 'middle', label: 'a' },
    { from: 'middle', to: 'accept', label: 'b' }
  ],
  startState: 'start',
  acceptStates: ['accept']
};

describe('Shared Automaton Primitives', () => {
  describe('move', () => {
    test('computes single step transitions without epsilon closure', () => {
      const next = move(nfaFixture, ['q0'], 'a');
      assert.deepStrictEqual(next, ['q0', 'q1']);
    });

    test('returns empty array when no transitions exist', () => {
      const next = move(incompleteDFA, ['B'], 'a');
      assert.deepStrictEqual(next, []);
    });
  });

  describe('epsilonClosure', () => {
    test('computes epsilon closure for ENFA starting states', () => {
      const closure = epsilonClosure(enfaFixture, ['start']);
      assert.deepStrictEqual(closure, ['accept', 'start']); // Sorted unique Q
    });

    test('returns input states unchanged for NFA/DFA with no epsilon transitions', () => {
      const closure = epsilonClosure(nfaFixture, ['q0']);
      assert.deepStrictEqual(closure, ['q0']);
    });
  });

  describe('completeDFA', () => {
    test('completes an incomplete DFA by introducing a TRAP state', () => {
      const completed = completeDFA(incompleteDFA);
      assert.strictEqual(completed.states.includes('TRAP'), true);
      assert.strictEqual(completed.states.length, 3); // A, B, TRAP

      const trapTransition = completed.transitions.find(t => t.from === 'A' && t.label === 'b');
      assert.strictEqual(trapTransition?.to, 'TRAP');

      const trapSelfA = completed.transitions.find(t => t.from === 'TRAP' && t.to === 'TRAP' && t.label === 'a');
      const trapSelfB = completed.transitions.find(t => t.from === 'TRAP' && t.to === 'TRAP' && t.label === 'b');
      assert.ok(trapSelfA);
      assert.ok(trapSelfB);
    });

    test('returns an already-complete DFA with no TRAP added and identical transitions', () => {
      const completed = completeDFA(completeDFAFixture);
      assert.strictEqual(completed.states.includes('TRAP'), false);
      assert.strictEqual(completed.states.length, completeDFAFixture.states.length);
      assert.strictEqual(completed.transitions.length, completeDFAFixture.transitions.length);
      assert.deepStrictEqual(
        [...completed.transitions].sort((a, b) => (a.from + a.label).localeCompare(b.from + b.label)),
        [...completeDFAFixture.transitions].sort((a, b) => (a.from + a.label).localeCompare(b.from + b.label))
      );
    });

    test('falls back to a non-colliding trap name when TRAP is already a state', () => {
      const dfaWithTrapNamed: Automaton = {
        type: 'DFA',
        states: ['A', 'TRAP'],
        alphabet: ['a', 'b'],
        transitions: [
          { from: 'A', to: 'TRAP', label: 'a' },
          { from: 'TRAP', to: 'TRAP', label: 'a' },
          { from: 'TRAP', to: 'TRAP', label: 'b' }
          // 'A' has no transition on 'b' — incomplete, forces trap creation
        ],
        startState: 'A',
        acceptStates: ['TRAP']
      };

      const completed = completeDFA(dfaWithTrapNamed);
      assert.strictEqual(completed.states.includes('TRAP_0'), true);
      assert.strictEqual(completed.states.length, 3); // A, TRAP, TRAP_0

      const newTrapTransition = completed.transitions.find(t => t.from === 'A' && t.label === 'b');
      assert.strictEqual(newTrapTransition?.to, 'TRAP_0');

      const newTrapSelfA = completed.transitions.find(t => t.from === 'TRAP_0' && t.to === 'TRAP_0' && t.label === 'a');
      const newTrapSelfB = completed.transitions.find(t => t.from === 'TRAP_0' && t.to === 'TRAP_0' && t.label === 'b');
      assert.ok(newTrapSelfA);
      assert.ok(newTrapSelfB);
    });
  });
});

describe('Automata Simulator', () => {
  describe('simulateDFA', () => {
    test('accepts string ending in b', () => {
      const res = simulateDFA(completeDFAFixture, 'ab');
      assert.strictEqual(res.accepted, true);
      assert.deepStrictEqual(res.path, [['A'], ['A'], ['B']]);
      assert.strictEqual(res.steps.length, 2);
    });

    test('rejects string ending in a', () => {
      const res = simulateDFA(completeDFAFixture, 'ba');
      assert.strictEqual(res.accepted, false);
      assert.deepStrictEqual(res.path, [['A'], ['B'], ['A']]);
    });

    test('rejects empty input if start state is not accept state', () => {
      const res = simulateDFA(completeDFAFixture, '');
      assert.strictEqual(res.accepted, false);
      assert.deepStrictEqual(res.path, [['A']]);
      assert.strictEqual(res.steps.length, 0);
    });

    test('dies mid-walk on undefined transition (in-alphabet symbol)', () => {
      const res = simulateDFA(incompleteDFA, 'ab');
      assert.strictEqual(res.accepted, false);
      assert.deepStrictEqual(res.path, [['A'], ['B']]);
      assert.strictEqual(res.steps.length, 1);
    });

    test('throws ValidationError for out-of-alphabet symbol', () => {
      assert.throws(() => simulateDFA(incompleteDFA, 'ax'), (err: unknown) => {
        return (
          err instanceof ValidationError &&
          err.message.includes('Input symbol "x"') &&
          err.message.includes('not in the DFA alphabet')
        );
      });
    });
  });

  describe('simulateNFA', () => {
    test('accepts string containing ab', () => {
      const res = simulateNFA(nfaFixture, 'aab');
      assert.strictEqual(res.accepted, true);
      assert.deepStrictEqual(res.path[0], ['q0']);
      assert.deepStrictEqual(res.path[1], ['q0', 'q1']);
      assert.deepStrictEqual(res.path[2], ['q0', 'q1']);
      assert.deepStrictEqual(res.path[3], ['q0', 'q2']);
    });

    test('rejects string running to completion', () => {
      const res = simulateNFA(nfaFixture, 'aaa');
      assert.strictEqual(res.accepted, false);
    });

    test('dies mid-walk when active state set becomes empty', () => {
      const strictNFA: Automaton = {
        type: 'NFA',
        states: ['0', '1'],
        alphabet: ['a', 'b'],
        transitions: [{ from: '0', to: '1', label: 'a' }],
        startState: '0',
        acceptStates: ['1']
      };

      const res = simulateNFA(strictNFA, 'ab');
      assert.strictEqual(res.accepted, false);
      assert.deepStrictEqual(res.path, [['0'], ['1']]);
      assert.strictEqual(res.steps.length, 1);
    });

    test('throws ValidationError for out-of-alphabet symbol', () => {
      assert.throws(() => simulateNFA(nfaFixture, 'ay'), (err: unknown) => {
        return (
          err instanceof ValidationError &&
          err.message.includes('Input symbol "y"') &&
          err.message.includes('not in the NFA alphabet')
        );
      });
    });
  });

  describe('simulateENFA', () => {
    test('accepts empty string if start state is epsilon-connected to accept state', () => {
      const res = simulateENFA(enfaFixture, '');
      assert.strictEqual(res.accepted, true);
      assert.deepStrictEqual(res.path, [['accept', 'start']]);
      assert.strictEqual(res.steps.length, 0);
    });

    test('accepts valid epsilon loop transitions', () => {
      const res = simulateENFA(enfaFixture, 'ab');
      assert.strictEqual(res.accepted, true);
      assert.deepStrictEqual(res.path[0], ['accept', 'start']);
      assert.deepStrictEqual(res.path[1], ['middle']);
      assert.deepStrictEqual(res.path[2], ['accept']);
    });

    test('rejects running to completion', () => {
      const res = simulateENFA(enfaFixture, 'a');
      assert.strictEqual(res.accepted, false);
      assert.deepStrictEqual(res.path[1], ['middle']);
    });

    test('dies mid-walk when active state set becomes empty', () => {
      const strictENFA: Automaton = {
        type: 'ENFA',
        states: ['0', '1'],
        alphabet: ['a', 'b'],
        transitions: [{ from: '0', to: '1', label: 'a' }],
        startState: '0',
        acceptStates: ['1']
      };
      const res = simulateENFA(strictENFA, 'ab');
      assert.strictEqual(res.accepted, false);
      assert.deepStrictEqual(res.path, [['0'], ['1']]);
      assert.strictEqual(res.steps.length, 1);
    });

    test('throws ValidationError for out-of-alphabet symbol', () => {
      assert.throws(() => simulateENFA(enfaFixture, 'az'), (err: unknown) => {
        return (
          err instanceof ValidationError &&
          err.message.includes('Input symbol "z"') &&
          err.message.includes('not in the ENFA alphabet')
        );
      });
    });
  });
});

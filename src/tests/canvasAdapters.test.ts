import { test, describe } from 'node:test';
import assert from 'node:assert';
import { type Automaton, EPSILON } from '../lib/types.ts';
import { validateAutomaton, ValidationError } from '../lib/validator.ts';
import {
  applyAddState,
  applyDeleteState,
  applyRenameState,
  applyAddTransition,
  applyDeleteTransition,
  applySetStartState,
  applyToggleAcceptState
} from '../lib/core/canvasAdapters.ts';

describe('Canvas State Adapters', () => {
  // Base DFA for testing
  const createBaseDFA = (): Automaton => ({
    type: 'DFA',
    states: ['q0', 'q1'],
    alphabet: ['a', 'b'],
    transitions: [
      { from: 'q0', to: 'q1', label: 'a' }
    ],
    startState: 'q0',
    acceptStates: ['q1']
  });

  test('applyAddState adds state and sorts states list', () => {
    const dfa = createBaseDFA();
    const updated = applyAddState(dfa, 'q2');

    validateAutomaton(updated);
    assert.deepStrictEqual(updated.states, ['q0', 'q1', 'q2']);
    assert.strictEqual(updated.states.length, 3);
  });

  test('applyAddState rejects invalid or duplicate name', () => {
    const dfa = createBaseDFA();
    assert.throws(() => applyAddState(dfa, ''), ValidationError);
    assert.throws(() => applyAddState(dfa, 'q_2'), ValidationError); // non-alphanumeric
    assert.throws(() => applyAddState(dfa, 'q0'), ValidationError); // duplicate
  });

  test('applyDeleteState removes state and cascade deletes transitions', () => {
    const dfa: Automaton = {
      type: 'DFA',
      states: ['q0', 'q1', 'q2'],
      alphabet: ['a'],
      transitions: [
        { from: 'q0', to: 'q1', label: 'a' },
        { from: 'q1', to: 'q2', label: 'a' }
      ],
      startState: 'q0',
      acceptStates: ['q2']
    };

    const updated = applyDeleteState(dfa, 'q1');
    validateAutomaton(updated);

    assert.deepStrictEqual(updated.states, ['q0', 'q2']);
    assert.strictEqual(updated.transitions.length, 0); // Both transitions cascaded away
  });

  test('applyRenameState updates state, start state, accept list and transitions', () => {
    const dfa = createBaseDFA();
    const updated = applyRenameState(dfa, 'q0', 'qStart');

    validateAutomaton(updated);
    assert.deepStrictEqual(updated.states, ['q1', 'qStart']);
    assert.strictEqual(updated.startState, 'qStart');
    assert.deepStrictEqual(updated.transitions, [
      { from: 'qStart', to: 'q1', label: 'a' }
    ]);
  });

  test('applyRenameState throws on duplicate collision', () => {
    const dfa = createBaseDFA();
    assert.throws(() => applyRenameState(dfa, 'q0', 'q1'), ValidationError);
  });

  test('applyAddTransition auto-adds to alphabet and handles demotions', () => {
    const dfa = createBaseDFA();

    // 1. Symbol addition check
    const updatedAlphabet = applyAddTransition(dfa, 'q0', 'q1', 'c');
    validateAutomaton(updatedAlphabet);
    assert.deepStrictEqual(updatedAlphabet.alphabet, ['a', 'b', 'c']);

    // 2. DFA to NFA demotion (multiple transitions on same symbol)
    const nfa = applyAddTransition(dfa, 'q0', 'q0', 'a');
    validateAutomaton(nfa);
    assert.strictEqual(nfa.type, 'NFA');

    // 3. Epsilon transition demotes directly to ENFA
    const enfa = applyAddTransition(dfa, 'q1', 'q0', EPSILON);
    validateAutomaton(enfa);
    assert.strictEqual(enfa.type, 'ENFA');
  });

  test('applyAddTransition rejects duplicates and out-of-spec labels', () => {
    const dfa = createBaseDFA();
    assert.throws(() => applyAddTransition(dfa, 'q0', 'q1', 'a'), ValidationError); // duplicate
    assert.throws(() => applyAddTransition(dfa, 'q0', 'q1', 'ab'), ValidationError); // multi-char
    assert.throws(() => applyAddTransition(dfa, 'q0', 'q1', '#'), ValidationError); // invalid char
  });

  test('applyDeleteTransition deletes transition but keeps alphabet intact', () => {
    const dfa = createBaseDFA();
    const updated = applyDeleteTransition(dfa, 'q0', 'q1', 'a');

    validateAutomaton(updated);
    assert.strictEqual(updated.transitions.length, 0);
    assert.deepStrictEqual(updated.alphabet, ['a', 'b']); // alphabet is not automatically shrunk
  });

  test('applySetStartState sets startState', () => {
    const dfa = createBaseDFA();
    const updated = applySetStartState(dfa, 'q1');

    validateAutomaton(updated);
    assert.strictEqual(updated.startState, 'q1');
  });

  test('applyToggleAcceptState toggles state accept status', () => {
    const dfa = createBaseDFA();
    
    // Toggle accept OFF for q1
    const acceptOff = applyToggleAcceptState(dfa, 'q1');
    validateAutomaton(acceptOff);
    assert.deepStrictEqual(acceptOff.acceptStates, []);

    // Toggle accept ON for q0
    const acceptOn = applyToggleAcceptState(dfa, 'q0');
    validateAutomaton(acceptOn);
    assert.deepStrictEqual(acceptOn.acceptStates, ['q0', 'q1']);
  });

  test('Invalid-edit rejection: Deleting the only start state throws error', () => {
    const dfa = createBaseDFA();
    // Deleting q0 (the only startState) will result in startState pointing to a non-existent state,
    // which validateAutomaton will reject.
    assert.throws(() => applyDeleteState(dfa, 'q0'), ValidationError);
  });
});

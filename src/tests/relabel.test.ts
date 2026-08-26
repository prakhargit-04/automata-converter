import { test, describe } from 'node:test';
import assert from 'node:assert';
import { type Automaton } from '../lib/types.ts';
import { validateAutomaton, ValidationError } from '../lib/validator.ts';
import { relabelDFAToNFA } from '../lib/core/relabel.ts';

describe('DFA -> NFA Relabeling', () => {
  const baseDFA: Automaton = {
    type: 'DFA',
    states: ['q0', 'q1'],
    alphabet: ['a'],
    transitions: [{ from: 'q0', to: 'q1', label: 'a' }],
    startState: 'q0',
    acceptStates: ['q1']
  };

  test('relabels type to NFA while preserving all structure', () => {
    const result = relabelDFAToNFA(baseDFA);
    assert.strictEqual(result.type, 'NFA');
    assert.deepStrictEqual(result.states, baseDFA.states);
    assert.deepStrictEqual(result.alphabet, baseDFA.alphabet);
    assert.deepStrictEqual(result.transitions, baseDFA.transitions);
    assert.strictEqual(result.startState, baseDFA.startState);
    assert.deepStrictEqual(result.acceptStates, baseDFA.acceptStates);
  });

  test('does not mutate the original DFA object', () => {
    const snapshot = JSON.parse(JSON.stringify(baseDFA));
    relabelDFAToNFA(baseDFA);
    assert.deepStrictEqual(baseDFA, snapshot);
  });

  test('returns a genuinely new object, not shared references', () => {
    const result = relabelDFAToNFA(baseDFA);
    assert.notStrictEqual(result, baseDFA);
    assert.notStrictEqual(result.states, baseDFA.states);
    assert.notStrictEqual(result.alphabet, baseDFA.alphabet);
    assert.notStrictEqual(result.transitions, baseDFA.transitions);
    assert.notStrictEqual(result.acceptStates, baseDFA.acceptStates);

    // Mutate the result's arrays directly and confirm the original is untouched
    result.states.push('q2');
    result.transitions.push({ from: 'q1', to: 'q0', label: 'a' });
    assert.strictEqual(baseDFA.states.length, 2);
    assert.strictEqual(baseDFA.transitions.length, 1);
  });

  test('throws ValidationError when input is not a DFA', () => {
    const nfa: Automaton = { ...baseDFA, type: 'NFA' };
    assert.throws(() => relabelDFAToNFA(nfa), ValidationError);

    const enfa: Automaton = { ...baseDFA, type: 'ENFA' };
    assert.throws(() => relabelDFAToNFA(enfa), ValidationError);
  });

  test('throws ValidationError on structurally invalid input rather than relabeling garbage', () => {
    const broken: Automaton = {
      ...baseDFA,
      startState: 'nonexistent-state'
    };
    assert.throws(() => relabelDFAToNFA(broken), ValidationError);
  });

  test('result passes validateAutomaton as a genuinely valid NFA', () => {
    const result = relabelDFAToNFA(baseDFA);
    assert.doesNotThrow(() => validateAutomaton(result));
  });

  test('relabeled NFA permits multiple transitions from the same (state, symbol) pair structurally', () => {
    // This just confirms the type tag no longer implies determinism —
    // the relabel function itself doesn't add transitions, but downstream
    // canvasAdapters.applyAddTransition should now allow a second one
    // from q0 on 'a' without demoting further (it's already 'NFA').
    const result = relabelDFAToNFA(baseDFA);
    assert.strictEqual(result.type, 'NFA');
  });
});
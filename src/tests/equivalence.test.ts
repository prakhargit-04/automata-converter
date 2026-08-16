import { test, describe } from 'node:test';
import assert from 'node:assert';
import { type Automaton } from '../lib/types.ts';
import { ValidationError } from '../lib/validator.ts';
import { tokenize } from '../lib/regex/lexer.ts';
import { Parser } from '../lib/regex/parser.ts';
import { compileASTToENFA } from '../lib/core/thompson.ts';
import { eliminateEpsilon } from '../lib/core/epsilonElimination.ts';
import { compileToDFA } from '../lib/core/subsetConstruction.ts';
import { minimizeDFA } from '../lib/core/minimization.ts';
import { areEquivalent } from '../lib/core/equivalence.ts';
import { simulateDFA } from '../lib/core/simulator.ts';

function compileRegexToDFA(input: string): Automaton {
  const tokens = tokenize(input);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const enfa = compileASTToENFA(ast);
  const nfa = eliminateEpsilon(enfa);
  return compileToDFA(nfa);
}

describe('DFA Language Equivalence Checks', () => {
  test('Equivalent DFAs (DFA and minimized DFA) return equivalent: true', () => {
    const dfa = compileRegexToDFA('(a|b)*abb');
    const minimized = minimizeDFA(dfa);

    const result = areEquivalent(dfa, minimized);
    assert.strictEqual(result.equivalent, true);
    assert.strictEqual(result.counterexample, undefined);
  });

  test('Differing DFAs return equivalent: false with a valid counterexample', () => {
    const dfaA = compileRegexToDFA('ab');
    const dfaB = compileRegexToDFA('ba');

    const result = areEquivalent(dfaA, dfaB);
    assert.strictEqual(result.equivalent, false);
    assert.ok(result.counterexample !== undefined);

    const counterexample = result.counterexample;
    // Verify that the counterexample produces different accept/reject results on each DFA via simulator
    const acceptA = simulateDFA(dfaA, counterexample).accepted;
    const acceptB = simulateDFA(dfaB, counterexample).accepted;
    assert.notStrictEqual(acceptA, acceptB, `Counterexample "${counterexample}" did not distinguish dfaA and dfaB.`);
  });

  test('Alphabet mismatch returns equivalent: false with a counterexample containing the unique symbol', () => {
    const dfaA = compileRegexToDFA('a'); // alphabet ['a']
    const dfaB = compileRegexToDFA('b'); // alphabet ['b']

    const result = areEquivalent(dfaA, dfaB);
    assert.strictEqual(result.equivalent, false);
    assert.ok(result.counterexample !== undefined);

    const counterexample = result.counterexample;
    // Verify counterexample contains unique symbols
    assert.ok(counterexample === 'a' || counterexample === 'b');
  });

  test('Reflexivity: areEquivalent(x, x) is true', () => {
    const dfa1 = compileRegexToDFA('a*|b*');
    const dfa2 = compileRegexToDFA('(ab)*');
    const dfa3 = compileRegexToDFA('a|b|c');

    assert.strictEqual(areEquivalent(dfa1, dfa1).equivalent, true);
    assert.strictEqual(areEquivalent(dfa2, dfa2).equivalent, true);
    assert.strictEqual(areEquivalent(dfa3, dfa3).equivalent, true);
  });

  test('Both-empty-language DFAs are equivalent', () => {
    const emptyA: Automaton = {
      type: 'DFA',
      states: ['q0'],
      alphabet: ['a'],
      transitions: [],
      startState: 'q0',
      acceptStates: []
    };
    const emptyB: Automaton = {
      type: 'DFA',
      states: ['A', 'B'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 'A', to: 'B', label: 'a' }
      ],
      startState: 'A',
      acceptStates: []
    };

    const result = areEquivalent(emptyA, emptyB);
    assert.strictEqual(result.equivalent, true);
  });

  test('Throws ValidationError if inputs are not DFAs', () => {
    const dfa = compileRegexToDFA('a');
    const nfa: Automaton = {
      type: 'NFA',
      states: ['q0'],
      alphabet: ['a'],
      transitions: [],
      startState: 'q0',
      acceptStates: []
    };

    assert.throws(() => areEquivalent(nfa, dfa), ValidationError);
    assert.throws(() => areEquivalent(dfa, nfa), ValidationError);
  });
});

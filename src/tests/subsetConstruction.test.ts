import { test, describe } from 'node:test';
import assert from 'node:assert';
import { type Automaton } from '../lib/types.ts';
import { validateAutomaton, ValidationError } from '../lib/validator.ts';
import { tokenize } from '../lib/regex/lexer.ts';
import { Parser } from '../lib/regex/parser.ts';
import { compileASTToENFA } from '../lib/core/thompson.ts';
import { eliminateEpsilon } from '../lib/core/epsilonElimination.ts';
import { compileToDFA } from '../lib/core/subsetConstruction.ts';
import { simulateNFA, simulateDFA } from '../lib/core/simulator.ts';

function compileRegexToNFA(input: string): Automaton {
  const tokens = tokenize(input);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const enfa = compileASTToENFA(ast);
  return eliminateEpsilon(enfa);
}

describe('Subset Construction - Structural Checks', () => {
  test('Subset reduction: NFA with N states produces DFA with fewer states', () => {
    // NFA states: A, B, C, D (4 states)
    // A -> B, C on 'a'
    // B -> D on 'a'
    // C -> D on 'a'
    const nfa: Automaton = {
      type: 'NFA',
      states: ['A', 'B', 'C', 'D'],
      alphabet: ['a'],
      transitions: [
        { from: 'A', to: 'B', label: 'a' },
        { from: 'A', to: 'C', label: 'a' },
        { from: 'B', to: 'D', label: 'a' },
        { from: 'C', to: 'D', label: 'a' }
      ],
      startState: 'A',
      acceptStates: ['D']
    };

    const dfa = compileToDFA(nfa);
    validateAutomaton(dfa);

    assert.strictEqual(dfa.type, 'DFA');
    // Resulting DFA states should be: A, B,C, D (3 states)
    assert.strictEqual(dfa.states.length, 3);
    assert.deepStrictEqual(dfa.states, ['A', 'B,C', 'D']);
  });

  test('Determinism: compileToDFA twice produces structurally identical DFAs', () => {
    const nfa = compileRegexToNFA('(a|b)*abb');
    const dfa1 = compileToDFA(nfa);
    const dfa2 = compileToDFA(nfa);

    assert.deepStrictEqual(dfa1, dfa2);
  });

  test('Non-total NFA produces correctly partial DFA (no auto-completion)', () => {
    // State D has no transitions on 'a'
    const nfa: Automaton = {
      type: 'NFA',
      states: ['A', 'B', 'C', 'D'],
      alphabet: ['a'],
      transitions: [
        { from: 'A', to: 'B', label: 'a' },
        { from: 'A', to: 'C', label: 'a' },
        { from: 'B', to: 'D', label: 'a' },
        { from: 'C', to: 'D', label: 'a' }
      ],
      startState: 'A',
      acceptStates: ['D']
    };

    const dfa = compileToDFA(nfa);
    validateAutomaton(dfa);

    // Verify D has no outgoing transition on 'a'
    const transitionFromD = dfa.transitions.find(t => t.from === 'D');
    assert.strictEqual(transitionFromD, undefined);
    assert.strictEqual(dfa.states.includes('TRAP'), false);
  });

  test('Multiple-accept-state NFA handles accept propagation correctly', () => {
    const nfa: Automaton = {
      type: 'NFA',
      states: ['q0', 'q1', 'q2'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 'q0', to: 'q1', label: 'a' },
        { from: 'q0', to: 'q2', label: 'b' }
      ],
      startState: 'q0',
      acceptStates: ['q1', 'q2']
    };

    const dfa = compileToDFA(nfa);
    validateAutomaton(dfa);

    assert.strictEqual(dfa.acceptStates.includes('q1'), true);
    assert.strictEqual(dfa.acceptStates.includes('q2'), true);
  });
});

describe('Subset Construction - End-to-End Equivalence', () => {
  function verifyDFAEquivalence(regexStr: string, testStrings: string[], outOfAlphabetStrings: string[]) {
    const nfa = compileRegexToNFA(regexStr);
    const dfa = compileToDFA(nfa);

    validateAutomaton(dfa);
    assert.strictEqual(dfa.type, 'DFA');

    // Verify identical simulation results
    for (const str of testStrings) {
      const nfaResult = simulateNFA(nfa, str);
      const dfaResult = simulateDFA(dfa, str);

      assert.strictEqual(
        dfaResult.accepted,
        nfaResult.accepted,
        `Simulation mismatch on "${str}" for regex "${regexStr}". NFA: ${nfaResult.accepted}, DFA: ${dfaResult.accepted}`
      );
    }

    // Verify validation errors are thrown on out-of-alphabet inputs
    for (const str of outOfAlphabetStrings) {
      assert.throws(() => simulateNFA(nfa, str), ValidationError);
      assert.throws(() => simulateDFA(dfa, str), ValidationError);
    }
  }

  // 1. "a"
  test('Equivalence on "a"', () => {
    verifyDFAEquivalence('a', ['a', '', 'aa'], ['b', 'c']);
  });

  // 2. "ε"
  test('Equivalence on "ε"', () => {
    verifyDFAEquivalence('ε', [''], ['a', 'b']);
  });

  // 3. "a|b"
  test('Equivalence on "a|b"', () => {
    verifyDFAEquivalence('a|b', ['a', 'b', '', 'ab', 'ba', 'aa'], ['c']);
  });

  // 4. "ab"
  test('Equivalence on "ab"', () => {
    verifyDFAEquivalence('ab', ['ab', 'a', 'b', '', 'aba'], ['c']);
  });

  // 5. "a*"
  test('Equivalence on "a*"', () => {
    verifyDFAEquivalence('a*', ['', 'a', 'aa', 'aaaa'], ['b', 'c']);
  });

  // 6. "a**"
  test('Equivalence on "a**"', () => {
    verifyDFAEquivalence('a**', ['', 'a', 'aaa', 'aaaaa'], ['b', 'c']);
  });

  // 7. "(a|b)*abb"
  test('Equivalence on "(a|b)*abb"', () => {
    verifyDFAEquivalence('(a|b)*abb', ['abb', 'ababb', 'bbabb', 'ab', 'abba', '', 'aa', 'bb'], ['c']);
  });

  // 8. "a*|b*"
  test('Equivalence on "a*|b*"', () => {
    verifyDFAEquivalence('a*|b*', ['', 'aaa', 'bbb', 'ab', 'ba', 'aab'], ['c']);
  });

  // 9. "(ab)*"
  test('Equivalence on "(ab)*"', () => {
    verifyDFAEquivalence('(ab)*', ['', 'ab', 'abab', 'a', 'aba', 'abb'], ['c']);
  });

  // 10. "a|b|c"
  test('Equivalence on "a|b|c"', () => {
    verifyDFAEquivalence('a|b|c', ['a', 'b', 'c', '', 'ab', 'ac', 'abc'], ['d']);
  });
});

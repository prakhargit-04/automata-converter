import { test, describe } from 'node:test';
import assert from 'node:assert';
import { type Automaton } from '../lib/types.ts';
import { validateAutomaton, ValidationError } from '../lib/validator.ts';
import { tokenize } from '../lib/regex/lexer.ts';
import { Parser } from '../lib/regex/parser.ts';
import { compileASTToENFA } from '../lib/core/thompson.ts';
import { eliminateEpsilon } from '../lib/core/epsilonElimination.ts';
import { compileToDFA } from '../lib/core/subsetConstruction.ts';
import { minimizeDFA } from '../lib/core/minimization.ts';
import { simulateDFA } from '../lib/core/simulator.ts';
import { completeDFA } from '../lib/core/primitives.ts';

function compileRegexToDFA(input: string): Automaton {
  const tokens = tokenize(input);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const enfa = compileASTToENFA(ast);
  const nfa = eliminateEpsilon(enfa);
  return compileToDFA(nfa);
}

describe('DFA Minimization - Textbook case and Unreachable states', () => {
  /**
   * Myhill-Nerode Derivation for (a|b)*abb over Alphabet {a, b}:
   * Suffix progress classes:
   * 1. S_0 (no progress towards "abb"): transitions: on 'a' -> S_a, on 'b' -> S_0
   * 2. S_a (ends in 'a'): transitions: on 'a' -> S_a, on 'b' -> S_ab
   * 3. S_ab (ends in 'ab'): transitions: on 'a' -> S_a, on 'b' -> S_abb
   * 4. S_abb (ends in 'abb' - Accept): transitions: on 'a' -> S_a, on 'b' -> S_0
   *
   * All 8 state-symbol transitions are fully defined. The minimal DFA is naturally total and
   * has exactly 4 states. No trap state is added.
   */
  test('Textbook case (a|b)*abb converges to exactly 4 states', () => {
    const dfa = compileRegexToDFA('(a|b)*abb');
    const minimized = minimizeDFA(dfa);

    validateAutomaton(minimized);
    assert.strictEqual(minimized.type, 'DFA');
    assert.strictEqual(minimized.states.length, 4);

    // Let's assert the behavior on "abb" is accepted
    assert.strictEqual(simulateDFA(minimized, 'abb').accepted, true);
    assert.strictEqual(simulateDFA(minimized, 'ababb').accepted, true);
    assert.strictEqual(simulateDFA(minimized, 'ab').accepted, false);
  });

  test('BFS reachability filter prunes unreachable states strictly before partitioning', () => {
    // DFA with unreachable states U1 and U2
    // Reachable portion: A --a--> B --a--> C --a--> C
    // Unreachable portion: U1 --a--> U2 --a--> U2
    // Accept states: C, U1
    const dfaWithUnreachable: Automaton = {
      type: 'DFA',
      states: ['A', 'B', 'C', 'U1', 'U2'],
      alphabet: ['a'],
      transitions: [
        { from: 'A', to: 'B', label: 'a' },
        { from: 'B', to: 'C', label: 'a' },
        { from: 'C', to: 'C', label: 'a' },
        { from: 'U1', to: 'U2', label: 'a' },
        { from: 'U2', to: 'U2', label: 'a' }
      ],
      startState: 'A',
      acceptStates: ['C', 'U1']
    };

    const minimized = minimizeDFA(dfaWithUnreachable);
    validateAutomaton(minimized);

    // Assert that unreachable states U1 and U2 are completely removed
    assert.strictEqual(minimized.states.length, 3);
    assert.deepStrictEqual(minimized.states, ['A', 'B', 'C']);
    assert.strictEqual(minimized.states.includes('U1'), false);
    assert.strictEqual(minimized.states.includes('U2'), false);
  });

  test('Already-minimal DFA remains unchanged in size', () => {
    const dfa = compileRegexToDFA('a'); // minimal DFA for "a" has 2 states (start, accept) + 1 trap state = 3 states
    const completed = completeDFA(dfa);
    const minimized = minimizeDFA(dfa);

    validateAutomaton(minimized);
    assert.strictEqual(minimized.states.length, completed.states.length);
  });
});

describe('DFA Minimization - End-to-End Equivalence and Total verification', () => {
  function verifyMinimization(regexStr: string, testStrings: string[], outOfAlphabetStrings: string[]) {
    const dfa = compileRegexToDFA(regexStr);
    const completed = completeDFA(dfa);
    const minimized = minimizeDFA(dfa);

    validateAutomaton(minimized);
    assert.strictEqual(minimized.type, 'DFA');
    assert.ok(minimized.states.length <= completed.states.length);

    // Verify output is a TOTAL DFA (i.e. every state has exactly one transition for every symbol)
    for (const state of minimized.states) {
      for (const symbol of minimized.alphabet) {
        const count = minimized.transitions.filter(t => t.from === state && t.label === symbol).length;
        assert.strictEqual(count, 1, `State "${state}" lacks or has duplicate transitions for "${symbol}" in minimized DFA.`);
      }
    }

    // Verify identical simulation results
    for (const str of testStrings) {
      const dfaResult = simulateDFA(dfa, str);
      const minResult = simulateDFA(minimized, str);

      assert.strictEqual(
        minResult.accepted,
        dfaResult.accepted,
        `Simulation mismatch on "${str}" for regex "${regexStr}". Original DFA: ${dfaResult.accepted}, Minimized DFA: ${minResult.accepted}`
      );
    }

    // Verify out-of-alphabet validation error still behaves identically
    for (const str of outOfAlphabetStrings) {
      assert.throws(() => simulateDFA(dfa, str), ValidationError);
      assert.throws(() => simulateDFA(minimized, str), ValidationError);
    }
  }

  // 1. "a"
  test('Equivalence on "a"', () => {
    verifyMinimization('a', ['a', '', 'aa'], ['b', 'c']);
  });

  // 2. "ε"
  test('Equivalence on "ε"', () => {
    verifyMinimization('ε', [''], ['a', 'b']);
  });

  // 3. "a|b"
  test('Equivalence on "a|b"', () => {
    verifyMinimization('a|b', ['a', 'b', '', 'ab', 'ba', 'aa'], ['c']);
  });

  // 4. "ab"
  test('Equivalence on "ab"', () => {
    verifyMinimization('ab', ['ab', 'a', 'b', '', 'aba'], ['c']);
  });

  // 5. "a*"
  test('Equivalence on "a*"', () => {
    verifyMinimization('a*', ['', 'a', 'aa', 'aaaa'], ['b', 'c']);
  });

  // 6. "a**"
  test('Equivalence on "a**"', () => {
    verifyMinimization('a**', ['', 'a', 'aaa', 'aaaaa'], ['b', 'c']);
  });

  // 7. "(a|b)*abb"
  test('Equivalence on "(a|b)*abb"', () => {
    verifyMinimization('(a|b)*abb', ['abb', 'ababb', 'bbabb', 'ab', 'abba', '', 'aa', 'bb'], ['c']);
  });

  // 8. "a*|b*"
  test('Equivalence on "a*|b*"', () => {
    verifyMinimization('a*|b*', ['', 'aaa', 'bbb', 'ab', 'ba', 'aab'], ['c']);
  });

  // 9. "(ab)*"
  test('Equivalence on "(ab)*"', () => {
    verifyMinimization('(ab)*', ['', 'ab', 'abab', 'a', 'aba', 'abb'], ['c']);
  });

  // 10. "a|b|c"
  test('Equivalence on "a|b|c"', () => {
    verifyMinimization('a|b|c', ['a', 'b', 'c', '', 'ab', 'ac', 'abc'], ['d']);
  });
});

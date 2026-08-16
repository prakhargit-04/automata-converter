import { test, describe } from 'node:test';
import assert from 'node:assert';
import { EPSILON } from '../lib/types.ts';
import { validateAutomaton, ValidationError } from '../lib/validator.ts';
import { tokenize } from '../lib/regex/lexer.ts';
import { Parser } from '../lib/regex/parser.ts';
import { compileASTToENFA } from '../lib/core/thompson.ts';
import { eliminateEpsilon } from '../lib/core/epsilonElimination.ts';
import { simulateENFA, simulateNFA } from '../lib/core/simulator.ts';

function compileRegexToENFA(input: string) {
  const tokens = tokenize(input);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  return compileASTToENFA(ast);
}

describe('Epsilon Elimination - Structural Checks', () => {
  test('eliminateEpsilon output type is NFA and has no EPSILON transitions', () => {
    const enfa = compileRegexToENFA('a|b');
    const nfa = eliminateEpsilon(enfa);

    // 1. Confirm output type is 'NFA'
    assert.strictEqual(nfa.type, 'NFA');

    // 2. Confirm there are absolutely zero epsilon transitions in the output
    const epsilonTransitions = nfa.transitions.filter(t => t.label === EPSILON);
    assert.strictEqual(epsilonTransitions.length, 0);

    // 3. Confirm that the output validates cleanly
    validateAutomaton(nfa);
  });

  test('eliminateEpsilon output.states is identical to input.states (States-preserved)', () => {
    const enfa = compileRegexToENFA('(a|b)*abb');
    const nfa = eliminateEpsilon(enfa);

    // Confirm that states list is identical (length, elements, order)
    assert.strictEqual(nfa.states.length, enfa.states.length);
    assert.deepStrictEqual(nfa.states, enfa.states);
  });
});

describe('Epsilon Elimination - Language Equivalence Simulation', () => {
  // Test suite helper to check simulation equivalence on NFA and ENFA
  function verifyEquivalence(regexStr: string, testStrings: string[], outOfAlphabetStrings: string[]) {
    const enfa = compileRegexToENFA(regexStr);
    const nfa = eliminateEpsilon(enfa);

    validateAutomaton(nfa);
    assert.strictEqual(nfa.type, 'NFA');

    // Check same simulation results for in-alphabet test strings
    for (const str of testStrings) {
      const enfaResult = simulateENFA(enfa, str);
      const nfaResult = simulateNFA(nfa, str);

      assert.strictEqual(
        nfaResult.accepted,
        enfaResult.accepted,
        `Simulation mismatch on string "${str}" for regex "${regexStr}". ENFA: ${enfaResult.accepted}, NFA: ${nfaResult.accepted}`
      );
    }

    // Check that out-of-alphabet strings throw ValidationError on both NFA and ENFA
    for (const str of outOfAlphabetStrings) {
      assert.throws(() => simulateENFA(enfa, str), ValidationError);
      assert.throws(() => simulateNFA(nfa, str), ValidationError);
    }
  }

  // 1. "a"
  test('Equivalence on "a"', () => {
    verifyEquivalence('a', ['a', '', 'aa'], ['b', 'c']);
  });

  // 2. "ε"
  test('Equivalence on "ε"', () => {
    verifyEquivalence('ε', [''], ['a', 'b']);
  });

  // 3. "a|b"
  test('Equivalence on "a|b"', () => {
    verifyEquivalence('a|b', ['a', 'b', '', 'ab', 'ba', 'aa'], ['c']);
  });

  // 4. "ab"
  test('Equivalence on "ab"', () => {
    verifyEquivalence('ab', ['ab', 'a', 'b', '', 'aba'], ['c']);
  });

  // 5. "a*"
  test('Equivalence on "a*"', () => {
    verifyEquivalence('a*', ['', 'a', 'aa', 'aaaa'], ['b', 'c']);
  });

  // 6. "a**"
  test('Equivalence on "a**"', () => {
    verifyEquivalence('a**', ['', 'a', 'aaa', 'aaaaa'], ['b', 'c']);
  });

  // 7. "(a|b)*abb"
  test('Equivalence on "(a|b)*abb"', () => {
    verifyEquivalence('(a|b)*abb', ['abb', 'ababb', 'bbabb', 'ab', 'abba', '', 'aa', 'bb'], ['c']);
  });

  // 8. "a*|b*"
  test('Equivalence on "a*|b*"', () => {
    verifyEquivalence('a*|b*', ['', 'aaa', 'bbb', 'ab', 'ba', 'aab'], ['c']);
  });

  // 9. "(ab)*"
  test('Equivalence on "(ab)*"', () => {
    verifyEquivalence('(ab)*', ['', 'ab', 'abab', 'a', 'aba', 'abb'], ['c']);
  });

  // 10. "a|b|c"
  test('Equivalence on "a|b|c"', () => {
    verifyEquivalence('a|b|c', ['a', 'b', 'c', '', 'ab', 'ac', 'abc'], ['d']);
  });
});

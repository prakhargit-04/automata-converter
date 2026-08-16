import { test, describe } from 'node:test';
import assert from 'node:assert';
import { type Automaton } from '../lib/types.ts';
import { validateAutomaton } from '../lib/validator.ts';
import { tokenize } from '../lib/regex/lexer.ts';
import { Parser } from '../lib/regex/parser.ts';
import { compileASTToENFA } from '../lib/core/thompson.ts';
import { eliminateEpsilon } from '../lib/core/epsilonElimination.ts';
import { compileToDFA } from '../lib/core/subsetConstruction.ts';
import { generateRegex, EMPTY_LANGUAGE_REGEX } from '../lib/core/stateElimination.ts';
import { areEquivalent } from '../lib/core/equivalence.ts';

/**
 * Round-trip helper that generates a regex, parses it, and compiles it back.
 * Bypasses the tokenize()/Parser step if the result is EMPTY_LANGUAGE_REGEX ('∅'),
 * directly constructing an empty NFA (which accepts no strings) to prevent LexerError.
 */
function roundTrip(automaton: Automaton): Automaton {
  const regexStr = generateRegex(automaton);
  
  if (regexStr === EMPTY_LANGUAGE_REGEX) {
    // Return a dummy empty-accept-state DFA as tokenizer/Parser does not support empty language
    return {
      type: 'DFA',
      states: ['q0'],
      alphabet: [...automaton.alphabet],
      transitions: [],
      startState: 'q0',
      acceptStates: []
    };
  }

  const tokens = tokenize(regexStr);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const enfa = compileASTToENFA(ast);
  const nfa = eliminateEpsilon(enfa);
  const dfa = compileToDFA(nfa);
  return dfa;
}

function compileRegexToDFA(input: string): Automaton {
  const tokens = tokenize(input);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const enfa = compileASTToENFA(ast);
  const nfa = eliminateEpsilon(enfa);
  return compileToDFA(nfa);
}

describe('Regex Generation - Structural and Trace Checks', () => {
  /**
   * Hand-Traced DFA State Elimination for DFA accepting ab*a:
   *
   * Input DFA:
   * - States: ['A', 'B', 'C']
   * - Alphabet: ['a', 'b']
   * - StartState: 'A'
   * - AcceptStates: ['C']
   * - Transitions:
   *   A --a--> B
   *   B --b--> B (self loop)
   *   B --a--> C
   *
   * Step 1: normalizeToGNFA(automaton)
   * - Unified start: GNFA_START
   * - Unified accept: GNFA_ACCEPT
   * - Initial GNFA Transitions:
   *   GNFA_START --ε--> A
   *   A --a--> B
   *   B --b--> B
   *   B --a--> C
   *   C --ε--> GNFA_ACCEPT
   * - States order to eliminate: ['A', 'B', 'C'] (based on input states list order)
   *
   * Step 2: Eliminate state 'A'
   * - Path through 'A': GNFA_START -> A -> B
   * - Transition GNFA_START --a--> B is added (concat(ε, a) -> a).
   * - State 'A' is removed.
   *
   * Step 3: Eliminate state 'B'
   * - Path through 'B': GNFA_START -> B -> C
   * - Self-loop on 'B' exists: B --b--> B (labeled 'b')
   * - Transition GNFA_START --ab*a--> C is added (concat(a, concat(b*, a)) -> ab*a).
   * - State 'B' is removed.
   *
   * Step 4: Eliminate state 'C'
   * - Path through 'C': GNFA_START -> C -> GNFA_ACCEPT
   * - Transition GNFA_START --ab*a--> GNFA_ACCEPT is added (concat(ab*a, ε) -> ab*a).
   * - State 'C' is removed.
   *
   * Resulting Regex should be: "ab*a"
   */
  test('Hand-built DFA for ab*a matches the manual elimination trace', () => {
    const dfa: Automaton = {
      type: 'DFA',
      states: ['A', 'B', 'C'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 'A', to: 'B', label: 'a' },
        { from: 'B', to: 'B', label: 'b' },
        { from: 'B', to: 'C', label: 'a' }
      ],
      startState: 'A',
      acceptStates: ['C']
    };

    const regex = generateRegex(dfa);
    assert.strictEqual(regex, 'ab*a');

    // Round-trip simulation verification
    const roundTripped = roundTrip(dfa);
    const eqResult = areEquivalent(dfa, roundTripped);
    assert.strictEqual(eqResult.equivalent, true);
  });

  test('Multi-accept-state NFA folds accepted states into unified GNFA_ACCEPT', () => {
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

    const regex = generateRegex(nfa);
    // Since q1 and q2 both transition to GNFA_ACCEPT via epsilon, the output is a union
    assert.ok(regex === 'a|b' || regex === 'b|a');

    const roundTripped = roundTrip(nfa);
    const originalDFA = compileToDFA(nfa);
    const eqResult = areEquivalent(originalDFA, roundTripped);
    assert.strictEqual(eqResult.equivalent, true);
  });

  test('Self-loop double-count check avoids double-counting loop state in transitions', () => {
    // eliminated state q1 has both self loop ('b') and separate normal in/out edges
    const nfa: Automaton = {
      type: 'NFA',
      states: ['q0', 'q1', 'q2'],
      alphabet: ['a', 'b', 'c'],
      transitions: [
        { from: 'q0', to: 'q1', label: 'a' },
        { from: 'q1', to: 'q1', label: 'b' },
        { from: 'q1', to: 'q2', label: 'c' }
      ],
      startState: 'q0',
      acceptStates: ['q2']
    };

    const regex = generateRegex(nfa);
    assert.strictEqual(regex, 'ab*c');

    const roundTripped = roundTrip(nfa);
    const originalDFA = compileToDFA(nfa);
    const eqResult = areEquivalent(originalDFA, roundTripped);
    assert.strictEqual(eqResult.equivalent, true);
  });

  test('Parenthesization stress test handles nested precedence correctly', () => {
    // Hand-built DFA representing (a|b)* directly:
    // Single state q0 with self-loops on 'a' and 'b', which is accepting.
    const dfa: Automaton = {
      type: 'DFA',
      states: ['q0'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 'q0', to: 'q0', label: 'a' },
        { from: 'q0', to: 'q0', label: 'b' }
      ],
      startState: 'q0',
      acceptStates: ['q0']
    };

    const regex = generateRegex(dfa);

    // Verify it parenthesizes the union before starring, yielding exactly "(a|b)*" or "(b|a)*"
    assert.ok(regex === '(a|b)*' || regex === '(b|a)*');

    const roundTripped = roundTrip(dfa);
    const eqResult = areEquivalent(dfa, roundTripped);
    assert.strictEqual(eqResult.equivalent, true);
  });

  test('Empty-language test returns EMPTY_LANGUAGE_REGEX and round-trips correctly', () => {
    // Automaton with no reachable accept states
    const emptyAutomaton: Automaton = {
      type: 'DFA',
      states: ['q0', 'q1'],
      alphabet: ['a'],
      transitions: [
        { from: 'q0', to: 'q1', label: 'a' }
      ],
      startState: 'q0',
      acceptStates: [] // empty
    };

    const regex = generateRegex(emptyAutomaton);
    assert.strictEqual(regex, EMPTY_LANGUAGE_REGEX);

    const roundTripped = roundTrip(emptyAutomaton);
    validateAutomaton(roundTripped);
    const eqResult = areEquivalent(emptyAutomaton, roundTripped);
    assert.strictEqual(eqResult.equivalent, true);
  });
});

describe('Regex Generation - End-to-End Equivalence', () => {
  function verifyRoundTrip(regexStr: string) {
    const dfa = compileRegexToDFA(regexStr);
    const roundTripped = roundTrip(dfa);

    validateAutomaton(roundTripped);
    assert.strictEqual(roundTripped.type, 'DFA');

    const eqResult = areEquivalent(dfa, roundTripped);
    assert.strictEqual(
      eqResult.equivalent,
      true,
      `Expected original and round-tripped automata to be equivalent for regex "${regexStr}". Counterexample: ${eqResult.counterexample}`
    );
  }

  // 1. "a"
  test('Equivalence on "a"', () => {
    verifyRoundTrip('a');
  });

  // 2. "ε"
  test('Equivalence on "ε"', () => {
    verifyRoundTrip('ε');
  });

  // 3. "a|b"
  test('Equivalence on "a|b"', () => {
    verifyRoundTrip('a|b');
  });

  // 4. "ab"
  test('Equivalence on "ab"', () => {
    verifyRoundTrip('ab');
  });

  // 5. "a*"
  test('Equivalence on "a*"', () => {
    verifyRoundTrip('a*');
  });

  // 6. "a**"
  test('Equivalence on "a**"', () => {
    verifyRoundTrip('a**');
  });

  // 7. "(a|b)*abb"
  test('Equivalence on "(a|b)*abb"', () => {
    verifyRoundTrip('(a|b)*abb');
  });

  // 8. "a*|b*"
  test('Equivalence on "a*|b*"', () => {
    verifyRoundTrip('a*|b*');
  });

  // 9. "(ab)*"
  test('Equivalence on "(ab)*"', () => {
    verifyRoundTrip('(ab)*');
  });

  // 10. "a|b|c"
  test('Equivalence on "a|b|c"', () => {
    verifyRoundTrip('a|b|c');
  });
});

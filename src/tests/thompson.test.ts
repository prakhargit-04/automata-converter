import { test, describe } from 'node:test';
import assert from 'node:assert';
import { EPSILON, type Automaton } from '../lib/types.ts';
import { validateAutomaton, ValidationError } from '../lib/validator.ts';
import { tokenize } from '../lib/regex/lexer.ts';
import { Parser } from '../lib/regex/parser.ts';
import {
  createStateGenerator,
  compileLiteral,
  compileEpsilon,
  compileConcat,
  compileUnion,
  compileStar,
  compileASTToENFA
} from '../lib/core/thompson.ts';
import { simulateENFA } from '../lib/core/simulator.ts';

function compileRegex(input: string): Automaton {
  const tokens = tokenize(input);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  return compileASTToENFA(ast);
}

describe('Thompson Construction Primitives - Structural Checks', () => {
  test('compileLiteral produces correct structure', () => {
    const nextState = createStateGenerator();
    const frag = compileLiteral('a', nextState);
    
    assert.strictEqual(frag.states.length, 2);
    assert.strictEqual(frag.transitions.length, 1);
    assert.deepStrictEqual(frag.alphabet, ['a']);
    assert.strictEqual(frag.startState, 'q0');
    assert.strictEqual(frag.acceptState, 'q1');
    assert.deepStrictEqual(frag.transitions[0], { from: 'q0', to: 'q1', label: 'a' });
  });

  test('compileEpsilon produces correct structure', () => {
    const nextState = createStateGenerator();
    const frag = compileEpsilon(nextState);

    assert.strictEqual(frag.states.length, 2);
    assert.strictEqual(frag.transitions.length, 1);
    assert.deepStrictEqual(frag.alphabet, []);
    assert.strictEqual(frag.startState, 'q0');
    assert.strictEqual(frag.acceptState, 'q1');
    assert.deepStrictEqual(frag.transitions[0], { from: 'q0', to: 'q1', label: EPSILON });
  });

  test('compileConcat produces correct structure', () => {
    const nextState = createStateGenerator();
    const left = compileLiteral('a', nextState);
    const right = compileLiteral('b', nextState);
    const frag = compileConcat(left, right);

    // Concat states = left.states + right.states
    assert.strictEqual(frag.states.length, 4);
    // Concat transitions = left.transitions + right.transitions + 1 epsilon transition
    assert.strictEqual(frag.transitions.length, 3);
    assert.deepStrictEqual(frag.alphabet, ['a', 'b']);
    assert.strictEqual(frag.startState, left.startState);
    assert.strictEqual(frag.acceptState, right.acceptState);

    // Verify connecting epsilon transition
    const conn = frag.transitions.find(t => t.from === left.acceptState && t.to === right.startState);
    assert.ok(conn);
    assert.strictEqual(conn?.label, EPSILON);
  });

  test('compileUnion produces correct structure', () => {
    const nextState = createStateGenerator();
    const left = compileLiteral('a', nextState);
    const right = compileLiteral('b', nextState);
    const frag = compileUnion(left, right, nextState);

    // Union states = left.states + right.states + 2 (new start, new accept)
    assert.strictEqual(frag.states.length, 6);
    // Union transitions = left.transitions + right.transitions + 4 epsilon transitions
    assert.strictEqual(frag.transitions.length, 6);
    assert.deepStrictEqual(frag.alphabet, ['a', 'b']);
    assert.strictEqual(frag.startState, 'q4');
    assert.strictEqual(frag.acceptState, 'q5');

    // Verify incoming epsilon branches from new start
    assert.ok(frag.transitions.some(t => t.from === frag.startState && t.to === left.startState && t.label === EPSILON));
    assert.ok(frag.transitions.some(t => t.from === frag.startState && t.to === right.startState && t.label === EPSILON));

    // Verify outgoing epsilon branches to new accept
    assert.ok(frag.transitions.some(t => t.from === left.acceptState && t.to === frag.acceptState && t.label === EPSILON));
    assert.ok(frag.transitions.some(t => t.from === right.acceptState && t.to === frag.acceptState && t.label === EPSILON));
  });

  test('compileStar produces correct structure', () => {
    const nextState = createStateGenerator();
    const expr = compileLiteral('a', nextState);
    const frag = compileStar(expr, nextState);

    // Star states = expr.states + 2 (new start, new accept)
    assert.strictEqual(frag.states.length, 4);
    // Star transitions = expr.transitions + 4 epsilon transitions
    assert.strictEqual(frag.transitions.length, 5);
    assert.deepStrictEqual(frag.alphabet, ['a']);
    assert.strictEqual(frag.startState, 'q2');
    assert.strictEqual(frag.acceptState, 'q3');

    // Verify epsilon transitions
    assert.ok(frag.transitions.some(t => t.from === frag.startState && t.to === expr.startState && t.label === EPSILON));
    assert.ok(frag.transitions.some(t => t.from === frag.startState && t.to === frag.acceptState && t.label === EPSILON));
    assert.ok(frag.transitions.some(t => t.from === expr.acceptState && t.to === expr.startState && t.label === EPSILON));
    assert.ok(frag.transitions.some(t => t.from === expr.acceptState && t.to === frag.acceptState && t.label === EPSILON));
  });
});

describe('Thompson Construction - End-to-End Equivalence & Simulation', () => {
  // Test case 1: "a"
  test('Regex 1: "a"', () => {
    const automaton = compileRegex('a');
    validateAutomaton(automaton);
    assert.strictEqual(simulateENFA(automaton, 'a').accepted, true);
    assert.strictEqual(simulateENFA(automaton, '').accepted, false);
    assert.strictEqual(simulateENFA(automaton, 'aa').accepted, false);
    assert.throws(() => simulateENFA(automaton, 'b'), ValidationError);
  });

  // Test case 2: "ε"
  test('Regex 2: "ε"', () => {
    const automaton = compileRegex('ε');
    validateAutomaton(automaton);
    assert.strictEqual(simulateENFA(automaton, '').accepted, true);
    assert.throws(() => simulateENFA(automaton, 'a'), ValidationError);
  });

  // Test case 3: "a|b"
  test('Regex 3: "a|b"', () => {
    const automaton = compileRegex('a|b');
    validateAutomaton(automaton);
    assert.strictEqual(simulateENFA(automaton, 'a').accepted, true);
    assert.strictEqual(simulateENFA(automaton, 'b').accepted, true);
    assert.strictEqual(simulateENFA(automaton, '').accepted, false);
    assert.strictEqual(simulateENFA(automaton, 'ab').accepted, false);
  });

  // Test case 4: "ab"
  test('Regex 4: "ab"', () => {
    const automaton = compileRegex('ab');
    validateAutomaton(automaton);
    assert.strictEqual(simulateENFA(automaton, 'ab').accepted, true);
    assert.strictEqual(simulateENFA(automaton, 'a').accepted, false);
    assert.strictEqual(simulateENFA(automaton, 'b').accepted, false);
  });

  // Test case 5: "a*"
  test('Regex 5: "a*"', () => {
    const automaton = compileRegex('a*');
    validateAutomaton(automaton);
    assert.strictEqual(simulateENFA(automaton, '').accepted, true);
    assert.strictEqual(simulateENFA(automaton, 'a').accepted, true);
    assert.strictEqual(simulateENFA(automaton, 'aaaa').accepted, true);
    assert.throws(() => simulateENFA(automaton, 'b'), ValidationError);
  });

  // Test case 6: "a**"
  test('Regex 6: "a**"', () => {
    const automaton = compileRegex('a**');
    validateAutomaton(automaton);
    assert.strictEqual(simulateENFA(automaton, '').accepted, true);
    assert.strictEqual(simulateENFA(automaton, 'a').accepted, true);
    assert.strictEqual(simulateENFA(automaton, 'aaa').accepted, true);
    assert.throws(() => simulateENFA(automaton, 'b'), ValidationError);
  });

  // Test case 7: "(a|b)*abb" (Nesting star inside concat inside union)
  test('Regex 7: "(a|b)*abb"', () => {
    const automaton = compileRegex('(a|b)*abb');
    validateAutomaton(automaton);

    // 1. Verify no state name collisions (uniqueness of state names)
    assert.strictEqual(new Set(automaton.states).size, automaton.states.length);

    // 2. Simulation checks
    assert.strictEqual(simulateENFA(automaton, 'abb').accepted, true);
    assert.strictEqual(simulateENFA(automaton, 'ababb').accepted, true);
    assert.strictEqual(simulateENFA(automaton, 'bbabb').accepted, true);
    assert.strictEqual(simulateENFA(automaton, 'ab').accepted, false);
    assert.strictEqual(simulateENFA(automaton, 'abba').accepted, false);
    assert.strictEqual(simulateENFA(automaton, '').accepted, false);
  });

  // Test case 8: "a*|b*"
  test('Regex 8: "a*|b*"', () => {
    const automaton = compileRegex('a*|b*');
    validateAutomaton(automaton);
    assert.strictEqual(simulateENFA(automaton, '').accepted, true);
    assert.strictEqual(simulateENFA(automaton, 'aaa').accepted, true);
    assert.strictEqual(simulateENFA(automaton, 'bbb').accepted, true);
    assert.strictEqual(simulateENFA(automaton, 'ab').accepted, false);
    assert.strictEqual(simulateENFA(automaton, 'ba').accepted, false);
  });

  // Test case 9: "(ab)*"
  test('Regex 9: "(ab)*"', () => {
    const automaton = compileRegex('(ab)*');
    validateAutomaton(automaton);
    assert.strictEqual(simulateENFA(automaton, '').accepted, true);
    assert.strictEqual(simulateENFA(automaton, 'ab').accepted, true);
    assert.strictEqual(simulateENFA(automaton, 'abab').accepted, true);
    assert.strictEqual(simulateENFA(automaton, 'a').accepted, false);
    assert.strictEqual(simulateENFA(automaton, 'aba').accepted, false);
  });

  // Test case 10: "a|b|c"
  test('Regex 10: "a|b|c"', () => {
    const automaton = compileRegex('a|b|c');
    validateAutomaton(automaton);
    assert.strictEqual(simulateENFA(automaton, 'a').accepted, true);
    assert.strictEqual(simulateENFA(automaton, 'b').accepted, true);
    assert.strictEqual(simulateENFA(automaton, 'c').accepted, true);
    assert.strictEqual(simulateENFA(automaton, '').accepted, false);
    assert.strictEqual(simulateENFA(automaton, 'ab').accepted, false);
  });
});

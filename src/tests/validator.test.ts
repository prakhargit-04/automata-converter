import { test, describe } from 'node:test';
import assert from 'node:assert';
import { validateAutomaton, ValidationError } from '../lib/validator.ts';
import { createStateAllocator } from '../lib/automata.ts';
import { type Automaton } from '../lib/types.ts';

describe('createStateAllocator', () => {
  test('allocates sequential numeric state IDs', () => {
    const nextState = createStateAllocator();
    assert.strictEqual(nextState(), 0);
    assert.strictEqual(nextState(), 1);
    assert.strictEqual(nextState(), 2);
  });

  test('allocates sequential numeric state IDs starting from custom startId', () => {
    const nextState = createStateAllocator(10);
    assert.strictEqual(nextState(), 10);
    assert.strictEqual(nextState(), 11);
  });

  test('creates independent allocators without global state leakage', () => {
    const allocator1 = createStateAllocator();
    const allocator2 = createStateAllocator(100);
    assert.strictEqual(allocator1(), 0);
    assert.strictEqual(allocator2(), 100);
    assert.strictEqual(allocator1(), 1);
    assert.strictEqual(allocator2(), 101);
  });
});

describe('validateAutomaton', () => {
  test('should validate a valid DFA successfully', () => {
    const validDFA: Automaton = {
      type: 'DFA',
      states: ['A', 'B'],
      alphabet: ['a', 'b'],
      transitions: [
        { from: 'A', to: 'B', label: 'a' },
        { from: 'B', to: 'A', label: 'b' }
      ],
      startState: 'A',
      acceptStates: ['B']
    };
    assert.doesNotThrow(() => validateAutomaton(validDFA));
  });

  test('should validate a valid NFA with multiple transitions on same symbol successfully', () => {
    const validNFA: Automaton = {
      type: 'NFA',
      states: ['0', '1'],
      alphabet: ['a'],
      transitions: [
        { from: '0', to: '0', label: 'a' },
        { from: '0', to: '1', label: 'a' }
      ],
      startState: '0',
      acceptStates: ['1']
    };
    assert.doesNotThrow(() => validateAutomaton(validNFA));
  });

  test('should validate a valid ENFA with epsilon transitions successfully', () => {
    const validENFA: Automaton = {
      type: 'ENFA',
      states: ['0', '1'],
      alphabet: ['a'],
      transitions: [
        { from: '0', to: '1', label: 'ε' },
        { from: '1', to: '1', label: 'a' }
      ],
      startState: '0',
      acceptStates: ['1']
    };
    assert.doesNotThrow(() => validateAutomaton(validENFA));
  });

  test('should throw ValidationError if startState is not in states', () => {
    const invalidDFA: Automaton = {
      type: 'DFA',
      states: ['A', 'B'],
      alphabet: ['a'],
      transitions: [],
      startState: 'C',
      acceptStates: ['B']
    };
    assert.throws(() => validateAutomaton(invalidDFA), (err: unknown) => {
      return err instanceof ValidationError && err.message.includes('Start state "C" is not in the states list');
    });
  });

  test('should throw ValidationError if acceptState is not in states', () => {
    const invalidDFA: Automaton = {
      type: 'DFA',
      states: ['A', 'B'],
      alphabet: ['a'],
      transitions: [],
      startState: 'A',
      acceptStates: ['C']
    };
    assert.throws(() => validateAutomaton(invalidDFA), (err: unknown) => {
      return err instanceof ValidationError && err.message.includes('Accept state "C" is not in the states list');
    });
  });

  test('should throw ValidationError if transition references non-existent from state', () => {
    const invalidDFA: Automaton = {
      type: 'DFA',
      states: ['A', 'B'],
      alphabet: ['a'],
      transitions: [{ from: 'C', to: 'B', label: 'a' }],
      startState: 'A',
      acceptStates: ['B']
    };
    assert.throws(() => validateAutomaton(invalidDFA), (err: unknown) => {
      return err instanceof ValidationError && err.message.includes('Transition source state "C" is not in the states list');
    });
  });

  test('should throw ValidationError if transition references non-existent to state', () => {
    const invalidDFA: Automaton = {
      type: 'DFA',
      states: ['A', 'B'],
      alphabet: ['a'],
      transitions: [{ from: 'A', to: 'C', label: 'a' }],
      startState: 'A',
      acceptStates: ['B']
    };
    assert.throws(() => validateAutomaton(invalidDFA), (err: unknown) => {
      return err instanceof ValidationError && err.message.includes('Transition target state "C" is not in the states list');
    });
  });

  test('should throw ValidationError if transition label is not in alphabet', () => {
    const invalidDFA: Automaton = {
      type: 'DFA',
      states: ['A', 'B'],
      alphabet: ['a'],
      transitions: [{ from: 'A', to: 'B', label: 'b' }],
      startState: 'A',
      acceptStates: ['B']
    };
    assert.throws(() => validateAutomaton(invalidDFA), (err: unknown) => {
      return err instanceof ValidationError && err.message.includes('Transition label "b" is not in the alphabet');
    });
  });

  test('should throw ValidationError if epsilon transition exists in DFA', () => {
    const invalidDFA: Automaton = {
      type: 'DFA',
      states: ['A', 'B'],
      alphabet: ['a'],
      transitions: [{ from: 'A', to: 'B', label: 'ε' }],
      startState: 'A',
      acceptStates: ['B']
    };
    assert.throws(() => validateAutomaton(invalidDFA), (err: unknown) => {
      return err instanceof ValidationError && err.message.includes('Epsilon transitions are not allowed in DFA automata');
    });
  });

  test('should throw ValidationError if epsilon transition exists in NFA', () => {
    const invalidNFA: Automaton = {
      type: 'NFA',
      states: ['A', 'B'],
      alphabet: ['a'],
      transitions: [{ from: 'A', to: 'B', label: 'ε' }],
      startState: 'A',
      acceptStates: ['B']
    };
    assert.throws(() => validateAutomaton(invalidNFA), (err: unknown) => {
      return err instanceof ValidationError && err.message.includes('Epsilon transitions are not allowed in NFA automata');
    });
  });

  test('should throw ValidationError if alphabet contains epsilon symbol', () => {
    const invalidDFA: Automaton = {
      type: 'DFA',
      states: ['A', 'B'],
      alphabet: ['a', 'ε'],
      transitions: [],
      startState: 'A',
      acceptStates: ['B']
    };
    assert.throws(() => validateAutomaton(invalidDFA), (err: unknown) => {
      return err instanceof ValidationError && err.message.includes('Alphabet cannot contain the epsilon symbol "ε"');
    });
  });

  test('should throw ValidationError if DFA is non-deterministic (duplicate label on same state)', () => {
    const invalidDFA: Automaton = {
      type: 'DFA',
      states: ['A', 'B', 'C'],
      alphabet: ['a'],
      transitions: [
        { from: 'A', to: 'B', label: 'a' },
        { from: 'A', to: 'C', label: 'a' }
      ],
      startState: 'A',
      acceptStates: ['B']
    };
    assert.throws(() => validateAutomaton(invalidDFA), (err: unknown) => {
      return err instanceof ValidationError && err.message.includes('DFA is non-deterministic: State "A" has multiple transitions for label "a"');
    });
  });

  test('should throw ValidationError if states are not unique', () => {
    const invalidDFA: Automaton = {
      type: 'DFA',
      states: ['A', 'A'],
      alphabet: ['a'],
      transitions: [],
      startState: 'A',
      acceptStates: ['A']
    };
    assert.throws(() => validateAutomaton(invalidDFA), (err: unknown) => {
      return err instanceof ValidationError && err.message.includes('Automaton states must be unique');
    });
  });

  test('should throw ValidationError if type is invalid', () => {
    const invalidTypeDFA = {
      type: 'INVALID',
      states: ['A', 'B'],
      alphabet: ['a'],
      transitions: [
        { from: 'A', to: 'B', label: 'a' },
        { from: 'A', to: 'B', label: 'a' }
      ],
      startState: 'A',
      acceptStates: ['B']
    } as unknown as Automaton;
    
    assert.throws(() => validateAutomaton(invalidTypeDFA), (err: unknown) => {
      return err instanceof ValidationError && err.message.includes('Invalid automaton type: "INVALID"');
    });
  });
});

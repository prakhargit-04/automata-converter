import { type Automaton, EPSILON } from '../types.ts';

/**
 * Moves from a set of states to a set of next states on a specific input symbol.
 *
 * Purity Contract:
 * - This function NEVER mutates the input `automaton` or `states` arguments.
 * - It always returns a new array of states.
 */
export function move(automaton: Automaton, states: string[], symbol: string): string[] {
  const result = new Set<string>();
  const transitions = automaton.transitions;

  for (const state of states) {
    for (const t of transitions) {
      if (t.from === state && t.label === symbol) {
        result.add(t.to);
      }
    }
  }

  return Array.from(result).sort();
}

/**
 * Computes the epsilon closure of a set of states.
 *
 * Purity Contract:
 * - This function NEVER mutates the input `automaton` or `states` arguments.
 * - It always returns a new array of states (even if identical to input states).
 */
export function epsilonClosure(automaton: Automaton, states: string[]): string[] {
  const closure = new Set<string>(states);
  const queue = [...states];
  const transitions = automaton.transitions;

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const t of transitions) {
      if (t.from === current && t.label === EPSILON) {
        if (!closure.has(t.to)) {
          closure.add(t.to);
          queue.push(t.to);
        }
      }
    }
  }

  return Array.from(closure).sort();
}

/**
 * Completes a DFA by adding a trap state and directing all missing transitions to it.
 *
 * Purity Contract:
 * - This function NEVER mutates the input `dfa` argument.
 * - It always returns a new Automaton object representing the completed DFA.
 */
export function completeDFA(dfa: Automaton): Automaton {
  const alphabet = dfa.alphabet;
  const missingTransitions: { from: string; label: string }[] = [];

  for (const state of dfa.states) {
    for (const symbol of alphabet) {
      const exists = dfa.transitions.some(t => t.from === state && t.label === symbol);
      if (!exists) {
        missingTransitions.push({ from: state, label: symbol });
      }
    }
  }

  // If there are no missing transitions, the DFA is already total
  if (missingTransitions.length === 0) {
    return {
      type: dfa.type,
      states: [...dfa.states],
      alphabet: [...dfa.alphabet],
      transitions: dfa.transitions.map(t => ({ ...t })),
      startState: dfa.startState,
      acceptStates: [...dfa.acceptStates]
    };
  }

  // Generate a unique trap state name to prevent conflicts
  let trapStateName = 'TRAP';
  let counter = 0;
  while (dfa.states.includes(trapStateName)) {
    trapStateName = `TRAP_${counter++}`;
  }

  const newStates = [...dfa.states, trapStateName];
  const newTransitions = dfa.transitions.map(t => ({ ...t }));

  for (const missing of missingTransitions) {
    newTransitions.push({
      from: missing.from,
      to: trapStateName,
      label: missing.label
    });
  }

  // Trap state must self-loop on all alphabet characters
  for (const symbol of alphabet) {
    newTransitions.push({
      from: trapStateName,
      to: trapStateName,
      label: symbol
    });
  }

  return {
    type: dfa.type,
    states: newStates,
    alphabet: [...dfa.alphabet],
    transitions: newTransitions,
    startState: dfa.startState,
    acceptStates: [...dfa.acceptStates]
  };
}

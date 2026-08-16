import { type Automaton } from '../types.ts';
import { validateAutomaton, ValidationError } from '../validator.ts';
import { completeDFA, move } from './primitives.ts';

export interface EquivalenceResult {
  equivalent: boolean;
  counterexample?: string;
}

/**
 * Deep copies an automaton and sets a combined alphabet.
 */
function deepCopyDFA(dfa: Automaton, newAlphabet: string[]): Automaton {
  return {
    type: 'DFA',
    states: [...dfa.states],
    alphabet: [...newAlphabet],
    transitions: dfa.transitions.map(t => ({ ...t })),
    startState: dfa.startState,
    acceptStates: [...dfa.acceptStates]
  };
}

/**
 * Determines whether two DFAs accept the same language.
 *
 * Algorithm details:
 * 1. Type validation: throw ValidationError if either input is not a DFA.
 * 2. Combined Alphabet: Merges both alphabets. To prevent move() from failing during BFS,
 *    we complete both DFAs against this combined alphabet first (using deep copies to preserve inputs).
 * 3. Product BFS: Performs a BFS on the product automaton state-pairs (s1, s2).
 *    A pair (s1, s2) is a distinguishing state if exactly one state is accepting.
 *    The path taken to reach this distinguishing state is returned as the counterexample.
 */
export function areEquivalent(dfaA: Automaton, dfaB: Automaton): EquivalenceResult {
  validateAutomaton(dfaA);
  validateAutomaton(dfaB);

  if (dfaA.type !== 'DFA') {
    throw new ValidationError(`Expected DFA for automaton A, but got: ${dfaA.type}`);
  }
  if (dfaB.type !== 'DFA') {
    throw new ValidationError(`Expected DFA for automaton B, but got: ${dfaB.type}`);
  }

  // Combined alphabet union
  const combinedAlphabet = Array.from(new Set([...dfaA.alphabet, ...dfaB.alphabet])).sort();

  // Explicit deep copy and pre-completion against the combined alphabet
  const copyA = deepCopyDFA(dfaA, combinedAlphabet);
  const copyB = deepCopyDFA(dfaB, combinedAlphabet);

  const completedA = completeDFA(copyA);
  const completedB = completeDFA(copyB);

  // BFS Queue over product state pairs (s1, s2)
  const queue: { s1: string; s2: string; path: string }[] = [];
  const visited = new Set<string>();

  const startA = completedA.startState;
  const startB = completedB.startState;

  queue.push({ s1: startA, s2: startB, path: '' });
  visited.add(`${startA},${startB}`);

  while (queue.length > 0) {
    const { s1, s2, path } = queue.shift()!;

    const isAcceptA = completedA.acceptStates.includes(s1);
    const isAcceptB = completedB.acceptStates.includes(s2);

    if (isAcceptA !== isAcceptB) {
      return {
        equivalent: false,
        counterexample: path
      };
    }

    for (const symbol of combinedAlphabet) {
      const nextA = move(completedA, [s1], symbol);
      const nextB = move(completedB, [s2], symbol);

      // Since completed DFAs are total, move is guaranteed to return exactly one state
      const dest1 = nextA[0];
      const dest2 = nextB[0];

      const key = `${dest1},${dest2}`;
      if (!visited.has(key)) {
        visited.add(key);
        queue.push({ s1: dest1, s2: dest2, path: path + symbol });
      }
    }
  }

  return { equivalent: true };
}

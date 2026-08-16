import { type Automaton, type Transition } from '../types.ts';
import { validateAutomaton, ValidationError } from '../validator.ts';
import { move } from './primitives.ts';

/**
 * Deterministically computes the DFA state name from a subset of NFA states.
 * Sorts state IDs alphabetically and joins them with commas (e.g. ["q0", "q2"] -> "q0,q2").
 */
function getDFAStateName(states: string[]): string {
  return [...states].sort().join(',');
}

/**
 * Compiles an NFA to a DFA using subset construction.
 *
 * Input contract:
 * - Must be an epsilon-free NFA.
 * - Uses ONLY the `move` primitive (no epsilonClosure).
 *
 * Completeness Policy (Option A):
 * - Do NOT call completeDFA() automatically inside this function. The output DFA may be partial —
 *   missing transitions where the underlying NFA had no reachable moves for some symbol from some subset —
 *   and that is a valid, expected, mathematically correct intermediate result representing the raw
 *   reachable-subsets graph. Completeness is a separate, explicit, opt-in step the caller applies
 *   later via completeDFA() from primitives.ts (Mission 3).
 * - Conflating subset construction and completion would hide dead-end structure from anyone
 *   inspecting the raw diagram, and would silently introduce a synthetic TRAP state into what should
 *   be a direct, traceable mapping from DFA states back to their originating NFA subsets.
 */
export function compileToDFA(nfa: Automaton): Automaton {
  validateAutomaton(nfa);
  if (nfa.type !== 'NFA') {
    throw new ValidationError(`Expected NFA automaton, but got: ${nfa.type}`);
  }

  const startSubset = [nfa.startState].sort();
  const startName = getDFAStateName(startSubset);

  const subsets: string[][] = [startSubset];
  const discoveredSubsets = new Set<string>([startName]);

  const dfaStates = new Set<string>([startName]);
  const dfaAcceptStates = new Set<string>();
  const dfaTransitions: Transition[] = [];

  let i = 0;
  while (i < subsets.length) {
    const currentSubset = subsets[i++];
    const currentName = getDFAStateName(currentSubset);

    // If the subset contains any NFA accept state, the DFA state is accepting
    const isAccepting = currentSubset.some(s => nfa.acceptStates.includes(s));
    if (isAccepting) {
      dfaAcceptStates.add(currentName);
    }

    for (const symbol of nfa.alphabet) {
      const nextSubset = move(nfa, currentSubset, symbol);
      
      // If the move yields an empty set, do not create a state or add a transition (partial DFA)
      if (nextSubset.length === 0) {
        continue;
      }

      const nextName = getDFAStateName(nextSubset);
      dfaTransitions.push({
        from: currentName,
        to: nextName,
        label: symbol
      });

      if (!discoveredSubsets.has(nextName)) {
        discoveredSubsets.add(nextName);
        dfaStates.add(nextName);
        subsets.push(nextSubset);
      }
    }
  }

  // Sort components deterministically to guarantee reproducible output formatting in tests
  const sortedStates = Array.from(dfaStates).sort();
  const sortedAcceptStates = Array.from(dfaAcceptStates).sort();
  dfaTransitions.sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    if (a.label !== b.label) return a.label.localeCompare(b.label);
    return a.to.localeCompare(b.to);
  });

  const dfa: Automaton = {
    type: 'DFA',
    states: sortedStates,
    alphabet: [...nfa.alphabet],
    transitions: dfaTransitions,
    startState: startName,
    acceptStates: sortedAcceptStates
  };

  validateAutomaton(dfa);
  return dfa;
}

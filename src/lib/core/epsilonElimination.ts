import { type Automaton, type Transition, EPSILON } from '../types.ts';
import { epsilonClosure } from './primitives.ts';
import { ValidationError } from '../validator.ts';

/**
 * Eliminates epsilon transitions from an ENFA to produce an NFA with the same language.
 *
 * Purity and Algorithm Constraints:
 * 1. The output's `states` array is IDENTICAL to the input's — states are never renamed, merged, or removed.
 * 2. For each state `s`: compute `epsilonClosure(enfa, [s])`. For every non-epsilon transition `(t, label, u)`
 *    where `t` is in the closure, add a direct transition `(s, label, u)`.
 * 3. Transitions are deduplicated to avoid duplicate identical edges.
 * 4. State `s` is an accept state in the output NFA iff `epsilonClosure(enfa, [s])` contains at least one
 *    of the input's original accept states.
 * 5. Output `type` is "NFA".
 */
export function eliminateEpsilon(enfa: Automaton): Automaton {
  if (enfa.type !== 'ENFA') {
    throw new ValidationError(`Expected ENFA automaton, but got: ${enfa.type}`);
  }

  const newTransitions: Transition[] = [];
  const newAcceptStatesSet = new Set<string>();

  // Use a string serialization set "from|label|to" for deduplication of transitions
  const seenTransitions = new Set<string>();

  for (const s of enfa.states) {
    const closure = epsilonClosure(enfa, [s]);

    // State s becomes an accept state in the output NFA iff its closure contains at least one original accept state
    for (const accept of enfa.acceptStates) {
      if (closure.includes(accept)) {
        newAcceptStatesSet.add(s);
        break;
      }
    }

    // Add direct transitions for any non-epsilon transition reachable from the closure
    for (const t of enfa.transitions) {
      if (t.label !== EPSILON && closure.includes(t.from)) {
        const transitionKey = `${s}|${t.label}|${t.to}`;
        if (!seenTransitions.has(transitionKey)) {
          seenTransitions.add(transitionKey);
          newTransitions.push({
            from: s,
            to: t.to,
            label: t.label
          });
        }
      }
    }
  }

  // Sort transitions to ensure a deterministic representation
  newTransitions.sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    if (a.label !== b.label) return a.label.localeCompare(b.label);
    return a.to.localeCompare(b.to);
  });

  return {
    type: 'NFA',
    states: [...enfa.states], // Identical states array
    alphabet: [...enfa.alphabet], // Identical alphabet array
    transitions: newTransitions,
    startState: enfa.startState,
    acceptStates: Array.from(newAcceptStatesSet).sort()
  };
}

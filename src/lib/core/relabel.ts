import { type Automaton } from '../types.ts';
import { validateAutomaton, ValidationError } from '../validator.ts';

/**
 * Relabels a DFA as an NFA, for manual editing in the Canvas Editor.
 *
 * Rationale: a DFA is formally a special case of an NFA (every DFA transition
 * function is already a valid, deterministic NFA transition relation). This
 * function exists purely to change the `type` tag so the automaton can be
 * loaded into contexts that expect NFA-permissive editing (e.g. the Canvas
 * Editor allows adding a second transition from the same (state, symbol) pair
 * without needing to pre-declare nondeterminism) — see canvasAdapters.ts's
 * one-way DFA->NFA->ENFA demotion ratchet, which this function front-loads
 * intentionally rather than waiting for the first qualifying edit to trigger it.
 *
 * Contract:
 * - Input MUST be a valid DFA. Throws ValidationError otherwise (either
 *   structurally invalid per validateAutomaton, or automaton.type !== 'DFA').
 * - Output is a NEW object — states, alphabet, transitions, acceptStates are
 *   all copied by value. The input automaton is never mutated.
 * - This is a ONE-WAY relabel. There is no relabelNFAToDFA — editing the
 *   result on the canvas may introduce genuine nondeterminism, at which point
 *   getting a real DFA back requires actual subset construction
 *   (compileToDFA, Mission 6), not a relabel. Do not assume this is symmetric.
 */
export function relabelDFAToNFA(automaton: Automaton): Automaton {
  validateAutomaton(automaton);

  if (automaton.type !== 'DFA') {
    throw new ValidationError(
      `relabelDFAToNFA requires a DFA input, but got type "${automaton.type}".`
    );
  }

  const relabeled: Automaton = {
    type: 'NFA',
    states: [...automaton.states],
    alphabet: [...automaton.alphabet],
    transitions: automaton.transitions.map(t => ({ ...t })),
    startState: automaton.startState,
    acceptStates: [...automaton.acceptStates]
  };

  validateAutomaton(relabeled);
  return relabeled;
}
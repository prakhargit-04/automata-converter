import { type Automaton, type Transition } from '../types.ts';
import { validateAutomaton, ValidationError } from '../validator.ts';
import { completeDFA } from './primitives.ts';

/**
 * Minimizes a DFA using partition refinement.
 *
 * Algorithm Workflow:
 * 1. Completeness Precondition: First, complete the DFA using completeDFA() so that every state has
 *    a transition for every symbol in the alphabet.
 * 2. Reachability Filter: Remove any states that are not reachable from the startState. This step runs
 *    STRICTLY BEFORE the initial {accept, non-accept} partition is built to ensure unreachable states
 *    do not pollute the refinement process.
 * 3. Partition Refinement: Initialize the partition with reachable accept states and reachable non-accept
 *    states. Repeatedly split blocks whose states transition to different blocks for some symbol.
 * 4. Deterministic Naming: Each minimized state is named by sorting and comma-joining the original
 *    (post-completion) state names in its corresponding stable block.
 * 5. Rebuild: Direct transitions between the block states based on the stable partition.
 */
export function minimizeDFA(dfa: Automaton): Automaton {
  validateAutomaton(dfa);
  if (dfa.type !== 'DFA') {
    throw new ValidationError(`Expected DFA automaton, but got: ${dfa.type}`);
  }

  // Step 1: Precondition - Complete the DFA
  const completedDFA = completeDFA(dfa);

  // Step 2: Reachability Filter - BFS from start state
  const reachable = new Set<string>([completedDFA.startState]);
  const queue = [completedDFA.startState];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const t of completedDFA.transitions) {
      if (t.from === current && !reachable.has(t.to)) {
        reachable.add(t.to);
        queue.push(t.to);
      }
    }
  }

  // Filter components to keep only reachable states
  const reachableStates = completedDFA.states.filter(s => reachable.has(s));
  const reachableTransitions = completedDFA.transitions.filter(
    t => reachable.has(t.from) && reachable.has(t.to)
  );
  const reachableAcceptStates = completedDFA.acceptStates.filter(s => reachable.has(s));

  // Step 3: Initial Partition strictly using reachable states
  const partition: string[][] = [];
  
  if (reachableAcceptStates.length > 0) {
    partition.push([...reachableAcceptStates].sort());
  }
  
  const initialNonAccept = reachableStates.filter(s => !reachableAcceptStates.includes(s));
  if (initialNonAccept.length > 0) {
    partition.push(initialNonAccept.sort());
  }

  // Partition Refinement Loop
  let changed = true;
  while (changed) {
    changed = false;
    for (let bIndex = 0; bIndex < partition.length; bIndex++) {
      const block = partition[bIndex];
      if (block.length <= 1) continue;

      for (const symbol of completedDFA.alphabet) {
        // Group states in the current block by the index of the block containing their transition target
        const groups = new Map<number, string[]>();
        for (const state of block) {
          const destTransition = reachableTransitions.find(
            t => t.from === state && t.label === symbol
          );
          // Since the completed DFA is total, every state-symbol transition is guaranteed to exist
          const dest = destTransition!.to;
          const destBlockIndex = partition.findIndex(b => b.includes(dest));
          
          if (!groups.has(destBlockIndex)) {
            groups.set(destBlockIndex, []);
          }
          groups.get(destBlockIndex)!.push(state);
        }

        if (groups.size > 1) {
          // Split block into separate blocks
          const newBlocks = Array.from(groups.values()).map(g => g.sort());
          partition.splice(bIndex, 1, ...newBlocks);
          changed = true;
          break; // Restart loop to split based on refined blocks
        }
      }
      if (changed) break;
    }
  }

  // Step 4 & 5: Rebuild the minimized DFA using stable partition blocks
  // Sort each block for deterministic naming consistency (e.g. "q0,q1")
  const blockNames = partition.map(block => [...block].sort().join(',')).sort();
  
  const minTransitions: Transition[] = [];
  const minAcceptStates: string[] = [];
  let minStartState = '';

  for (const block of partition) {
    const blockName = [...block].sort().join(',');
    
    // Check if start state belongs to this block
    if (block.includes(completedDFA.startState)) {
      minStartState = blockName;
    }

    // Check if accepting block (any element is in reachableAcceptStates)
    // Refinement only splits, so any block is either entirely accepting or entirely non-accepting
    if (block.some(s => reachableAcceptStates.includes(s))) {
      minAcceptStates.push(blockName);
    }

    // Add transitions for the block (use the first element of block as representative)
    const rep = block[0];
    for (const symbol of completedDFA.alphabet) {
      const destTransition = reachableTransitions.find(
        t => t.from === rep && t.label === symbol
      );
      const dest = destTransition!.to;
      const destBlock = partition.find(b => b.includes(dest))!;
      const destBlockName = [...destBlock].sort().join(',');

      minTransitions.push({
        from: blockName,
        to: destBlockName,
        label: symbol
      });
    }
  }

  // Sort components deterministically
  minAcceptStates.sort();
  minTransitions.sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    if (a.label !== b.label) return a.label.localeCompare(b.label);
    return a.to.localeCompare(b.to);
  });

  const minimizedDFA: Automaton = {
    type: 'DFA',
    states: blockNames,
    alphabet: [...completedDFA.alphabet],
    transitions: minTransitions,
    startState: minStartState,
    acceptStates: minAcceptStates
  };

  validateAutomaton(minimizedDFA);
  return minimizedDFA;
}

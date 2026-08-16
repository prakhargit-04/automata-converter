import { type NFA, EPSILON } from './automata.ts';

export interface DFA {
  startState: string; // We use comma separated ids as string for subset states
  acceptStates: string[];
  transitions: { from: string, to: string, label: string }[];
  states: string[];
  stateMapping: Record<string, number[]>; // Maps DFA state string to NFA state ids
}

// Compute epsilon closure for a set of states
export function epsilonClosure(nfa: NFA, states: number[]): number[] {
  const closure = new Set<number>(states);
  const stack = [...states];
  
  while (stack.length > 0) {
    const state = stack.pop()!;
    const epsTransitions = nfa.transitions.filter(t => t.from === state && t.label === EPSILON);
    for (const t of epsTransitions) {
      if (!closure.has(t.to)) {
        closure.add(t.to);
        stack.push(t.to);
      }
    }
  }
  return Array.from(closure).sort((a, b) => a - b);
}

// Find target states for a given set of states and an input symbol (excluding epsilon)
export function move(nfa: NFA, states: number[], symbol: string): number[] {
  const targetStates = new Set<number>();
  for (const state of states) {
    const transitions = nfa.transitions.filter(t => t.from === state && t.label === symbol);
    for (const t of transitions) {
      targetStates.add(t.to);
    }
  }
  return Array.from(targetStates).sort((a, b) => a - b);
}

export function getStateString(states: number[]): string {
  return states.join(',');
}

export function nfaToDfa(nfa: NFA): { dfa: DFA, steps: string[] } {
  const steps: string[] = [];
  const alphabet = Array.from(new Set(nfa.transitions.map(t => t.label).filter(l => l !== EPSILON))).sort();
  
  const startClosure = epsilonClosure(nfa, [nfa.startState]);
  const startStateStr = getStateString(startClosure);
  
  steps.push(`Start State Epsilon Closure: ${startStateStr}`);
  
  const dfa: DFA = {
    startState: startStateStr,
    acceptStates: [],
    transitions: [],
    states: [],
    stateMapping: {}
  };
  
  const unmarkedStates: string[] = [startStateStr];
  dfa.stateMapping[startStateStr] = startClosure;
  dfa.states.push(startStateStr);
  
  while (unmarkedStates.length > 0) {
    const currentStateStr = unmarkedStates.shift()!;
    const currentSet = dfa.stateMapping[currentStateStr];
    
    steps.push(`Processing DFA State {${currentStateStr}}`);
    
    // Check if accept state
    if (currentSet.includes(nfa.acceptState)) {
      if (!dfa.acceptStates.includes(currentStateStr)) {
        dfa.acceptStates.push(currentStateStr);
        steps.push(`  - {${currentStateStr}} is an Accept State`);
      }
    }
    
    for (const symbol of alphabet) {
      const moveSet = move(nfa, currentSet, symbol);
      if (moveSet.length === 0) continue; // No transition
      
      const closureSet = epsilonClosure(nfa, moveSet);
      const nextStateStr = getStateString(closureSet);
      
      steps.push(`  - On input '${symbol}': move to {${getStateString(moveSet)}}, epsilon closure -> {${nextStateStr}}`);
      
      dfa.transitions.push({
        from: currentStateStr,
        to: nextStateStr,
        label: symbol
      });
      
      if (!dfa.states.includes(nextStateStr)) {
        dfa.states.push(nextStateStr);
        dfa.stateMapping[nextStateStr] = closureSet;
        unmarkedStates.push(nextStateStr);
      }
    }
  }
  
  steps.push(`NFA to DFA conversion complete. Found ${dfa.states.length} states.`);
  return { dfa, steps };
}

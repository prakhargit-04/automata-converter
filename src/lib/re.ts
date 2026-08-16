import { type DFA } from './dfa.ts';
import { EPSILON } from './automata.ts';

interface GeneralizedTransition {
  from: string;
  to: string;
  regex: string;
}

function simplifyRegex(r1: string, r2: string, op: 'union' | 'concat'): string {
  if (op === 'union') {
    if (!r1) return r2;
    if (!r2) return r1;
    if (r1 === r2) return r1;
    if (r1 === EPSILON && r2 === EPSILON) return EPSILON;
    return `(${r1}|${r2})`;
  } else { // concat
    if (!r1 || !r2) return ''; // Should not happen directly in state elimination if empty means no transition, but we represent no transition by missing edge
    if (r1 === EPSILON && r2 === EPSILON) return EPSILON;
    if (r1 === EPSILON) return r2;
    if (r2 === EPSILON) return r1;
    return `${r1}${r2}`;
  }
}

function star(r: string): string {
  if (!r || r === EPSILON) return EPSILON;
  if (r.length === 1 || (r.startsWith('(') && r.endsWith(')'))) {
    return `${r}*`;
  }
  return `(${r})*`;
}

export function dfaToRe(dfa: DFA): { regex: string, steps: string[] } {
  const steps: string[] = [];
  
  const start = 'NEW_START';
  const accept = 'NEW_ACCEPT';
  
  let states = [start, ...dfa.states, accept];
  let transitions: GeneralizedTransition[] = [];
  
  // Add initial epsilon transition
  transitions.push({ from: start, to: dfa.startState, regex: EPSILON });
  
  // Add epsilon transitions to new accept state
  for (const acc of dfa.acceptStates) {
    transitions.push({ from: acc, to: accept, regex: EPSILON });
  }
  
  // Copy over DFA transitions
  for (const t of dfa.transitions) {
    transitions.push({ from: t.from, to: t.to, regex: t.label });
  }
  
  steps.push(`Created GNFA with new start state '${start}' and new accept state '${accept}'`);
  
  // Combine parallel edges
  const combineParallelEdges = () => {
    const combined: GeneralizedTransition[] = [];
    const map = new Map<string, string>();
    for (const t of transitions) {
      const key = `${t.from}->${t.to}`;
      if (map.has(key)) {
        map.set(key, simplifyRegex(map.get(key)!, t.regex, 'union'));
      } else {
        map.set(key, t.regex);
      }
    }
    for (const [key, regex] of map.entries()) {
      const [from, to] = key.split('->');
      combined.push({ from, to, regex });
    }
    transitions = combined;
  };
  
  combineParallelEdges();
  
  // Eliminate states
  const statesToEliminate = dfa.states; // Original states
  
  for (const state of statesToEliminate) {
    steps.push(`Eliminating state: {${state}}`);
    
    const incoming = transitions.filter(t => t.to === state && t.from !== state);
    const outgoing = transitions.filter(t => t.from === state && t.to !== state);
    const selfLoop = transitions.find(t => t.from === state && t.to === state);
    
    const loopRegex = selfLoop ? star(selfLoop.regex) : '';
    
    for (const inc of incoming) {
      for (const out of outgoing) {
        const pathRegex = [inc.regex, loopRegex, out.regex]
          .filter(r => r && r !== EPSILON)
          .join('');
          
        const newRegex = pathRegex || EPSILON;
        
        transitions.push({
          from: inc.from,
          to: out.to,
          regex: newRegex
        });
        
        steps.push(`  - Added path from {${inc.from}} to {${out.to}} with regex: ${newRegex}`);
      }
    }
    
    // Remove eliminated state and all its transitions
    states = states.filter(s => s !== state);
    transitions = transitions.filter(t => t.from !== state && t.to !== state);
    
    combineParallelEdges();
  }
  
  // Finally, the transition from NEW_START to NEW_ACCEPT is our regex
  const finalTransition = transitions.find(t => t.from === start && t.to === accept);
  const finalRegex = finalTransition ? finalTransition.regex : '∅';
  
  steps.push(`Final Regular Expression: ${finalRegex}`);
  
  return { regex: finalRegex, steps };
}

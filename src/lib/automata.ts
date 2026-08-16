export const EPSILON = 'ε';

export interface Transition {
  from: number;
  to: number;
  label: string;
}

export interface NFA {
  startState: number;
  acceptState: number; // Thompson's construction usually produces a single accept state for NFA fragments
  transitions: Transition[];
  states: number[];
}

export function createStateAllocator(startId = 0): () => number {
  let counter = startId;
  return () => counter++;
}

// Convert a single character to NFA
export function createCharNFA(char: string, nextState: () => number): NFA {
  const start = nextState();
  const accept = nextState();
  return {
    startState: start,
    acceptState: accept,
    transitions: [{ from: start, to: accept, label: char }],
    states: [start, accept]
  };
}

// Union of two NFAs (a|b)
export function unionNFA(a: NFA, b: NFA, nextState: () => number): NFA {
  const start = nextState();
  const accept = nextState();
  
  return {
    startState: start,
    acceptState: accept,
    transitions: [
      ...a.transitions,
      ...b.transitions,
      { from: start, to: a.startState, label: EPSILON },
      { from: start, to: b.startState, label: EPSILON },
      { from: a.acceptState, to: accept, label: EPSILON },
      { from: b.acceptState, to: accept, label: EPSILON }
    ],
    states: [start, accept, ...a.states, ...b.states]
  };
}

// Concatenation of two NFAs (ab)
export function concatNFA(a: NFA, b: NFA): NFA {
  // We merge a's accept state and b's start state.
  // We can just add an epsilon transition for simplicity, but merging is more optimal.
  // Using an epsilon transition to keep it simple and visualize the steps better.
  return {
    startState: a.startState,
    acceptState: b.acceptState,
    transitions: [
      ...a.transitions,
      ...b.transitions,
      { from: a.acceptState, to: b.startState, label: EPSILON }
    ],
    states: [...a.states, ...b.states]
  };
}

// Kleene star (a*)
export function kleeneStarNFA(a: NFA, nextState: () => number): NFA {
  const start = nextState();
  const accept = nextState();
  
  return {
    startState: start,
    acceptState: accept,
    transitions: [
      ...a.transitions,
      { from: start, to: a.startState, label: EPSILON }, // skip entirely
      { from: start, to: accept, label: EPSILON },
      { from: a.acceptState, to: a.startState, label: EPSILON }, // repeat
      { from: a.acceptState, to: accept, label: EPSILON }
    ],
    states: [start, accept, ...a.states]
  };
}

// Simple Parser for Regex to AST/Postfix
export function insertExplicitConcatOperator(exp: string): string {
  let res = '';
  for (let i = 0; i < exp.length; i++) {
    const c1 = exp[i];
    res += c1;
    if (i < exp.length - 1) {
      const c2 = exp[i + 1];
      const isC1OperandOrRightParen = /[a-zA-Z0-9*)]/.test(c1);
      const isC2OperandOrLeftParen = /[a-zA-Z0-9(]/.test(c2);
      if (isC1OperandOrRightParen && isC2OperandOrLeftParen) {
        res += '.'; // Explicit concatenation symbol
      }
    }
  }
  return res;
}

export function infixToPostfix(exp: string): string {
  const precedence: Record<string, number> = { '*': 3, '.': 2, '|': 1 };
  const stack: string[] = [];
  let postfix = '';

  for (const char of exp) {
    if (/[a-zA-Z0-9]/.test(char) || char === EPSILON) {
      postfix += char;
    } else if (char === '(') {
      stack.push(char);
    } else if (char === ')') {
      while (stack.length && stack[stack.length - 1] !== '(') {
        postfix += stack.pop();
      }
      stack.pop(); // Remove '('
    } else {
      while (
        stack.length &&
        stack[stack.length - 1] !== '(' &&
        precedence[stack[stack.length - 1]] >= precedence[char]
      ) {
        postfix += stack.pop();
      }
      stack.push(char);
    }
  }
  while (stack.length) {
    postfix += stack.pop();
  }
  return postfix;
}

export function compileRegexToNFA(regex: string): { nfa: NFA, postfix: string, steps: string[] } {
  const nextState = createStateAllocator();
  const steps: string[] = [];
  
  // Format regex
  const withConcat = insertExplicitConcatOperator(regex);
  steps.push(`Insert explicit concatenation: ${regex} -> ${withConcat}`);
  
  const postfix = infixToPostfix(withConcat);
  steps.push(`Convert to postfix notation: ${withConcat} -> ${postfix}`);
  
  const stack: NFA[] = [];
  
  for (const char of postfix) {
    if (char === '*') {
      const a = stack.pop()!;
      const nfa = kleeneStarNFA(a, nextState);
      stack.push(nfa);
      steps.push(`Apply Kleene Star to top of stack (States: ${a.startState}->${a.acceptState})`);
    } else if (char === '.') {
      const b = stack.pop()!;
      const a = stack.pop()!;
      const nfa = concatNFA(a, b);
      stack.push(nfa);
      steps.push(`Concatenate NFAs (States: ${a.startState}->${a.acceptState} and ${b.startState}->${b.acceptState})`);
    } else if (char === '|') {
      const b = stack.pop()!;
      const a = stack.pop()!;
      const nfa = unionNFA(a, b, nextState);
      stack.push(nfa);
      steps.push(`Union NFAs (States: ${a.startState}->${a.acceptState} and ${b.startState}->${b.acceptState})`);
    } else {
      const nfa = createCharNFA(char, nextState);
      stack.push(nfa);
      steps.push(`Create NFA for character '${char}' (States: ${nfa.startState}->${nfa.acceptState})`);
    }
  }
  
  return { nfa: stack[0], postfix, steps };
}

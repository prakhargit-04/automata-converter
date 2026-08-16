import { type Automaton, type Transition, EPSILON } from '../types.ts';
import { type ASTNode } from '../regex/ast.ts';
import { validateAutomaton } from '../validator.ts';

/**
 * ENFAFragment represents an intermediate NFA fragment produced during Thompson's construction.
 *
 * Thompson Invariant:
 * Every ENFAFragment must have EXACTLY ONE start state and EXACTLY ONE accept state.
 */
export interface ENFAFragment {
  states: string[];
  alphabet: string[];
  transitions: Transition[];
  startState: string;
  acceptState: string;
}

export type StateGenerator = () => string;

/**
 * State Name Generator (Collision Avoidance):
 *
 * Threading a single monotonic counter generator through the recursive compilation
 * ensures that every allocated state receives a unique state ID (e.g. "q0", "q1", ...).
 * This completely avoids naming collisions between sub-fragments.
 */
export function createStateGenerator(prefix = 'q'): StateGenerator {
  let counter = 0;
  return () => `${prefix}${counter++}`;
}

/**
 * Helper function to union child alphabets (excluding EPSILON).
 */
function unionAlphabets(a: string[], b: string[]): string[] {
  const set = new Set([...a, ...b]);
  set.delete(EPSILON);
  return Array.from(set).sort();
}

/**
 * Compiles a literal character AST node into a Thompson fragment.
 */
export function compileLiteral(char: string, nextState: StateGenerator): ENFAFragment {
  const start = nextState();
  const accept = nextState();
  return {
    states: [start, accept],
    alphabet: char === EPSILON ? [] : [char],
    transitions: [{ from: start, to: accept, label: char }],
    startState: start,
    acceptState: accept
  };
}

/**
 * Compiles an epsilon AST node into a Thompson fragment.
 */
export function compileEpsilon(nextState: StateGenerator): ENFAFragment {
  const start = nextState();
  const accept = nextState();
  return {
    states: [start, accept],
    alphabet: [],
    transitions: [{ from: start, to: accept, label: EPSILON }],
    startState: start,
    acceptState: accept
  };
}

/**
 * Compiles a concatenation AST node into a Thompson fragment.
 * Connects left accept state directly to right start state via an epsilon transition.
 */
export function compileConcat(left: ENFAFragment, right: ENFAFragment): ENFAFragment {
  return {
    states: [...left.states, ...right.states],
    alphabet: unionAlphabets(left.alphabet, right.alphabet),
    transitions: [
      ...left.transitions,
      ...right.transitions,
      { from: left.acceptState, to: right.startState, label: EPSILON }
    ],
    startState: left.startState,
    acceptState: right.acceptState
  };
}

/**
 * Compiles a union AST node into a Thompson fragment.
 * Creates a new start state and new accept state, branching to both child fragments.
 */
export function compileUnion(left: ENFAFragment, right: ENFAFragment, nextState: StateGenerator): ENFAFragment {
  const start = nextState();
  const accept = nextState();
  return {
    states: [start, accept, ...left.states, ...right.states],
    alphabet: unionAlphabets(left.alphabet, right.alphabet),
    transitions: [
      ...left.transitions,
      ...right.transitions,
      { from: start, to: left.startState, label: EPSILON },
      { from: start, to: right.startState, label: EPSILON },
      { from: left.acceptState, to: accept, label: EPSILON },
      { from: right.acceptState, to: accept, label: EPSILON }
    ],
    startState: start,
    acceptState: accept
  };
}

/**
 * Compiles a Kleene star AST node into a Thompson fragment.
 * Creates a new start state and new accept state to support skipping the loop and looping back.
 */
export function compileStar(expr: ENFAFragment, nextState: StateGenerator): ENFAFragment {
  const start = nextState();
  const accept = nextState();
  return {
    states: [start, accept, ...expr.states],
    alphabet: [...expr.alphabet],
    transitions: [
      ...expr.transitions,
      { from: start, to: expr.startState, label: EPSILON },
      { from: start, to: accept, label: EPSILON },
      { from: expr.acceptState, to: expr.startState, label: EPSILON },
      { from: expr.acceptState, to: accept, label: EPSILON }
    ],
    startState: start,
    acceptState: accept
  };
}

/**
 * Walks the AST recursively and compiles it into a full ENFA Automaton.
 * Ensures the final Automaton validates cleanly against validateAutomaton.
 */
export function compileASTToENFA(ast: ASTNode): Automaton {
  const nextState = createStateGenerator();

  function compile(node: ASTNode): ENFAFragment {
    switch (node.type) {
      case 'Literal':
        return compileLiteral(node.char, nextState);
      case 'Epsilon':
        return compileEpsilon(nextState);
      case 'Concat':
        return compileConcat(compile(node.left), compile(node.right));
      case 'Union':
        return compileUnion(compile(node.left), compile(node.right), nextState);
      case 'Star':
        return compileStar(compile(node.expr), nextState);
    }
  }

  const fragment = compile(ast);
  const automaton: Automaton = {
    type: 'ENFA',
    states: fragment.states,
    alphabet: fragment.alphabet,
    transitions: fragment.transitions,
    startState: fragment.startState,
    acceptStates: [fragment.acceptState]
  };

  // Confirm validity
  validateAutomaton(automaton);
  return automaton;
}

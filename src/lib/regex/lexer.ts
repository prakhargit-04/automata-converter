import { EPSILON } from '../types.ts';

export type TokenType =
  | 'LITERAL'
  | 'EPSILON'
  | 'UNION' // '|'
  | 'STAR'  // '*'
  | 'LPAREN' // '('
  | 'RPAREN' // ')'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  position: number; // 0-indexed character position
}

export class LexerError extends Error {
  position: number;
  constructor(message: string, position: number) {
    super(message);
    this.name = 'LexerError';
    this.position = position;
  }
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (char === '|') {
      tokens.push({ type: 'UNION', value: '|', position: i });
      i++;
    } else if (char === '*') {
      tokens.push({ type: 'STAR', value: '*', position: i });
      i++;
    } else if (char === '(') {
      tokens.push({ type: 'LPAREN', value: '(', position: i });
      i++;
    } else if (char === ')') {
      tokens.push({ type: 'RPAREN', value: ')', position: i });
      i++;
    } else if (char === EPSILON) {
      tokens.push({ type: 'EPSILON', value: EPSILON, position: i });
      i++;
    } else if (/[a-zA-Z0-9]/.test(char)) {
      tokens.push({ type: 'LITERAL', value: char, position: i });
      i++;
    } else {
      throw new LexerError(`Unexpected character "${char}" at position ${i}`, i);
    }
  }

  tokens.push({ type: 'EOF', value: '', position: i });
  return tokens;
}

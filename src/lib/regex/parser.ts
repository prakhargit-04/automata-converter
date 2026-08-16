import { type Token } from './lexer.ts';
import { type ASTNode } from './ast.ts';

export class ParserError extends Error {
  position: number;
  constructor(message: string, position: number) {
    super(message);
    this.name = 'ParserError';
    this.position = position;
  }
}

export class Parser {
  private tokens: Token[];
  private current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.tokens[this.current - 1];
  }

  private isAtEnd(): boolean {
    return this.peek().type === 'EOF';
  }

  private match(type: string): boolean {
    if (this.peek().type === type) {
      this.advance();
      return true;
    }
    return false;
  }

  /**
   * Parses the token stream into an AST.
   * Throws ParserError for empty input or syntax violations.
   */
  public parse(): ASTNode {
    if (this.isAtEnd()) {
      // Blank input is a UI-level error while ε is the deliberate token for the empty-string language.
      throw new ParserError('Empty regular expression', 0);
    }
    const node = this.expression();
    if (!this.isAtEnd()) {
      const token = this.peek();
      throw new ParserError(`Unexpected token "${token.value}" at position ${token.position}`, token.position);
    }
    return node;
  }

  private expression(): ASTNode {
    return this.unionExpr();
  }

  // UnionExpr -> ConcatExpr ( '|' ConcatExpr )*
  private unionExpr(): ASTNode {
    let node = this.concatExpr();

    while (this.match('UNION')) {
      const unionToken = this.tokens[this.current - 1];
      const nextType = this.peek().type;
      
      // If the next token cannot start a valid operand, throw error
      if (nextType === 'EOF' || nextType === 'UNION' || nextType === 'RPAREN') {
        throw new ParserError(`Unexpected "${unionToken.value}" at position ${unionToken.position}, expected an operand`, unionToken.position);
      }
      
      const right = this.concatExpr();
      node = {
        type: 'Union',
        left: node,
        right: right
      };
    }

    return node;
  }

  // ConcatExpr -> StarExpr ( StarExpr )*
  private concatExpr(): ASTNode {
    let node = this.starExpr();

    while (this.canStartExpression(this.peek())) {
      const right = this.starExpr();
      node = {
        type: 'Concat',
        left: node,
        right: right
      };
    }

    return node;
  }

  // StarExpr -> PrimaryExpr ( '*' )*
  private starExpr(): ASTNode {
    let node = this.primaryExpr();

    while (this.match('STAR')) {
      node = {
        type: 'Star',
        expr: node
      };
    }

    return node;
  }

  // PrimaryExpr -> Literal | Epsilon | '(' Expression ')'
  private primaryExpr(): ASTNode {
    const token = this.peek();

    if (this.match('LITERAL')) {
      return {
        type: 'Literal',
        char: this.tokens[this.current - 1].value
      };
    }

    if (this.match('EPSILON')) {
      return {
        type: 'Epsilon'
      };
    }

    if (this.match('LPAREN')) {
      const lparenToken = this.tokens[this.current - 1];

      if (this.peek().type === 'RPAREN') {
        throw new ParserError(`Empty parentheses at position ${lparenToken.position}`, lparenToken.position);
      }

      const node = this.expression();

      if (!this.match('RPAREN')) {
        throw new ParserError(`Unmatched "(" at position ${lparenToken.position}`, lparenToken.position);
      }

      return node;
    }

    // Handle misplaced operators and boundary syntax errors
    if (token.type === 'UNION') {
      throw new ParserError(`Unexpected "${token.value}" at position ${token.position}, expected an operand`, token.position);
    }
    if (token.type === 'STAR') {
      throw new ParserError(`Unexpected "${token.value}" at position ${token.position}, expected an operand`, token.position);
    }
    if (token.type === 'RPAREN') {
      throw new ParserError(`Unmatched ")" at position ${token.position}`, token.position);
    }
    if (token.type === 'EOF') {
      throw new ParserError(`Unexpected end of input at position ${token.position}, expected an operand`, token.position);
    }

    throw new ParserError(`Unexpected token "${token.value}" at position ${token.position}`, token.position);
  }

  private canStartExpression(token: Token): boolean {
    return token.type === 'LITERAL' || token.type === 'EPSILON' || token.type === 'LPAREN';
  }
}

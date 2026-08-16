import { test, describe } from 'node:test';
import assert from 'node:assert';
import { tokenize, LexerError } from '../lib/regex/lexer.ts';
import { Parser, ParserError } from '../lib/regex/parser.ts';
import { type ASTNode } from '../lib/regex/ast.ts';

function parse(input: string): ASTNode {
  const tokens = tokenize(input);
  const parser = new Parser(tokens);
  return parser.parse();
}

describe('Lexer & Tokenizer', () => {
  test('tokenizes literals and symbols with correct positions', () => {
    const tokens = tokenize('(a|b)*ε');
    assert.strictEqual(tokens.length, 8);
    assert.deepStrictEqual(tokens[0], { type: 'LPAREN', value: '(', position: 0 });
    assert.deepStrictEqual(tokens[1], { type: 'LITERAL', value: 'a', position: 1 });
    assert.deepStrictEqual(tokens[2], { type: 'UNION', value: '|', position: 2 });
    assert.deepStrictEqual(tokens[3], { type: 'LITERAL', value: 'b', position: 3 });
    assert.deepStrictEqual(tokens[4], { type: 'RPAREN', value: ')', position: 4 });
    assert.deepStrictEqual(tokens[5], { type: 'STAR', value: '*', position: 5 });
    assert.deepStrictEqual(tokens[6], { type: 'EPSILON', value: 'ε', position: 6 });
    assert.deepStrictEqual(tokens[7], { type: 'EOF', value: '', position: 7 });
  });

  test('throws LexerError for illegal characters', () => {
    assert.throws(() => tokenize('a b'), (err: unknown) => {
      return (
        err instanceof LexerError &&
        err.message.includes('Unexpected character " "') &&
        err.position === 1
      );
    });
  });
});

describe('Regex Parser - Valid Input ASTs', () => {
  test('parses single literal character', () => {
    const ast = parse('a');
    assert.deepStrictEqual(ast, { type: 'Literal', char: 'a' });
  });

  test('parses epsilon character', () => {
    const ast = parse('ε');
    assert.deepStrictEqual(ast, { type: 'Epsilon' });
  });

  test('parses Kleene star', () => {
    const ast = parse('a*');
    assert.deepStrictEqual(ast, {
      type: 'Star',
      expr: { type: 'Literal', char: 'a' }
    });
  });

  test('parses double Kleene star', () => {
    const ast = parse('a**');
    assert.deepStrictEqual(ast, {
      type: 'Star',
      expr: {
        type: 'Star',
        expr: { type: 'Literal', char: 'a' }
      }
    });
  });

  test('parses concatenation left-associatively', () => {
    const ast = parse('abc');
    assert.deepStrictEqual(ast, {
      type: 'Concat',
      left: {
        type: 'Concat',
        left: { type: 'Literal', char: 'a' },
        right: { type: 'Literal', char: 'b' }
      },
      right: { type: 'Literal', char: 'c' }
    });
  });

  test('parses union', () => {
    const ast = parse('a|b');
    assert.deepStrictEqual(ast, {
      type: 'Union',
      left: { type: 'Literal', char: 'a' },
      right: { type: 'Literal', char: 'b' }
    });
  });

  test('respects operator precedence (a|bc* -> a|(b(c*)))', () => {
    const ast = parse('a|bc*');
    assert.deepStrictEqual(ast, {
      type: 'Union',
      left: { type: 'Literal', char: 'a' },
      right: {
        type: 'Concat',
        left: { type: 'Literal', char: 'b' },
        right: {
          type: 'Star',
          expr: { type: 'Literal', char: 'c' }
        }
      }
    });
  });

  test('parses parenthesized expression groups', () => {
    const ast = parse('(a|b)*abb');
    // Expected nesting: Concat(Concat(Concat(Star(Union(a,b)), a), b), b)
    assert.deepStrictEqual(ast, {
      type: 'Concat',
      left: {
        type: 'Concat',
        left: {
          type: 'Concat',
          left: {
            type: 'Star',
            expr: {
              type: 'Union',
              left: { type: 'Literal', char: 'a' },
              right: { type: 'Literal', char: 'b' }
            }
          },
          right: { type: 'Literal', char: 'a' }
        },
        right: { type: 'Literal', char: 'b' }
      },
      right: { type: 'Literal', char: 'b' }
    });
  });
});

describe('Regex Parser - Malformed Input Positioning', () => {
  test('throws ParserError on empty input string', () => {
    assert.throws(() => parse(''), (err: unknown) => {
      return (
        err instanceof ParserError &&
        err.message.includes('Empty regular expression') &&
        err.position === 0
      );
    });
  });

  test('throws ParserError on unmatched open parenthesis', () => {
    assert.throws(() => parse('(a|b'), (err: unknown) => {
      return (
        err instanceof ParserError &&
        err.message.includes('Unmatched "(" at position 0') &&
        err.position === 0
      );
    });
  });

  test('throws ParserError on unmatched closing parenthesis', () => {
    assert.throws(() => parse('a)'), (err: unknown) => {
      return (
        err instanceof ParserError &&
        err.message.includes('Unexpected token ")"') &&
        err.position === 1
      );
    });
  });

  test('throws ParserError on misplaced operator at start (*a)', () => {
    assert.throws(() => parse('*a'), (err: unknown) => {
      return (
        err instanceof ParserError &&
        err.message.includes('Unexpected "*" at position 0') &&
        err.message.includes('expected an operand') &&
        err.position === 0
      );
    });
  });

  test('throws ParserError on misplaced operator at start (|a)', () => {
    assert.throws(() => parse('|a'), (err: unknown) => {
      return (
        err instanceof ParserError &&
        err.message.includes('Unexpected "|" at position 0') &&
        err.message.includes('expected an operand') &&
        err.position === 0
      );
    });
  });

  test('throws ParserError on trailing union operator (a|)', () => {
    assert.throws(() => parse('a|'), (err: unknown) => {
      return (
        err instanceof ParserError &&
        err.message.includes('Unexpected "|" at position 1') &&
        err.message.includes('expected an operand') &&
        err.position === 1
      );
    });
  });

  test('throws ParserError on trailing union operator (a|b|)', () => {
    assert.throws(() => parse('a|b|'), (err: unknown) => {
      return (
        err instanceof ParserError &&
        err.message.includes('Unexpected "|" at position 3') &&
        err.message.includes('expected an operand') &&
        err.position === 3
      );
    });
  });

  test('throws ParserError on empty parentheses ()', () => {
    assert.throws(() => parse('()'), (err: unknown) => {
      return (
        err instanceof ParserError &&
        err.message.includes('Empty parentheses at position 0') &&
        err.position === 0
      );
    });
  });

  test('throws ParserError on empty parentheses in sub-expression (a|())', () => {
    assert.throws(() => parse('a|()'), (err: unknown) => {
      return (
        err instanceof ParserError &&
        err.message.includes('Empty parentheses at position 2') &&
        err.position === 2
      );
    });
  });
});

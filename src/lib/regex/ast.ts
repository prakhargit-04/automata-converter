export type ASTNode =
  | LiteralNode
  | EpsilonNode
  | ConcatNode
  | UnionNode
  | StarNode;

export interface LiteralNode {
  type: 'Literal';
  char: string;
}

export interface EpsilonNode {
  type: 'Epsilon';
}

/**
 * ConcatNode represents concatenation of left and right nodes.
 *
 * Associativity Contract:
 * Multi-symbol concatenations (e.g. "abc") fold left-associatively:
 * "abc" -> Concat(Concat(a, b), c)
 */
export interface ConcatNode {
  type: 'Concat';
  left: ASTNode;
  right: ASTNode;
}

export interface UnionNode {
  type: 'Union';
  left: ASTNode;
  right: ASTNode;
}

export interface StarNode {
  type: 'Star';
  expr: ASTNode;
}

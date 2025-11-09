// ============================================
// AST NODE TYPES
// ============================================

export interface NumberNode {
  type: 'number';
  value: number;
}

export interface StringNode {
  type: 'string';
  value: string;
}

export interface VariableNode {
  type: 'variable';
  name: string;
}

export interface MemberAccessNode {
  type: 'member_access';
  object: Expression;
  property: string;
}

export interface IndexAccessNode {
  type: 'index_access';
  object: Expression;
  index: Expression;
}

export interface ArrayNode {
  type: 'array';
  elements: Expression[];
}

export interface BinaryNode {
  type: 'binary';
  op: string;
  left: Expression;
  right: Expression;
}

export interface CallNode {
  type: 'call';
  name: string;
  args: Expression[];
}

export interface UnaryNode {
  type: 'unary';
  op: string;
  operand: Expression;
}

export type Expression = NumberNode | StringNode | VariableNode | BinaryNode | CallNode | UnaryNode | MemberAccessNode | IndexAccessNode | ArrayNode;

export interface VariableDeclaration {
  type: 'variable_declaration';
  kind: 'let' | 'const';
  name: string;
  value: Expression;
}

export interface AssignmentStatement {
  type: 'assignment';
  name: string;
  value: Expression;
}

export interface BlockStatement {
  type: 'block';
  statements: Statement[];
}

export interface ReturnStatement {
  type: 'return';
  value: Expression;
}

export interface IfStatement {
  type: 'if';
  condition: Expression;
  thenBlock: BlockStatement;
  elseBlock: BlockStatement | null;
}

export type Statement = VariableDeclaration | AssignmentStatement | ReturnStatement | IfStatement | Expression;

export interface FunctionNode {
  name: string;
  params: string[];
  body: BlockStatement;
}

export interface ImportDeclaration {
  type: 'import';
  specifiers: string[];  // ['Parser', 'compile']
  source: string;        // './parser.js'
}

export interface ExportDeclaration {
  type: 'export';
  declaration: FunctionNode;
}

export interface AST {
  imports: ImportDeclaration[];
  functions: FunctionNode[];
  exports: ExportDeclaration[];
  entryPoint: CallNode | null;
}

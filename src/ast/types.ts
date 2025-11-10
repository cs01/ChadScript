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

export interface ObjectNode {
  type: 'object';
  properties: { key: string; value: Expression }[];
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

export interface MethodCallNode {
  type: 'method_call';
  object: Expression;
  method: string;
  args: Expression[];
}

export interface NewNode {
  type: 'new';
  className: string;
  args: Expression[];
}

export interface ThisNode {
  type: 'this';
}

export interface UnaryNode {
  type: 'unary';
  op: string;
  operand: Expression;
}

export type Expression = NumberNode | StringNode | VariableNode | BinaryNode | CallNode | MethodCallNode | UnaryNode | MemberAccessNode | IndexAccessNode | ArrayNode | ObjectNode | NewNode | ThisNode;

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

export interface ClassMethod {
  type: 'method';
  name: string;
  params: string[];
  body: BlockStatement;
  isConstructor: boolean;
}

export interface ClassNode {
  name: string;
  methods: ClassMethod[];
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
  classes: ClassNode[];
  exports: ExportDeclaration[];
  entryPoint: CallNode | NewNode | null;
}

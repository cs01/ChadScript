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

export interface BooleanNode {
  type: 'boolean';
  value: boolean;
}

export interface RegexNode {
  type: 'regex';
  pattern: string;
  flags: string;
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

export interface MapNode {
  type: 'map';
  entries: { key: Expression; value: Expression }[];
}

export interface SetNode {
  type: 'set';
  values: Expression[];
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
  typeParameter?: string; // Generic type parameter like <JsonTestResponse>
}

export interface NewNode {
  type: 'new';
  className: string;
  args: Expression[];
}

export interface ThisNode {
  type: 'this';
}

export interface SuperNode {
  type: 'super';
}

export interface UnaryNode {
  type: 'unary';
  op: string;
  operand: Expression;
}

export interface TemplateLiteralNode {
  type: 'template_literal';
  parts: (string | Expression)[];
}

export interface ArrowFunctionNode {
  type: 'arrow_function';
  params: string[];
  body: Expression | BlockStatement;
}

export interface ConditionalExpressionNode {
  type: 'conditional';
  condition: Expression;
  consequent: Expression;
  alternate: Expression;
}

export type Expression = NumberNode | StringNode | BooleanNode | RegexNode | VariableNode | BinaryNode | CallNode | MethodCallNode | UnaryNode | MemberAccessNode | IndexAccessNode | ArrayNode | ObjectNode | MapNode | SetNode | NewNode | ThisNode | SuperNode | TemplateLiteralNode | ArrowFunctionNode | ConditionalExpressionNode;

export interface VariableDeclaration {
  type: 'variable_declaration';
  kind: 'let' | 'const';
  name: string;
  value: Expression | null;
  declaredType?: string;  // Optional TypeScript type annotation (e.g., "string[]", "number")
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

export interface WhileStatement {
  type: 'while';
  condition: Expression;
  body: BlockStatement;
}

export interface ForStatement {
  type: 'for';
  init: VariableDeclaration | AssignmentStatement | null;
  condition: Expression | null;
  update: AssignmentStatement | Expression | null;
  body: BlockStatement;
}

export interface ForOfStatement {
  type: 'for_of';
  variableKind: 'let' | 'const' | 'var';
  variableName: string;
  iterable: Expression;
  body: BlockStatement;
}

export interface BreakStatement {
  type: 'break';
}

export interface ContinueStatement {
  type: 'continue';
}

export interface ThrowStatement {
  type: 'throw';
  argument: Expression;
}

export interface TryStatement {
  type: 'try';
  tryBlock: BlockStatement;
  catchClause: { param: string; body: BlockStatement } | null;
  finallyBlock: BlockStatement | null;
}

export type Statement = VariableDeclaration | AssignmentStatement | ReturnStatement | IfStatement | WhileStatement | ForStatement | ForOfStatement | BreakStatement | ContinueStatement | ThrowStatement | TryStatement | Expression;

export interface FunctionNode {
  name: string;
  params: string[];
  body: BlockStatement;
}

export interface ClassMethod {
  type: 'method';
  name: string;
  params: string[];
  paramTypes?: ('string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void')[];  // Optional TypeScript parameter types
  returnType?: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]' | 'void';  // Optional TypeScript return type
  body: BlockStatement;
  isConstructor: boolean;
}

export interface ClassField {
  name: string;
  fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean';  // Primitive types and arrays
}

export interface ClassNode {
  name: string;
  extends?: string;
  fields: ClassField[];  // Explicit field declarations
  methods: ClassMethod[];
}

export interface ImportDeclaration {
  type: 'import';
  specifiers: string[];  // ['Parser', 'compile']
  source: string;        // './parser.js'
}

export interface ExportDeclaration {
  type: 'export';
  declaration: FunctionNode | ClassNode;
}

export interface AST {
  imports: ImportDeclaration[];
  functions: FunctionNode[];
  classes: ClassNode[];
  exports: ExportDeclaration[];
  interfaces: InterfaceDeclaration[];  // Interface definitions for JSON typing
  topLevelStatements: VariableDeclaration[];  // Top-level const/let declarations
  topLevelExpressions: (CallNode | NewNode | MethodCallNode)[];  // Top-level expressions (console.log, etc.)
  topLevelItems?: any[];  // Combined ordered list of all top-level statements and expressions
}

export interface InterfaceDeclaration {
  name: string;
  fields: { name: string; type: string }[];  // e.g., [{ name: 'age', type: 'number' }, { name: 'name', type: 'string' }]
}

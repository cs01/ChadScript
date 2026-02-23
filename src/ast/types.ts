// ============================================
// SOURCE LOCATION
// ============================================

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
  offset: number;
}

// ============================================
// AST NODE TYPES
// ============================================

export interface NumberNode {
  type: "number";
  value: number;
  loc?: SourceLocation;
}

export interface StringNode {
  type: "string";
  value: string;
  loc?: SourceLocation;
}

export interface BooleanNode {
  type: "boolean";
  value: boolean;
  loc?: SourceLocation;
}

export interface NullNode {
  type: "null";
  loc?: SourceLocation;
}

export interface UndefinedNode {
  type: "undefined";
  loc?: SourceLocation;
}

export interface RegexNode {
  type: "regex";
  pattern: string;
  flags: string;
  loc?: SourceLocation;
}

export interface VariableNode {
  type: "variable";
  name: string;
  loc?: SourceLocation;
}

export interface MemberAccessNode {
  type: "member_access";
  object: Expression;
  property: string;
  optional?: boolean;
  loc?: SourceLocation;
}

export interface IndexAccessNode {
  type: "index_access";
  object: Expression;
  index: Expression;
  loc?: SourceLocation;
}

export interface ArrayNode {
  type: "array";
  elements: Expression[];
  loc?: SourceLocation;
}

export interface ObjectProperty {
  key: string;
  value: Expression;
}

export interface CommonField {
  name: string;
  type: string;
}

export interface ObjectNode {
  type: "object";
  properties: ObjectProperty[];
  loc?: SourceLocation;
}

export interface MapEntry {
  key: Expression;
  value: Expression;
}

export interface MapNode {
  type: "map";
  entries: MapEntry[];
  keyType?: string;
  valueType?: string;
  loc?: SourceLocation;
}

export interface SetNode {
  type: "set";
  values: Expression[];
  valueType?: string;
  loc?: SourceLocation;
}

export interface BinaryNode {
  type: "binary";
  op: string;
  left: Expression;
  right: Expression;
  loc?: SourceLocation;
}

export interface CallNode {
  type: "call";
  name: string;
  args: Expression[];
  loc?: SourceLocation;
}

export interface MethodCallNode {
  type: "method_call";
  object: Expression;
  method: string;
  args: Expression[];
  typeParameter?: string; // Generic type parameter like <JsonTestResponse>
  pos?: number; // Source position for error reporting
  loc?: SourceLocation;
}

export interface NewNode {
  type: "new";
  className: string;
  args: Expression[];
  typeArgs?: string[];
  loc?: SourceLocation;
}

export interface ThisNode {
  type: "this";
  loc?: SourceLocation;
}

export interface SuperNode {
  type: "super";
  loc?: SourceLocation;
}

export interface UnaryNode {
  type: "unary";
  op: string;
  operand: Expression;
  loc?: SourceLocation;
}

export interface TemplateLiteralNode {
  type: "template_literal";
  parts: (string | Expression)[];
  loc?: SourceLocation;
}

export interface ArrowFunctionNode {
  type: "arrow_function";
  params: string[];
  body: Expression | BlockStatement;
  async?: boolean;
  captures?: { name: string; llvmType: string }[];
  loc?: SourceLocation;
}

export interface AwaitExpressionNode {
  type: "await";
  argument: Expression;
  loc?: SourceLocation;
}

export interface ConditionalExpressionNode {
  type: "conditional";
  condition: Expression;
  consequent: Expression;
  alternate: Expression;
  loc?: SourceLocation;
}

export interface MemberAccessAssignmentNode {
  type: "member_access_assignment";
  object: Expression;
  property: string;
  value: Expression;
  loc?: SourceLocation;
}

export interface IndexAccessAssignmentNode {
  type: "index_access_assignment";
  object: Expression;
  index: Expression;
  value: Expression;
  loc?: SourceLocation;
}

export interface TypeAssertionNode {
  type: "type_assertion";
  expression: Expression;
  assertedType: string;
  loc?: SourceLocation;
}

export interface SpreadElementNode {
  type: "spread_element";
  argument: Expression;
  loc?: SourceLocation;
}

export type Expression =
  | NumberNode
  | StringNode
  | BooleanNode
  | NullNode
  | UndefinedNode
  | RegexNode
  | VariableNode
  | BinaryNode
  | CallNode
  | MethodCallNode
  | UnaryNode
  | MemberAccessNode
  | IndexAccessNode
  | ArrayNode
  | ObjectNode
  | MapNode
  | SetNode
  | NewNode
  | ThisNode
  | SuperNode
  | TemplateLiteralNode
  | ArrowFunctionNode
  | ConditionalExpressionNode
  | AwaitExpressionNode
  | MemberAccessAssignmentNode
  | IndexAccessAssignmentNode
  | TypeAssertionNode
  | SpreadElementNode;

export interface VariableDeclaration {
  type: "variable_declaration";
  kind: string;
  name: string;
  value: Expression | null;
  declaredType?: string; // Optional TypeScript type annotation (e.g., "string[]", "number")
  line?: number;
  loc?: SourceLocation;
}

export interface AssignmentStatement {
  type: "assignment";
  name: string;
  value: Expression;
  line?: number;
  loc?: SourceLocation;
}

export interface BlockStatement {
  type: "block";
  statements: Statement[];
  loc?: SourceLocation;
}

export interface ReturnStatement {
  type: "return";
  value: Expression;
  loc?: SourceLocation;
}

export interface IfStatement {
  type: "if";
  condition: Expression;
  thenBlock: BlockStatement;
  elseBlock: BlockStatement | null;
  loc?: SourceLocation;
}

export interface WhileStatement {
  type: "while";
  condition: Expression;
  body: BlockStatement;
  loc?: SourceLocation;
}

export interface DoWhileStatement {
  type: "do_while";
  condition: Expression;
  body: BlockStatement;
  loc?: SourceLocation;
}

export interface ForStatement {
  type: "for";
  init: VariableDeclaration | AssignmentStatement | null;
  condition: Expression | null;
  update: AssignmentStatement | Expression | null;
  body: BlockStatement;
  loc?: SourceLocation;
}

export interface ForOfStatement {
  type: "for_of";
  variableKind: string;
  variableName: string;
  destructuredNames?: string[];
  iterable: Expression;
  body: BlockStatement;
  loc?: SourceLocation;
}

export interface BreakStatement {
  type: "break";
  loc?: SourceLocation;
}

export interface ContinueStatement {
  type: "continue";
  loc?: SourceLocation;
}

export interface ThrowStatement {
  type: "throw";
  argument: Expression;
  loc?: SourceLocation;
}

export interface TryStatement {
  type: "try";
  tryBlock: BlockStatement;
  catchParam: string | null;
  catchBody: BlockStatement | null;
  finallyBlock: BlockStatement | null;
  loc?: SourceLocation;
}

export interface SwitchCase {
  test: Expression | null;
  consequent: Statement[];
}

export interface SwitchStatement {
  type: "switch";
  discriminant: Expression;
  cases: SwitchCase[];
  loc?: SourceLocation;
}

export type Statement =
  | VariableDeclaration
  | AssignmentStatement
  | ReturnStatement
  | IfStatement
  | WhileStatement
  | DoWhileStatement
  | ForStatement
  | ForOfStatement
  | BreakStatement
  | ContinueStatement
  | ThrowStatement
  | TryStatement
  | SwitchStatement
  | BlockStatement
  | Expression;

export type TopLevelItem =
  | VariableDeclaration
  | AssignmentStatement
  | ForStatement
  | ForOfStatement
  | WhileStatement
  | DoWhileStatement
  | IfStatement
  | TryStatement
  | ThrowStatement
  | CallNode
  | NewNode
  | MethodCallNode
  | AwaitExpressionNode;

export interface FunctionParameter {
  name: string;
  type?: string;
  optional?: boolean;
  defaultValue?: Expression;
}

export interface FunctionNode {
  name: string;
  params: string[];
  body: BlockStatement;
  returnType?: string;
  paramTypes?: string[];
  typeParameters?: string[];
  async?: boolean;
  parameters?: FunctionParameter[];
  loc?: SourceLocation;
}

export interface ClassMethod {
  type: "method";
  name: string;
  params: string[];
  paramTypes?: string[];
  parameterProperties?: string[];
  returnType?: string;
  body: BlockStatement;
  isConstructor: boolean;
  isStatic?: boolean;
}

export interface ClassField {
  name: string;
  fieldType: "double" | "string" | "string[]" | "number[]" | "boolean[]" | "boolean"; // Primitive types and arrays
  tsType?: string; // Original TypeScript type (e.g., 'AST', 'Expression') for interface-typed fields
  initializer?: Expression;
  isStatic?: boolean;
}

export interface ClassNode {
  name: string;
  extends?: string;
  implements?: string[];
  fields: ClassField[]; // Explicit field declarations
  methods: ClassMethod[];
  loc?: SourceLocation;
}

export interface ImportSpecifier {
  name: string; // Local name (what it's called in this file)
  original?: string; // Original exported name (if different from local)
}

export interface ImportDeclaration {
  type: "import";
  specifiers: string[]; // ['Parser', 'compile'] - legacy format (local names only)
  aliasedSpecifiers?: ImportSpecifier[]; // New format with original/local name tracking
  source: string; // './parser.js'
}

export interface ExportDeclaration {
  type: "export";
  declaration: FunctionNode | ClassNode;
}

export interface AST {
  imports: ImportDeclaration[];
  functions: FunctionNode[];
  classes: ClassNode[];
  exports: ExportDeclaration[];
  interfaces: InterfaceDeclaration[]; // Interface definitions for JSON typing
  typeAliases: TypeAliasDeclaration[]; // Type alias declarations (union types)
  enums: EnumDeclaration[]; // Enum declarations (compile to integer constants)
  topLevelStatements: (VariableDeclaration | AssignmentStatement)[]; // Top-level const/let declarations and assignments
  topLevelExpressions: (
    | CallNode
    | NewNode
    | MethodCallNode
    | ForStatement
    | ForOfStatement
    | WhileStatement
    | DoWhileStatement
    | IfStatement
    | TryStatement
    | AwaitExpressionNode
  )[]; // Top-level expressions and statements
  topLevelItems?: TopLevelItem[]; // Combined ordered list of all top-level statements and expressions
  topLevelItemTypes?: string[]; // Parallel array of type discriminators for topLevelItems
}

export interface InterfaceField {
  name: string;
  type: string;
}

export interface InterfaceMethod {
  name: string;
  params: string[];
  paramTypes: string[];
  returnType: string;
}

export interface InterfaceDeclaration {
  name: string;
  extends?: string[];
  fields: InterfaceField[];
  methods?: InterfaceMethod[];
}

export interface TypeAliasDeclaration {
  name: string;
  unionMembers: string[]; // e.g., ['NumberNode', 'StringNode', 'BinaryNode']
}

export interface EnumMember {
  name: string;
  value: number;
}

export interface EnumDeclaration {
  name: string;
  members: EnumMember[]; // e.g., [{ name: 'Silent', value: 0 }, { name: 'Normal', value: 1 }]
}

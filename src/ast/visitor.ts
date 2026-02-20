import {
  AST,
  Expression,
  Statement,
  BlockStatement,
  NumberNode,
  StringNode,
  BooleanNode,
  NullNode,
  UndefinedNode,
  RegexNode,
  VariableNode,
  MemberAccessNode,
  IndexAccessNode,
  ArrayNode,
  ObjectNode,
  MapNode,
  SetNode,
  BinaryNode,
  CallNode,
  MethodCallNode,
  NewNode,
  ThisNode,
  SuperNode,
  UnaryNode,
  TemplateLiteralNode,
  ArrowFunctionNode,
  ConditionalExpressionNode,
  AwaitExpressionNode,
  MemberAccessAssignmentNode,
  IndexAccessAssignmentNode,
  TypeAssertionNode,
  SpreadElementNode,
  VariableDeclaration,
  AssignmentStatement,
  ReturnStatement,
  IfStatement,
  WhileStatement,
  ForStatement,
  ForOfStatement,
  BreakStatement,
  ContinueStatement,
  ThrowStatement,
  TryStatement,
  SwitchStatement,
  FunctionNode,
  ClassNode,
  ClassMethod,
  InterfaceDeclaration,
  EnumDeclaration,
  TypeAliasDeclaration,
  ImportDeclaration,
  ExportDeclaration,
  TopLevelItem,
} from "./types.js";

export interface ASTConsumer {
  handleAST(ast: AST): void;
}

export class RecursiveASTVisitor {
  visitAST(ast: AST): void {
    for (let i = 0; i < ast.imports.length; i++) {
      this.visitImportDeclaration(ast.imports[i]);
    }

    for (let i = 0; i < ast.interfaces.length; i++) {
      this.visitInterfaceDeclaration(ast.interfaces[i]);
    }

    for (let i = 0; i < ast.typeAliases.length; i++) {
      this.visitTypeAliasDeclaration(ast.typeAliases[i]);
    }

    for (let i = 0; i < ast.enums.length; i++) {
      this.visitEnumDeclaration(ast.enums[i]);
    }

    for (let i = 0; i < ast.topLevelStatements.length; i++) {
      const stmt = ast.topLevelStatements[i];
      this.visitStatement(stmt);
    }

    for (let i = 0; i < ast.functions.length; i++) {
      this.visitFunctionNode(ast.functions[i]);
    }

    for (let i = 0; i < ast.classes.length; i++) {
      this.visitClassNode(ast.classes[i]);
    }

    for (let i = 0; i < ast.exports.length; i++) {
      this.visitExportDeclaration(ast.exports[i]);
    }

    if (ast.topLevelExpressions) {
      for (let i = 0; i < ast.topLevelExpressions.length; i++) {
        const expr = ast.topLevelExpressions[i];
        const e = expr as { type: string };
        if (
          e.type === "for" ||
          e.type === "for_of" ||
          e.type === "while" ||
          e.type === "if" ||
          e.type === "try"
        ) {
          this.visitStatement(expr as Statement);
        } else {
          this.visitExpression(expr as Expression);
        }
      }
    }
  }

  // ============================================
  // Top-level declarations
  // ============================================

  visitImportDeclaration(node: ImportDeclaration): void {}

  visitInterfaceDeclaration(node: InterfaceDeclaration): void {}

  visitTypeAliasDeclaration(node: TypeAliasDeclaration): void {}

  visitEnumDeclaration(node: EnumDeclaration): void {}

  visitExportDeclaration(node: ExportDeclaration): void {
    const decl = node.declaration;
    if ("params" in decl) {
      this.visitFunctionNode(decl as FunctionNode);
    } else {
      this.visitClassNode(decl as ClassNode);
    }
  }

  visitFunctionNode(node: FunctionNode): void {
    if (node.parameters) {
      for (let i = 0; i < node.parameters.length; i++) {
        const param = node.parameters[i];
        if (param.defaultValue) {
          this.visitExpression(param.defaultValue);
        }
      }
    }
    this.visitBlock(node.body);
  }

  visitClassNode(node: ClassNode): void {
    for (let i = 0; i < node.methods.length; i++) {
      this.visitClassMethod(node.methods[i]);
    }
  }

  visitClassMethod(node: ClassMethod): void {
    this.visitBlock(node.body);
  }

  // ============================================
  // Statement dispatch
  // ============================================

  visitStatement(stmt: Statement): void {
    const s = stmt as { type: string };
    const t = s.type;
    if (t === "variable_declaration") {
      this.visitVariableDeclaration(stmt as VariableDeclaration);
    } else if (t === "assignment") {
      this.visitAssignmentStatement(stmt as AssignmentStatement);
    } else if (t === "return") {
      this.visitReturnStatement(stmt as ReturnStatement);
    } else if (t === "if") {
      this.visitIfStatement(stmt as IfStatement);
    } else if (t === "while") {
      this.visitWhileStatement(stmt as WhileStatement);
    } else if (t === "for") {
      this.visitForStatement(stmt as ForStatement);
    } else if (t === "for_of") {
      this.visitForOfStatement(stmt as ForOfStatement);
    } else if (t === "break") {
      this.visitBreakStatement(stmt as BreakStatement);
    } else if (t === "continue") {
      this.visitContinueStatement(stmt as ContinueStatement);
    } else if (t === "throw") {
      this.visitThrowStatement(stmt as ThrowStatement);
    } else if (t === "try") {
      this.visitTryStatement(stmt as TryStatement);
    } else if (t === "switch") {
      this.visitSwitchStatement(stmt as SwitchStatement);
    } else if (t === "block") {
      this.visitBlock(stmt as BlockStatement);
    } else {
      this.visitExpression(stmt as Expression);
    }
  }

  // ============================================
  // Statement visitors
  // ============================================

  visitVariableDeclaration(node: VariableDeclaration): void {
    if (node.value) {
      this.visitExpression(node.value);
    }
  }

  visitAssignmentStatement(node: AssignmentStatement): void {
    this.visitExpression(node.value);
  }

  visitReturnStatement(node: ReturnStatement): void {
    if (node.value) {
      this.visitExpression(node.value);
    }
  }

  visitIfStatement(node: IfStatement): void {
    this.visitExpression(node.condition);
    this.visitBlock(node.thenBlock);
    if (node.elseBlock) {
      this.visitBlock(node.elseBlock);
    }
  }

  visitWhileStatement(node: WhileStatement): void {
    this.visitExpression(node.condition);
    this.visitBlock(node.body);
  }

  visitForStatement(node: ForStatement): void {
    if (node.init) {
      if (node.init.type === "variable_declaration") {
        this.visitVariableDeclaration(node.init);
      } else {
        this.visitAssignmentStatement(node.init);
      }
    }
    if (node.condition) {
      this.visitExpression(node.condition);
    }
    if (node.update) {
      const u = node.update as { type: string };
      if (u.type === "assignment") {
        this.visitAssignmentStatement(node.update as AssignmentStatement);
      } else {
        this.visitExpression(node.update as Expression);
      }
    }
    this.visitBlock(node.body);
  }

  visitForOfStatement(node: ForOfStatement): void {
    this.visitExpression(node.iterable);
    this.visitBlock(node.body);
  }

  visitBreakStatement(_node: BreakStatement): void {}

  visitContinueStatement(_node: ContinueStatement): void {}

  visitThrowStatement(node: ThrowStatement): void {
    this.visitExpression(node.argument);
  }

  visitTryStatement(node: TryStatement): void {
    this.visitBlock(node.tryBlock);
    if (node.catchBody) {
      this.visitBlock(node.catchBody);
    }
    if (node.finallyBlock) {
      this.visitBlock(node.finallyBlock);
    }
  }

  visitSwitchStatement(node: SwitchStatement): void {
    this.visitExpression(node.discriminant);
    for (let i = 0; i < node.cases.length; i++) {
      const c = node.cases[i];
      if (c.test) {
        this.visitExpression(c.test);
      }
      for (let j = 0; j < c.consequent.length; j++) {
        this.visitStatement(c.consequent[j]);
      }
    }
  }

  visitBlock(block: BlockStatement): void {
    for (let i = 0; i < block.statements.length; i++) {
      this.visitStatement(block.statements[i]);
    }
  }

  // ============================================
  // Expression dispatch
  // ============================================

  visitExpression(expr: Expression): void {
    const e = expr as { type: string };
    const t = e.type;
    if (t === "number") {
      this.visitNumberNode(expr as NumberNode);
    } else if (t === "string") {
      this.visitStringNode(expr as StringNode);
    } else if (t === "boolean") {
      this.visitBooleanNode(expr as BooleanNode);
    } else if (t === "null") {
      this.visitNullNode(expr as NullNode);
    } else if (t === "undefined") {
      this.visitUndefinedNode(expr as UndefinedNode);
    } else if (t === "regex") {
      this.visitRegexNode(expr as RegexNode);
    } else if (t === "variable") {
      this.visitVariableNode(expr as VariableNode);
    } else if (t === "member_access") {
      this.visitMemberAccessNode(expr as MemberAccessNode);
    } else if (t === "index_access") {
      this.visitIndexAccessNode(expr as IndexAccessNode);
    } else if (t === "array") {
      this.visitArrayNode(expr as ArrayNode);
    } else if (t === "object") {
      this.visitObjectNode(expr as ObjectNode);
    } else if (t === "map") {
      this.visitMapNode(expr as MapNode);
    } else if (t === "set") {
      this.visitSetNode(expr as SetNode);
    } else if (t === "binary") {
      this.visitBinaryNode(expr as BinaryNode);
    } else if (t === "call") {
      this.visitCallNode(expr as CallNode);
    } else if (t === "method_call") {
      this.visitMethodCallNode(expr as MethodCallNode);
    } else if (t === "new") {
      this.visitNewNode(expr as NewNode);
    } else if (t === "this") {
      this.visitThisNode(expr as ThisNode);
    } else if (t === "super") {
      this.visitSuperNode(expr as SuperNode);
    } else if (t === "unary") {
      this.visitUnaryNode(expr as UnaryNode);
    } else if (t === "template_literal") {
      this.visitTemplateLiteralNode(expr as TemplateLiteralNode);
    } else if (t === "arrow_function") {
      this.visitArrowFunctionNode(expr as ArrowFunctionNode);
    } else if (t === "conditional") {
      this.visitConditionalExpressionNode(expr as ConditionalExpressionNode);
    } else if (t === "await") {
      this.visitAwaitExpressionNode(expr as AwaitExpressionNode);
    } else if (t === "member_access_assignment") {
      this.visitMemberAccessAssignmentNode(expr as MemberAccessAssignmentNode);
    } else if (t === "index_access_assignment") {
      this.visitIndexAccessAssignmentNode(expr as IndexAccessAssignmentNode);
    } else if (t === "type_assertion") {
      this.visitTypeAssertionNode(expr as TypeAssertionNode);
    } else if (t === "spread_element") {
      this.visitSpreadElementNode(expr as SpreadElementNode);
    }
  }

  // ============================================
  // Expression visitors (override in subclasses)
  // ============================================

  visitNumberNode(_node: NumberNode): void {}
  visitStringNode(_node: StringNode): void {}
  visitBooleanNode(_node: BooleanNode): void {}
  visitNullNode(_node: NullNode): void {}
  visitUndefinedNode(_node: UndefinedNode): void {}
  visitRegexNode(_node: RegexNode): void {}

  visitVariableNode(_node: VariableNode): void {}

  visitMemberAccessNode(node: MemberAccessNode): void {
    this.visitExpression(node.object);
  }

  visitIndexAccessNode(node: IndexAccessNode): void {
    this.visitExpression(node.object);
    this.visitExpression(node.index);
  }

  visitArrayNode(node: ArrayNode): void {
    for (let i = 0; i < node.elements.length; i++) {
      this.visitExpression(node.elements[i]);
    }
  }

  visitObjectNode(node: ObjectNode): void {
    for (let i = 0; i < node.properties.length; i++) {
      this.visitExpression(node.properties[i].value);
    }
  }

  visitMapNode(node: MapNode): void {
    for (let i = 0; i < node.entries.length; i++) {
      this.visitExpression(node.entries[i].key);
      this.visitExpression(node.entries[i].value);
    }
  }

  visitSetNode(node: SetNode): void {
    for (let i = 0; i < node.values.length; i++) {
      this.visitExpression(node.values[i]);
    }
  }

  visitBinaryNode(node: BinaryNode): void {
    this.visitExpression(node.left);
    this.visitExpression(node.right);
  }

  visitCallNode(node: CallNode): void {
    for (let i = 0; i < node.args.length; i++) {
      this.visitExpression(node.args[i]);
    }
  }

  visitMethodCallNode(node: MethodCallNode): void {
    this.visitExpression(node.object);
    for (let i = 0; i < node.args.length; i++) {
      this.visitExpression(node.args[i]);
    }
  }

  visitNewNode(node: NewNode): void {
    for (let i = 0; i < node.args.length; i++) {
      this.visitExpression(node.args[i]);
    }
  }

  visitThisNode(_node: ThisNode): void {}
  visitSuperNode(_node: SuperNode): void {}

  visitUnaryNode(node: UnaryNode): void {
    this.visitExpression(node.operand);
  }

  visitTemplateLiteralNode(node: TemplateLiteralNode): void {
    for (let i = 0; i < node.parts.length; i++) {
      const part = node.parts[i];
      if (typeof part !== "string") {
        this.visitExpression(part);
      }
    }
  }

  visitArrowFunctionNode(node: ArrowFunctionNode): void {
    const body = node.body;
    const b = body as { type: string };
    if (b.type === "block") {
      this.visitBlock(body as BlockStatement);
    } else {
      this.visitExpression(body as Expression);
    }
  }

  visitConditionalExpressionNode(node: ConditionalExpressionNode): void {
    this.visitExpression(node.condition);
    this.visitExpression(node.consequent);
    this.visitExpression(node.alternate);
  }

  visitAwaitExpressionNode(node: AwaitExpressionNode): void {
    this.visitExpression(node.argument);
  }

  visitMemberAccessAssignmentNode(node: MemberAccessAssignmentNode): void {
    this.visitExpression(node.object);
    this.visitExpression(node.value);
  }

  visitIndexAccessAssignmentNode(node: IndexAccessAssignmentNode): void {
    this.visitExpression(node.object);
    this.visitExpression(node.index);
    this.visitExpression(node.value);
  }

  visitTypeAssertionNode(node: TypeAssertionNode): void {
    this.visitExpression(node.expression);
  }

  visitSpreadElementNode(node: SpreadElementNode): void {
    this.visitExpression(node.argument);
  }
}

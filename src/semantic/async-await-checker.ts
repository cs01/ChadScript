import type {
  AST,
  Statement,
  Expression,
  BlockStatement,
  VariableDeclaration,
  IfStatement,
  WhileStatement,
  DoWhileStatement,
  ForStatement,
  ForOfStatement,
  TryStatement,
  SwitchStatement,
  ReturnStatement,
  ThrowStatement,
  CallNode,
  SourceLocation,
  AssignmentStatement,
  AwaitExpressionNode,
  BinaryNode,
  UnaryNode,
  MethodCallNode,
  MemberAccessNode,
  IndexAccessNode,
  ArrayNode,
  ObjectNode,
  TemplateLiteralNode,
  ConditionalExpressionNode,
  ArrowFunctionNode,
  NewNode,
  TypeAssertionNode,
  SpreadElementNode,
  MemberAccessAssignmentNode,
  IndexAccessAssignmentNode,
  MapNode,
  SetNode,
  MapEntry,
} from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

export function checkAsyncAwait(ast: AST, sourceCode: string): void {
  const asyncFuncNames: string[] = [];
  for (let i = 0; i < ast.functions.length; i++) {
    if (ast.functions[i].async === true) {
      asyncFuncNames.push(ast.functions[i].name);
    }
  }
  if (asyncFuncNames.length === 0) return;

  const checker = new AsyncAwaitChecker(sourceCode, asyncFuncNames);
  checker.checkAST(ast);
}

class AsyncAwaitChecker {
  private sourceCode: string;
  private asyncFuncNames: string[];

  constructor(sourceCode: string, asyncFuncNames: string[]) {
    this.sourceCode = sourceCode;
    this.asyncFuncNames = asyncFuncNames;
  }

  private isAsyncFunc(name: string): boolean {
    return this.asyncFuncNames.indexOf(name) !== -1;
  }

  checkAST(ast: AST): void {
    for (let i = 0; i < ast.functions.length; i++) {
      const fn = ast.functions[i];
      this.walkBlock(fn.body, fn.async === true);
    }

    for (let i = 0; i < ast.classes.length; i++) {
      const cls = ast.classes[i];
      for (let j = 0; j < cls.methods.length; j++) {
        const method = cls.methods[j];
        this.walkBlock(method.body, false);
      }
    }
  }

  private walkStatements(stmts: Statement[], insideAsync: boolean): void {
    for (let i = 0; i < stmts.length; i++) {
      this.walkStatement(stmts[i], insideAsync);
    }
  }

  private walkBlock(block: BlockStatement, insideAsync: boolean): void {
    this.walkStatements(block.statements, insideAsync);
  }

  private walkStatement(stmt: Statement, insideAsync: boolean): void {
    const s = stmt as { type: string };
    const stype = s.type;

    if (stype === "variable_declaration") {
      const decl = stmt as VariableDeclaration;
      if (decl.value !== null && decl.value !== undefined) {
        this.checkExpr(decl.value as Expression, insideAsync);
      }
    } else if (stype === "assignment") {
      const assign = stmt as AssignmentStatement;
      this.checkExpr(assign.value, insideAsync);
    } else if (stype === "if") {
      const ifStmt = stmt as IfStatement;
      this.checkExpr(ifStmt.condition, insideAsync);
      this.walkBlock(ifStmt.thenBlock, insideAsync);
      if (ifStmt.elseBlock !== null && ifStmt.elseBlock !== undefined) {
        this.walkBlock(ifStmt.elseBlock, insideAsync);
      }
    } else if (stype === "while") {
      const whileStmt = stmt as WhileStatement;
      this.checkExpr(whileStmt.condition, insideAsync);
      this.walkBlock(whileStmt.body, insideAsync);
    } else if (stype === "do_while") {
      const doWhileStmt = stmt as DoWhileStatement;
      this.walkBlock(doWhileStmt.body, insideAsync);
      this.checkExpr(doWhileStmt.condition, insideAsync);
    } else if (stype === "for") {
      const forStmt = stmt as ForStatement;
      if (forStmt.init !== null && forStmt.init !== undefined) {
        this.walkStatement(forStmt.init as Statement, insideAsync);
      }
      if (forStmt.condition !== null && forStmt.condition !== undefined) {
        this.checkExpr(forStmt.condition, insideAsync);
      }
      this.walkBlock(forStmt.body, insideAsync);
      if (forStmt.update !== null && forStmt.update !== undefined) {
        const upd = forStmt.update as { type: string };
        if (upd.type === "assignment") {
          this.walkStatement(forStmt.update as Statement, insideAsync);
        } else {
          this.checkExpr(forStmt.update as Expression, insideAsync);
        }
      }
    } else if (stype === "for_of") {
      const forOfStmt = stmt as ForOfStatement;
      this.checkExpr(forOfStmt.iterable, insideAsync);
      this.walkBlock(forOfStmt.body, insideAsync);
    } else if (stype === "try") {
      const tryStmt = stmt as TryStatement;
      this.walkBlock(tryStmt.tryBlock, insideAsync);
      if (tryStmt.catchBody !== null && tryStmt.catchBody !== undefined) {
        this.walkBlock(tryStmt.catchBody, insideAsync);
      }
      if (tryStmt.finallyBlock !== null && tryStmt.finallyBlock !== undefined) {
        this.walkBlock(tryStmt.finallyBlock, insideAsync);
      }
    } else if (stype === "switch") {
      const switchStmt = stmt as SwitchStatement;
      this.checkExpr(switchStmt.discriminant, insideAsync);
      for (let ci = 0; ci < switchStmt.cases.length; ci++) {
        const c = switchStmt.cases[ci];
        if (c.test !== null && c.test !== undefined) {
          this.checkExpr(c.test as Expression, insideAsync);
        }
        this.walkStatements(c.consequent, insideAsync);
      }
    } else if (stype === "return") {
      const retStmt = stmt as ReturnStatement;
      if (retStmt.value !== null && retStmt.value !== undefined) {
        this.checkExpr(retStmt.value as Expression, insideAsync);
      }
    } else if (stype === "throw") {
      const throwStmt = stmt as ThrowStatement;
      this.checkExpr(throwStmt.argument, insideAsync);
    } else if (stype === "block") {
      this.walkBlock(stmt as BlockStatement, insideAsync);
    } else if (stype !== "break" && stype !== "continue") {
      // Pass isStmtLevel=true so a bare async call as a statement
      // (fire-and-forget) is allowed — there's no return value to misuse.
      this.checkExpr(stmt as Expression, insideAsync, true);
    }
  }

  private checkExpr(expr: Expression, insideAsync: boolean, isStmtLevel: boolean = false): void {
    const e = expr as { type: string };
    const etype = e.type;

    if (etype === "call") {
      const callExpr = expr as CallNode;
      // Disallow async-without-await UNLESS the call is the whole statement
      // (fire-and-forget). When it's a sub-expression the Promise pointer
      // would be used as a string / number / object and crash — that's the
      // case we want to catch. Bare `asyncFn();` just discards the returned
      // Promise handle, which is safe (GC'd when nobody's awaiting).
      if (!insideAsync && !isStmtLevel && this.isAsyncFunc(callExpr.name)) {
        this.reportError(callExpr.name, callExpr.loc);
      }
      for (let i = 0; i < callExpr.args.length; i++) {
        this.checkExpr(callExpr.args[i], insideAsync);
      }
    } else if (etype === "await") {
      const awaitExpr = expr as AwaitExpressionNode;
      this.checkExpr(awaitExpr.argument, true);
    } else if (etype === "binary") {
      const binExpr = expr as BinaryNode;
      this.checkExpr(binExpr.left, insideAsync);
      this.checkExpr(binExpr.right, insideAsync);
    } else if (etype === "unary") {
      const unaryExpr = expr as UnaryNode;
      this.checkExpr(unaryExpr.operand, insideAsync);
    } else if (etype === "method_call") {
      const mcExpr = expr as MethodCallNode;
      this.checkExpr(mcExpr.object, insideAsync);
      for (let i = 0; i < mcExpr.args.length; i++) {
        this.checkExpr(mcExpr.args[i], insideAsync);
      }
    } else if (etype === "member_access") {
      const maExpr = expr as MemberAccessNode;
      this.checkExpr(maExpr.object, insideAsync);
    } else if (etype === "index_access") {
      const iaExpr = expr as IndexAccessNode;
      this.checkExpr(iaExpr.object, insideAsync);
      this.checkExpr(iaExpr.index, insideAsync);
    } else if (etype === "array") {
      const arrExpr = expr as ArrayNode;
      for (let i = 0; i < arrExpr.elements.length; i++) {
        this.checkExpr(arrExpr.elements[i], insideAsync);
      }
    } else if (etype === "object") {
      const objExpr = expr as ObjectNode;
      for (let i = 0; i < objExpr.properties.length; i++) {
        this.checkExpr(objExpr.properties[i].value, insideAsync);
      }
    } else if (etype === "template_literal") {
      const tlExpr = expr as TemplateLiteralNode;
      for (let i = 0; i < tlExpr.parts.length; i++) {
        const part = tlExpr.parts[i];
        const partTyped = part as { type: string };
        if (partTyped.type) {
          this.checkExpr(part as Expression, insideAsync);
        }
      }
    } else if (etype === "conditional") {
      const condExpr = expr as ConditionalExpressionNode;
      this.checkExpr(condExpr.condition, insideAsync);
      this.checkExpr(condExpr.consequent, insideAsync);
      this.checkExpr(condExpr.alternate, insideAsync);
    } else if (etype === "arrow_function") {
      const arrow = expr as ArrowFunctionNode;
      const arrowAsync = arrow.async === true;
      const bodyTyped = arrow.body as { type: string };
      if (bodyTyped.type === "block") {
        this.walkBlock(arrow.body as BlockStatement, arrowAsync);
      } else {
        this.checkExpr(arrow.body as Expression, arrowAsync);
      }
    } else if (etype === "new") {
      const newExpr = expr as NewNode;
      for (let i = 0; i < newExpr.args.length; i++) {
        this.checkExpr(newExpr.args[i], insideAsync);
      }
    } else if (etype === "type_assertion") {
      const taExpr = expr as TypeAssertionNode;
      this.checkExpr(taExpr.expression, insideAsync);
    } else if (etype === "spread_element") {
      const seExpr = expr as AwaitExpressionNode;
      this.checkExpr(seExpr.argument, insideAsync);
    } else if (etype === "member_access_assignment") {
      const maaExpr = expr as MemberAccessAssignmentNode;
      this.checkExpr(maaExpr.object, insideAsync);
      this.checkExpr(maaExpr.value, insideAsync);
    } else if (etype === "index_access_assignment") {
      const iaaExpr = expr as IndexAccessAssignmentNode;
      this.checkExpr(iaaExpr.object, insideAsync);
      this.checkExpr(iaaExpr.index, insideAsync);
      this.checkExpr(iaaExpr.value, insideAsync);
    } else if (etype === "map") {
      const mapExpr = expr as MapNode;
      for (let i = 0; i < mapExpr.entries.length; i++) {
        this.checkExpr(mapExpr.entries[i].key, insideAsync);
        this.checkExpr(mapExpr.entries[i].value, insideAsync);
      }
    } else if (etype === "set") {
      const setExpr = expr as SetNode;
      for (let i = 0; i < setExpr.values.length; i++) {
        this.checkExpr(setExpr.values[i], insideAsync);
      }
    }
  }

  private reportError(funcName: string, loc?: SourceLocation): void {
    const output = formatCompileError(
      this.sourceCode,
      "async function '" + funcName + "()' called without await",
      loc,
      "add 'await' before the call: await " + funcName + "(...)",
      [
        "calling an async function without await returns a Promise pointer, not the resolved value",
        "this will cause a crash at runtime when the Promise pointer is used as a string or object",
      ],
    );
    process.stderr.write(output);
    process.exit(1);
  }
}

// Call-result index-subscript hazard checker.
//
// Rule: `f()[expr]` where `expr` (or any of its subtree) contains a function
// or method call is banned. Bind the call result to a local first.
//
// Reproducible hazard: chad uses Boehm conservative GC. LLVM SSA register
// promotion can place the result of `f()` in a register only — never spilled
// to a stack slot. If `expr` triggers another allocation (any call), Boehm
// can't see the register-only pointer, collects the array, and subsequent
// indexing reads freed memory. This was the actual cause of the #682 /
// #689 'Stage 0→1 segfault' class: `getErrors()[getErrors().length - 1]`
// in emitError.
//
// Forcing users to bind to a local (`const arr = f(); arr[expr]`) puts the
// pointer on the stack where Boehm can scan it. The cost is one extra
// line; the win is eliminating a whole class of silent miscompiles.
//
// Follow-on issue #688 covers the deeper codegen fix (auto-root all pointer
// SSA values). Until that ships, this sema rule prevents the pattern from
// appearing in new code.

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
  SwitchCase,
  ReturnStatement,
  AssignmentStatement,
  BinaryNode,
  UnaryNode,
  ConditionalExpressionNode,
  CallNode,
  MethodCallNode,
  MemberAccessNode,
  IndexAccessNode,
  TypeAssertionNode,
  ObjectNode,
  ObjectProperty,
  ArrayNode,
  TemplateLiteralNode,
  SourceLocation,
} from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

const CALL_RESULT_INDEX_GRANDFATHERED: string[] = [];

function isCallResultIndexGrandfathered(filename: string): boolean {
  if (!filename) return false;
  for (let i = 0; i < CALL_RESULT_INDEX_GRANDFATHERED.length; i++) {
    if (filename.endsWith(CALL_RESULT_INDEX_GRANDFATHERED[i])) return true;
  }
  return false;
}

export function checkCallResultIndex(ast: AST, sourceCode: string, filename?: string): void {
  if (filename && isCallResultIndexGrandfathered(filename)) return;
  const checker = new CallResultIndexChecker(sourceCode);
  checker.check(ast);
}

class CallResultIndexChecker {
  constructor(private sourceCode: string) {}

  check(ast: AST): void {
    const items = ast.topLevelItems;
    if (items && items.length > 0) this.walkStatements(items as Statement[]);
    for (let i = 0; i < ast.functions.length; i++) this.walkBlock(ast.functions[i].body);
    for (let i = 0; i < ast.classes.length; i++) {
      const cls = ast.classes[i];
      for (let j = 0; j < cls.methods.length; j++) this.walkBlock(cls.methods[j].body);
    }
  }

  private walkBlock(block: BlockStatement): void {
    if (!block || !block.statements) return;
    this.walkStatements(block.statements);
  }

  private walkStatements(stmts: Statement[]): void {
    for (let i = 0; i < stmts.length; i++) this.walkStatement(stmts[i]);
  }

  private walkStatement(stmt: Statement): void {
    if (!stmt) return;
    const t = (stmt as { type: string }).type;
    if (!t) return;
    if (t === "variable_declaration") {
      const decl = stmt as VariableDeclaration;
      if (decl.value) this.walkExpr(decl.value);
    } else if (t === "return") {
      const ret = stmt as ReturnStatement;
      if (ret.value) this.walkExpr(ret.value);
    } else if (t === "assignment") {
      this.walkExpr((stmt as AssignmentStatement).value);
    } else if (t === "if") {
      const ifStmt = stmt as IfStatement;
      this.walkExpr(ifStmt.condition);
      this.walkBlock(ifStmt.thenBlock);
      if (ifStmt.elseBlock) this.walkBlock(ifStmt.elseBlock);
    } else if (t === "while") {
      const w = stmt as WhileStatement;
      this.walkExpr(w.condition);
      this.walkBlock(w.body);
    } else if (t === "do_while") {
      const dw = stmt as DoWhileStatement;
      this.walkExpr(dw.condition);
      this.walkBlock(dw.body);
    } else if (t === "for") {
      const forStmt = stmt as ForStatement;
      if (forStmt.init) {
        const init = forStmt.init as { type: string };
        if (init.type === "variable_declaration") {
          const d = forStmt.init as VariableDeclaration;
          if (d.value) this.walkExpr(d.value);
        }
      }
      if (forStmt.condition) this.walkExpr(forStmt.condition);
      this.walkBlock(forStmt.body);
    } else if (t === "for_of") {
      this.walkBlock((stmt as ForOfStatement).body);
    } else if (t === "try") {
      const tryStmt = stmt as TryStatement;
      this.walkBlock(tryStmt.tryBlock);
      if (tryStmt.catchBody) this.walkBlock(tryStmt.catchBody);
      if (tryStmt.finallyBlock) this.walkBlock(tryStmt.finallyBlock);
    } else if (t === "switch") {
      const sw = stmt as SwitchStatement;
      this.walkExpr(sw.discriminant);
      for (let i = 0; i < sw.cases.length; i++) {
        this.walkStatements((sw.cases[i] as SwitchCase).consequent);
      }
    } else {
      this.walkExpr(stmt as Expression);
    }
  }

  private walkExpr(expr: Expression): void {
    if (!expr) return;
    const e = expr as { type: string };
    if (e.type === "index_access") {
      const ia = expr as IndexAccessNode;
      this.checkIndexAccess(ia);
      this.walkExpr(ia.object);
      this.walkExpr(ia.index);
    } else if (e.type === "binary") {
      const bin = expr as BinaryNode;
      this.walkExpr(bin.left);
      this.walkExpr(bin.right);
    } else if (e.type === "unary") {
      this.walkExpr((expr as UnaryNode).operand);
    } else if (e.type === "conditional") {
      const cond = expr as ConditionalExpressionNode;
      this.walkExpr(cond.condition);
      this.walkExpr(cond.consequent);
      this.walkExpr(cond.alternate);
    } else if (e.type === "call") {
      const call = expr as CallNode;
      for (let i = 0; i < call.args.length; i++) this.walkExpr(call.args[i]);
    } else if (e.type === "method_call") {
      const mc = expr as MethodCallNode;
      this.walkExpr(mc.object);
      for (let i = 0; i < mc.args.length; i++) this.walkExpr(mc.args[i]);
    } else if (e.type === "member_access") {
      this.walkExpr((expr as MemberAccessNode).object);
    } else if (e.type === "type_assertion") {
      this.walkExpr((expr as TypeAssertionNode).expression);
    } else if (e.type === "object") {
      const obj = expr as ObjectNode;
      for (let i = 0; i < obj.properties.length; i++) {
        this.walkExpr((obj.properties[i] as ObjectProperty).value);
      }
    } else if (e.type === "array") {
      const arr = expr as ArrayNode;
      if (arr.elements) {
        for (let i = 0; i < arr.elements.length; i++) this.walkExpr(arr.elements[i]);
      }
    } else if (e.type === "template_literal") {
      const tl = expr as TemplateLiteralNode;
      if (tl.parts) {
        for (let i = 0; i < tl.parts.length; i++) {
          const part = tl.parts[i];
          if (typeof part !== "string") this.walkExpr(part);
        }
      }
    }
  }

  private checkIndexAccess(ia: IndexAccessNode): void {
    const objBase = ia.object as { type: string };
    if (objBase.type !== "call" && objBase.type !== "method_call") return;
    // Object side is a direct call. Index side must be free of calls.
    if (this.exprContainsCall(ia.index)) {
      this.report(ia.loc);
    }
  }

  private exprContainsCall(expr: Expression): boolean {
    if (!expr) return false;
    const e = expr as { type: string };
    if (e.type === "call" || e.type === "method_call") return true;
    if (e.type === "binary") {
      const bin = expr as BinaryNode;
      return this.exprContainsCall(bin.left) || this.exprContainsCall(bin.right);
    }
    if (e.type === "unary") return this.exprContainsCall((expr as UnaryNode).operand);
    if (e.type === "conditional") {
      const c = expr as ConditionalExpressionNode;
      return (
        this.exprContainsCall(c.condition) ||
        this.exprContainsCall(c.consequent) ||
        this.exprContainsCall(c.alternate)
      );
    }
    if (e.type === "member_access") return this.exprContainsCall((expr as MemberAccessNode).object);
    if (e.type === "index_access") {
      const ia = expr as IndexAccessNode;
      return this.exprContainsCall(ia.object) || this.exprContainsCall(ia.index);
    }
    if (e.type === "type_assertion") {
      return this.exprContainsCall((expr as TypeAssertionNode).expression);
    }
    return false;
  }

  private report(loc: SourceLocation | undefined): void {
    const output = formatCompileError(
      this.sourceCode,
      "indexing a call result with an expression that contains another call is unsafe — bind the call result to a local first",
      loc,
      "const tmp = f(); tmp[expr]  // instead of  f()[expr]",
      [
        "chad uses Boehm conservative GC. the call result can live in a register only; the second call's allocation may trigger GC and collect it, leaving the index reading freed memory",
        "root cause: PR #689's emitError segfault was `getErrors()[getErrors().length - 1]` — same pattern",
        "deeper fix (codegen auto-root): issue #688",
      ],
    );
    process.stderr.write(output);
    process.exit(1);
  }
}

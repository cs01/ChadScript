// Or-fallback opacification checker.
//
// Rule: `expr || { ... }` and `expr ?? { ... }` (and array literal variants)
// are banned. The merged result becomes type `i8*` (opaque pointer) at the
// LLVM level because the two branches produce different concrete types,
// and subsequent member access on the result reads garbage.
//
// Reproducible bug (synthetic test, native compiler):
//   const b = getBox() || { items: ["x"], name: "default" };
//   console.log("count=" + b.items.length);  // prints "count=13339968"
//
// Fix: rewrite as a ternary that preserves the typed path:
//   const b = getBox() ? getBox() : { items: ["x"], name: "default" };
// or pull the existence check up:
//   let b = getBox();
//   if (!b) b = { items: [...], name: "default" };
//
// Severity: ERROR (process.exit(1)). Existing offenders go in
// GRANDFATHERED_FILES; the list only ever shrinks.

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
  ConditionalExpressionNode,
  CallNode,
  MethodCallNode,
  TypeAssertionNode,
  ObjectNode,
  ObjectProperty,
  SourceLocation,
} from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

// Files that already contained `||` / `??` typed-literal fallbacks when this
// check landed. Each migration PR removes a path. The list only ever shrinks.
// When empty, delete the constant + isGrandfathered helper.
//
// Adding to this list requires explicit reviewer signoff in a separate PR.
const GRANDFATHERED_FILES: string[] = [];

function isGrandfathered(filename: string): boolean {
  if (!filename) return false;
  for (let i = 0; i < GRANDFATHERED_FILES.length; i++) {
    if (filename.endsWith(GRANDFATHERED_FILES[i])) return true;
  }
  return false;
}

export function checkOrFallback(ast: AST, sourceCode: string, filename?: string): void {
  if (filename && isGrandfathered(filename)) return;
  const checker = new OrFallbackChecker(sourceCode);
  checker.check(ast);
}

class OrFallbackChecker {
  constructor(private sourceCode: string) {}

  check(ast: AST): void {
    const items = ast.topLevelItems;
    if (items && items.length > 0) {
      this.walkStatements(items as Statement[]);
    }
    for (let i = 0; i < ast.functions.length; i++) {
      this.walkBlock(ast.functions[i].body);
    }
    for (let i = 0; i < ast.classes.length; i++) {
      const cls = ast.classes[i];
      for (let j = 0; j < cls.methods.length; j++) {
        this.walkBlock(cls.methods[j].body);
      }
    }
  }

  private walkBlock(block: BlockStatement): void {
    if (!block || !block.statements) return;
    this.walkStatements(block.statements);
  }

  private walkStatements(stmts: Statement[]): void {
    for (let i = 0; i < stmts.length; i++) {
      this.walkStatement(stmts[i]);
    }
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
          const decl = forStmt.init as VariableDeclaration;
          if (decl.value) this.walkExpr(decl.value);
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
      // Fallback: bare expression statements (e.g. `stack.push(...)`).
      // Without this fallback, the walker silently skipped `||` fallbacks
      // inside method-call arguments — which is exactly how the symbol-table
      // crash at `objectMetadata || { keys: [], types: [] }` slipped past
      // the checker on first ship. Don't remove.
      this.walkExpr(stmt as Expression);
    }
  }

  private walkExpr(expr: Expression): void {
    if (!expr) return;
    const e = expr as { type: string };

    if (e.type === "binary") {
      const bin = expr as BinaryNode;
      if (bin.op === "||" || bin.op === "??") {
        this.checkOrFallback(bin);
      }
      this.walkExpr(bin.left);
      this.walkExpr(bin.right);
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
      for (let i = 0; i < mc.args.length; i++) this.walkExpr(mc.args[i]);
    } else if (e.type === "type_assertion") {
      this.walkExpr((expr as TypeAssertionNode).expression);
    } else if (e.type === "object") {
      const obj = expr as ObjectNode;
      for (let i = 0; i < obj.properties.length; i++) {
        this.walkExpr((obj.properties[i] as ObjectProperty).value);
      }
    }
  }

  private checkOrFallback(bin: BinaryNode): void {
    const leftKind = this.literalKind(bin.left);
    const rightKind = this.literalKind(bin.right);
    // Hazard: exactly one side is an object/array literal. Both-literal cases
    // are pointless but not unsafe (and don't appear in practice). Neither-
    // side-literal is the normal coalesce — safe.
    if (leftKind && !rightKind) {
      this.report(bin.op, leftKind, "left", bin.loc);
    } else if (rightKind && !leftKind) {
      this.report(bin.op, rightKind, "right", bin.loc);
    }
  }

  private literalKind(expr: Expression): string | null {
    if (!expr) return null;
    const t = (expr as { type: string }).type;
    // Only OBJECT literal fallbacks are hazardous. Array literals of
    // homogeneous type (`x || []`) are fine because both branches share the
    // same %Array* / %StringArray* LLVM type and member access compiles
    // identically. Object literals create a fresh opaque shape that almost
    // never matches the named-interface type of the other branch — that's
    // the EXP5 reproducible bug. (Original ban included arrays; narrowed
    // after probing src/ found 1 false positive on `paramTypes || []`.)
    if (t === "object") return "object literal";
    return null;
  }

  private report(op: string, kind: string, side: string, loc: SourceLocation | undefined): void {
    const output = formatCompileError(
      this.sourceCode,
      "'" +
        op +
        "' fallback to " +
        kind +
        " (on the " +
        side +
        ") opacifies the result type — subsequent member access reads garbage memory",
      loc,
      "use a ternary or split the assignment so the typed path is preserved",
      [
        "fix: 'const x = expr ? expr : { ... }' or 'let x = expr; if (!x) x = { ... }'",
        "synthetic repro: getBox() || { items: ['x'] } then .items.length prints garbage like 13339968",
      ],
    );
    process.stderr.write(output);
    process.exit(1);
  }
}

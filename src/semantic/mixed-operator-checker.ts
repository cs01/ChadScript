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
  BinaryNode,
  VariableNode,
  FunctionNode,
  SourceLocation,
  ReturnStatement,
  AssignmentStatement,
  ConditionalExpressionNode,
  CallNode,
  MethodCallNode,
} from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

type LlvmKind = "ptr" | "double" | "i1" | "unknown";

function declaredTypeToKind(t: string): LlvmKind {
  if (t === "number") return "double";
  if (t === "boolean") return "i1";
  return "ptr"; // string, class, interface, array, Map, Set, etc.
}

export function checkMixedOperators(ast: AST, sourceCode: string): void {
  const checker = new MixedOperatorChecker(sourceCode);
  checker.check(ast);
}

class MixedOperatorChecker {
  private scope: Map<string, LlvmKind> = new Map();

  constructor(private sourceCode: string) {}

  check(ast: AST): void {
    const items = ast.topLevelItems;
    if (items && items.length > 0) {
      this.walkStatements(items as Statement[]);
    }

    for (let i = 0; i < ast.functions.length; i++) {
      this.checkFunction(ast.functions[i]);
    }

    for (let i = 0; i < ast.classes.length; i++) {
      const cls = ast.classes[i];
      for (let j = 0; j < cls.methods.length; j++) {
        this.checkFunction(cls.methods[j] as unknown as FunctionNode);
      }
    }
  }

  private checkFunction(fn: FunctionNode): void {
    if (fn.params && fn.paramTypes) {
      for (let i = 0; i < fn.params.length; i++) {
        const pt = fn.paramTypes[i];
        if (pt) this.scope.set(fn.params[i], declaredTypeToKind(pt));
      }
    }
    this.walkBlock(fn.body);
  }

  private walkBlock(block: BlockStatement): void {
    this.walkStatements(block.statements);
  }

  private walkStatements(stmts: Statement[]): void {
    for (let i = 0; i < stmts.length; i++) {
      this.walkStatement(stmts[i]);
    }
  }

  private walkStatement(stmt: Statement): void {
    const t = (stmt as { type: string }).type;

    if (t === "variable_declaration") {
      const decl = stmt as VariableDeclaration;
      if (decl.declaredType) {
        this.scope.set(decl.name, declaredTypeToKind(decl.declaredType));
      }
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
          if (decl.declaredType) this.scope.set(decl.name, declaredTypeToKind(decl.declaredType));
          if (decl.value) this.walkExpr(decl.value);
        }
      }
      if (forStmt.condition) this.walkExpr(forStmt.condition);
      if (forStmt.update) this.walkExpr(forStmt.update as Expression);
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
      // standalone expression statement (call, method_call, etc.)
      this.walkExpr(stmt as Expression);
    }
  }

  private walkExpr(expr: Expression): void {
    if (!expr) return;
    const e = expr as { type: string };

    if (e.type === "binary") {
      const bin = expr as BinaryNode;
      if (bin.op === "||" || bin.op === "??") {
        const leftKind = this.exprKind(bin.left);
        const rightKind = this.exprKind(bin.right);
        if (leftKind !== "unknown" && rightKind !== "unknown" && leftKind !== rightKind) {
          this.report(bin.op, leftKind, rightKind, bin.loc);
        }
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
      for (let i = 0; i < call.args.length; i++) {
        this.walkExpr(call.args[i]);
      }
    } else if (e.type === "method_call") {
      const mc = expr as MethodCallNode;
      for (let i = 0; i < mc.args.length; i++) {
        this.walkExpr(mc.args[i]);
      }
    }
  }

  private exprKind(expr: Expression): LlvmKind {
    if (!expr) return "unknown";
    const e = expr as { type: string };
    if (e.type === "number") return "double";
    if (e.type === "string") return "ptr";
    if (e.type === "boolean") return "i1";
    if (e.type === "variable") {
      const v = expr as VariableNode;
      if (v.name === "null" || v.name === "undefined") return "unknown";
      const known = this.scope.get(v.name);
      return known !== undefined ? known : "unknown";
    }
    // null/undefined literals from TS parser — skip, they're pointer-compatible
    if (e.type === "null" || e.type === "undefined") return "unknown";
    return "unknown";
  }

  private report(
    op: string,
    leftKind: LlvmKind,
    rightKind: LlvmKind,
    loc: SourceLocation | undefined,
  ): void {
    const kindLabel = (k: LlvmKind): string => {
      if (k === "ptr") return "string/object (i8*)";
      if (k === "double") return "number (double)";
      if (k === "i1") return "boolean (i1)";
      return "unknown";
    };
    const output = formatCompileError(
      this.sourceCode,
      "type mismatch in '" +
        op +
        "': left operand is " +
        kindLabel(leftKind) +
        ", right operand is " +
        kindLabel(rightKind),
      loc,
      "both sides of '" + op + "' must have the same LLVM representation",
      ["use a ternary with explicit types: 'left !== null ? left : right'"],
    );
    process.stderr.write(output);
    process.exit(1);
  }
}

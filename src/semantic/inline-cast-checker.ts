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
  FunctionNode,
  ClassMethod,
  ReturnStatement,
  AssignmentStatement,
  ConditionalExpressionNode,
  CallNode,
  MethodCallNode,
  TypeAssertionNode,
  SourceLocation,
} from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

export function checkInlineCasts(ast: AST, sourceCode: string): void {
  const checker = new InlineCastChecker(sourceCode);
  checker.check(ast);
}

class InlineCastChecker {
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
    if (!stmts) return;
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
      this.walkExpr(stmt as Expression);
    }
  }

  private walkExpr(expr: Expression): void {
    if (!expr) return;
    const e = expr as { type: string };

    if (e.type === "type_assertion") {
      const ta = expr as TypeAssertionNode;
      const asserted = ta.assertedType;
      if (asserted && asserted.trim().charAt(0) === "{") {
        this.report(asserted, ta.loc);
      }
      this.walkExpr(ta.expression);
    } else if (e.type === "binary") {
      const bin = expr as BinaryNode;
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

  private report(assertedType: string, loc: SourceLocation | undefined): void {
    const output = formatCompileError(
      this.sourceCode,
      "inline type assertion 'as { ... }' is unsafe — field order must exactly match the LLVM struct layout",
      loc,
      "declare a named interface or use an existing type from src/ast/types.ts",
      [
        "replace 'expr as { field: Type }' with a named interface: 'interface Foo { field: Type }' then 'expr as Foo'",
      ],
    );
    process.stderr.write(output);
    process.exit(1);
  }
}

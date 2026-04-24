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

// Grandfather list — files that already contained inline `as { ... }` casts
// when this checker landed. The rule is at full ERROR severity for everyone
// else; existing offenders are skipped only because we can't migrate 430
// casts in one PR. Each migration PR removes a path from this list. The
// list only ever shrinks. When it's empty, delete this constant and the
// `isGrandfathered` check.
//
// Adding a new entry requires a separate PR with explicit reviewer signoff;
// we never want this list to grow.
const GRANDFATHERED_FILES: string[] = [
  "src/analysis/semantic-analyzer.ts",
  "src/ast/visitor.ts",
  "src/chad-node.ts",
  "src/codegen/expressions/access/chained-access.ts",
  "src/codegen/expressions/access/index.ts",
  "src/codegen/expressions/access/member.ts",
  "src/codegen/expressions/arrow-functions.ts",
  "src/codegen/expressions/calls.ts",
  "src/codegen/expressions/literals.ts",
  "src/codegen/expressions/method-calls.ts",
  "src/codegen/expressions/method-calls/class-dispatch.ts",
  "src/codegen/expressions/method-calls/map-dispatch.ts",
  "src/codegen/expressions/method-calls/object-static.ts",
  "src/codegen/expressions/method-calls/promise-handlers.ts",
  "src/codegen/expressions/method-calls/string-dispatch.ts",
  "src/codegen/expressions/orchestrator.ts",
  "src/codegen/expressions/templates.ts",
  "src/codegen/infrastructure/array-allocator.ts",
  "src/codegen/infrastructure/assignment-generator.ts",
  "src/codegen/infrastructure/class-allocator.ts",
  "src/codegen/infrastructure/closure-analyzer.ts",
  "src/codegen/infrastructure/function-generator.ts",
  "src/codegen/infrastructure/generator-context.ts",
  "src/codegen/infrastructure/int-specialization-detector.ts",
  "src/codegen/infrastructure/interface-allocator.ts",
  "src/codegen/infrastructure/map-allocator.ts",
  "src/codegen/infrastructure/type-inference.ts",
  "src/codegen/infrastructure/type-resolver/type-resolver.ts",
  "src/codegen/infrastructure/variable-allocator.ts",
  "src/codegen/llvm-generator.ts",
  "src/codegen/statements/control-flow.ts",
  "src/codegen/statements/for-of.ts",
  "src/codegen/statements/loop-idiom.ts",
  "src/codegen/stdlib/embed.ts",
  "src/codegen/stdlib/json.ts",
  "src/codegen/stdlib/response.ts",
  "src/codegen/types/collections/array.ts",
  "src/codegen/types/collections/array/combine.ts",
  "src/codegen/types/collections/array/literal.ts",
  "src/codegen/types/interface-struct-generator.ts",
  "src/codegen/types/objects/class.ts",
  "src/codegen/types/objects/object.ts",
  "src/compiler.ts",
  "src/diagnostics/tracers.ts",
  "src/native-compiler-lib.ts",
  "src/parser-native/transformer.ts",
  "src/semantic/ambiguous-init-checker.ts",
  "src/semantic/array-of-function-checker.ts",
  "src/semantic/async-await-checker.ts",
  "src/semantic/binary-type-checker.ts",
  "src/semantic/closure-mutation-checker.ts",
  "src/semantic/escape-analysis.ts",
  "src/semantic/inline-cast-checker.ts",
  "src/semantic/interface-layout-normalizer.ts",
  "src/semantic/mixed-operator-checker.ts",
  "src/semantic/safety-checks.ts",
  "src/semantic/type-annotator.ts",
  "src/semantic/type-assertion-checker.ts",
  "src/semantic/uninitialized-field-checker.ts",
  "src/semantic/union-type-checker.ts",
];

function isGrandfathered(filename: string): boolean {
  if (!filename) return false;
  for (let i = 0; i < GRANDFATHERED_FILES.length; i++) {
    if (filename.endsWith(GRANDFATHERED_FILES[i])) return true;
  }
  return false;
}

export function checkInlineCasts(ast: AST, sourceCode: string, filename?: string): void {
  if (filename && isGrandfathered(filename)) return;
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

import type {
  AST,
  Statement,
  Expression,
  BlockStatement,
  VariableDeclaration,
  IfStatement,
  WhileStatement,
  ForStatement,
  ForOfStatement,
  TryStatement,
  SwitchStatement,
  SwitchCase,
  ReturnStatement,
  AssignmentStatement,
  ArrowFunctionNode,
  MethodCallNode,
  VariableNode,
  CallNode,
  MemberAccessNode,
  IndexAccessNode,
  TypeAssertionNode,
  ObjectProperty,
  MapEntry,
  NewNode,
  BinaryNode,
  UnaryNode,
  ConditionalExpressionNode,
  AwaitExpressionNode,
  ArrayNode,
  ObjectNode,
  MapNode,
  SetNode,
  SourceLocation,
  ImportDeclaration,
} from "../ast/types.js";
import { formatCompileError } from "../diagnostics/engine.js";

const BUILTIN_MODULES = new Set<string>([
  "fs",
  "path",
  "os",
  "child_process",
  "process",
  "console",
  "assert",
  "net",
  "tls",
  "crypto",
  "http",
  "https",
  "url",
  "util",
  "stream",
  "events",
  "buffer",
  "dgram",
  "dns",
  "readline",
  "zlib",
]);

export function checkUnsupportedPatterns(ast: AST, sourceCode: string): void {
  const imports = ast.imports || [];
  const nonRelativeImports: string[] = [];
  const nonRelativeSpecifiers: string[][] = [];
  for (let i = 0; i < imports.length; i++) {
    const imp = imports[i] as ImportDeclaration;
    if (!imp) continue;
    const src = imp.source;
    const isRelative = src.startsWith("./") || src.startsWith("../") || src.startsWith("/");
    if (!isRelative && !BUILTIN_MODULES.has(src) && imp.specifiers && imp.specifiers.length > 0) {
      nonRelativeImports.push(src);
      nonRelativeSpecifiers.push(imp.specifiers);
    }
  }

  const checker = new PatternChecker(sourceCode, nonRelativeImports, nonRelativeSpecifiers);
  if (ast.topLevelItems && ast.topLevelItems.length > 0) {
    checker.walkStatements(ast.topLevelItems as Statement[]);
  }
  for (let i = 0; i < ast.functions.length; i++) {
    checker.walkBlock(ast.functions[i].body);
  }
  for (let i = 0; i < ast.classes.length; i++) {
    const cls = ast.classes[i];
    for (let j = 0; j < cls.methods.length; j++) {
      checker.walkBlock(cls.methods[j].body);
    }
  }
}

class PatternChecker {
  private sourceCode: string;
  private nonRelativeImports: string[];
  private nonRelativeSpecifiers: string[][];

  constructor(sourceCode: string, nonRelativeImports: string[], nonRelativeSpecifiers: string[][]) {
    this.sourceCode = sourceCode;
    this.nonRelativeImports = nonRelativeImports;
    this.nonRelativeSpecifiers = nonRelativeSpecifiers;
  }

  walkStatements(stmts: Statement[]): void {
    for (let i = 0; i < stmts.length; i++) {
      this.walkStatement(stmts[i]);
    }
  }

  walkBlock(block: BlockStatement): void {
    this.walkStatements(block.statements);
  }

  private walkStatement(stmt: Statement): void {
    const s = stmt as { type: string };
    const stype = s.type;
    if (stype === "variable_declaration") {
      const decl = stmt as VariableDeclaration;
      if (decl.value) this.checkExpr(decl.value as Expression);
    } else if (stype === "assignment") {
      const asgn = stmt as AssignmentStatement;
      this.checkExpr(asgn.value);
    } else if (stype === "if") {
      const ifStmt = stmt as IfStatement;
      this.checkExpr(ifStmt.condition);
      this.walkBlock(ifStmt.thenBlock);
      if (ifStmt.elseBlock) this.walkBlock(ifStmt.elseBlock);
    } else if (stype === "while") {
      const w = stmt as WhileStatement;
      this.checkExpr(w.condition);
      this.walkBlock(w.body);
    } else if (stype === "for") {
      const f = stmt as ForStatement;
      if (f.init) this.walkStatement(f.init as Statement);
      if (f.condition) this.checkExpr(f.condition as Expression);
      this.walkBlock(f.body);
      if (f.update) this.checkExpr(f.update as Expression);
    } else if (stype === "for_of") {
      const fo = stmt as ForOfStatement;
      this.checkExpr(fo.iterable);
      this.walkBlock(fo.body);
    } else if (stype === "try") {
      const t = stmt as TryStatement;
      this.walkBlock(t.tryBlock);
      if (t.catchBody) this.walkBlock(t.catchBody);
      if (t.finallyBlock) this.walkBlock(t.finallyBlock);
    } else if (stype === "switch") {
      const sw = stmt as SwitchStatement;
      this.checkExpr(sw.discriminant);
      for (let i = 0; i < sw.cases.length; i++) {
        const c = sw.cases[i] as SwitchCase;
        if (c.test) this.checkExpr(c.test as Expression);
        this.walkStatements(c.consequent);
      }
    } else if (stype === "return") {
      const r = stmt as ReturnStatement;
      if (r.value) this.checkExpr(r.value as Expression);
    } else if (stype === "block") {
      this.walkBlock(stmt as BlockStatement);
    } else if (stype !== "break" && stype !== "continue" && stype !== "throw") {
      this.checkExpr(stmt as Expression);
    }
  }

  private checkExpr(expr: Expression): void {
    if (!expr) return;
    const e = expr as { type: string };
    const etype = e.type;
    if (etype === "method_call") {
      const mc = expr as MethodCallNode;
      if (mc.method === "") {
        this.emitIIFE(mc.loc);
      }
      if (mc.object && (mc.object as { type: string }).type === "variable") {
        const varName = (mc.object as VariableNode).name;
        this.checkUnsupportedModule(varName, mc.method, mc.loc);
      }
      this.checkExpr(mc.object);
      for (let i = 0; i < mc.args.length; i++) {
        this.checkExpr(mc.args[i]);
      }
    } else if (etype === "call") {
      const c = expr as CallNode;
      for (let i = 0; i < c.args.length; i++) {
        this.checkExpr(c.args[i]);
      }
    } else if (etype === "binary") {
      const b = expr as BinaryNode;
      this.checkExpr(b.left);
      this.checkExpr(b.right);
    } else if (etype === "unary") {
      const u = expr as UnaryNode;
      this.checkExpr(u.operand);
    } else if (etype === "member_access") {
      const ma = expr as MemberAccessNode;
      this.checkExpr(ma.object);
    } else if (etype === "index_access") {
      const ia = expr as IndexAccessNode;
      this.checkExpr(ia.object);
      this.checkExpr(ia.index);
    } else if (etype === "type_assertion") {
      const ta = expr as TypeAssertionNode;
      this.checkExpr(ta.expression);
    } else if (etype === "array") {
      const arr = expr as ArrayNode;
      for (let i = 0; i < arr.elements.length; i++) {
        this.checkExpr(arr.elements[i]);
      }
    } else if (etype === "object") {
      const obj = expr as ObjectNode;
      for (let i = 0; i < obj.properties.length; i++) {
        this.checkExpr((obj.properties[i] as ObjectProperty).value);
      }
    } else if (etype === "conditional") {
      const cond = expr as ConditionalExpressionNode;
      this.checkExpr(cond.condition);
      this.checkExpr(cond.consequent);
      this.checkExpr(cond.alternate);
    } else if (etype === "arrow_function") {
      const arrow = expr as ArrowFunctionNode;
      const bodyTyped = arrow.body as { type: string };
      if (bodyTyped.type === "block") {
        this.walkBlock(arrow.body as BlockStatement);
      } else {
        this.checkExpr(arrow.body as Expression);
      }
    } else if (etype === "new") {
      const n = expr as NewNode;
      for (let i = 0; i < n.args.length; i++) {
        this.checkExpr(n.args[i]);
      }
    } else if (etype === "await") {
      const aw = expr as AwaitExpressionNode;
      this.checkExpr(aw.argument);
    } else if (etype === "map") {
      const m = expr as MapNode;
      for (let i = 0; i < m.entries.length; i++) {
        const entry = m.entries[i] as MapEntry;
        this.checkExpr(entry.key);
        this.checkExpr(entry.value);
      }
    } else if (etype === "set") {
      const s = expr as SetNode;
      for (let i = 0; i < s.values.length; i++) {
        this.checkExpr(s.values[i]);
      }
    }
  }

  private checkUnsupportedModule(
    varName: string,
    method: string,
    loc: SourceLocation | undefined,
  ): void {
    for (let i = 0; i < this.nonRelativeImports.length; i++) {
      const specifiers = this.nonRelativeSpecifiers[i];
      for (let j = 0; j < specifiers.length; j++) {
        if (specifiers[j] === varName) {
          const output = formatCompileError(
            this.sourceCode,
            "'" +
              varName +
              "." +
              method +
              "()' — module '" +
              this.nonRelativeImports[i] +
              "' is not supported by ChadScript",
            loc,
            "ChadScript only supports relative imports and built-in modules",
            [],
          );
          process.stderr.write(output);
          process.exit(1);
        }
      }
    }
  }

  private emitIIFE(loc: SourceLocation | undefined): void {
    const output = formatCompileError(
      this.sourceCode,
      "Immediately invoked function expressions (IIFE) are not supported",
      loc,
      "assign the function to a variable and call it separately",
      [],
    );
    process.stderr.write(output);
    process.exit(1);
  }
}

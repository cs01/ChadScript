// AST type annotator — populates the expression-type cache BEFORE codegen
// runs. Replaces scattered, lazy re-derivation of types at each codegen site
// with a single up-front pass.
//
// Design intent: make `ctx.typeOf(expr)` a pure lookup. Codegen never asks
// TypeInference directly; this pass fills the table so codegen reads and
// emits LLVM, nothing more.
//
// Starts small — annotates the expression kinds where typeOf is currently
// consumed. Expands as more codegen sites migrate to typeOf.

import type {
  AST,
  Expression,
  Statement,
  BlockStatement,
  VariableDeclaration,
  AssignmentStatement,
  IfStatement,
  WhileStatement,
  DoWhileStatement,
  ForStatement,
  ForOfStatement,
  TryStatement,
  SwitchStatement,
  ReturnStatement,
  ThrowStatement,
  ArrowFunctionNode,
  MethodCallNode,
  CallNode,
  MemberAccessNode,
  IndexAccessNode,
  BinaryNode,
  UnaryNode,
  ConditionalExpressionNode,
  AwaitExpressionNode,
  ObjectNode,
  ObjectProperty,
  ArrayNode,
  MapEntry,
  MapNode,
  SetNode,
  SpreadElementNode,
  TemplateLiteralNode,
  TypeAssertionNode,
  NewNode,
  MemberAccessAssignmentNode,
  IndexAccessAssignmentNode,
} from "../ast/types.js";
import type { ResolvedType } from "../codegen/infrastructure/type-system.js";

// The annotator speaks to codegen through a narrow interface so this pass
// can be unit-tested against a mock, and so the concrete LLVMGenerator can
// evolve without breaking this file.
export interface TypeAnnotatorSink {
  resolveExpressionTypeRich(expr: Expression): ResolvedType | null;
  appendExpressionType(expr: Expression, type: ResolvedType): void;
}

export function annotateTypes(ast: AST, sink: TypeAnnotatorSink): void {
  const walker = new TypeAnnotator(sink);
  walker.walkAST(ast);
}

class TypeAnnotator {
  private sink: TypeAnnotatorSink;

  constructor(sink: TypeAnnotatorSink) {
    this.sink = sink;
  }

  walkAST(ast: AST): void {
    if (ast.topLevelItems && ast.topLevelItems.length > 0) {
      this.walkStmts(ast.topLevelItems as Statement[]);
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

  private walkStmts(stmts: Statement[]): void {
    for (let i = 0; i < stmts.length; i++) {
      this.walkStmt(stmts[i]);
    }
  }

  private walkBlock(block: BlockStatement): void {
    this.walkStmts(block.statements);
  }

  private walkStmt(stmt: Statement): void {
    const s = stmt as { type: string };
    const t = s.type;
    if (t === "variable_declaration") {
      const decl = stmt as VariableDeclaration;
      if (decl.value) this.visitExpr(decl.value as Expression);
    } else if (t === "assignment") {
      const a = stmt as AssignmentStatement;
      this.visitExpr(a.value);
    } else if (t === "if") {
      const i = stmt as IfStatement;
      this.visitExpr(i.condition);
      this.walkBlock(i.thenBlock);
      if (i.elseBlock) this.walkBlock(i.elseBlock);
    } else if (t === "while") {
      const w = stmt as WhileStatement;
      this.visitExpr(w.condition);
      this.walkBlock(w.body);
    } else if (t === "do_while") {
      const dw = stmt as DoWhileStatement;
      this.walkBlock(dw.body);
      this.visitExpr(dw.condition);
    } else if (t === "for") {
      const f = stmt as ForStatement;
      if (f.init) this.walkStmt(f.init as Statement);
      if (f.condition) this.visitExpr(f.condition as Expression);
      this.walkBlock(f.body);
      if (f.update) this.visitExpr(f.update as Expression);
    } else if (t === "for_of") {
      const fo = stmt as ForOfStatement;
      this.visitExpr(fo.iterable);
      this.walkBlock(fo.body);
    } else if (t === "try") {
      const tr = stmt as TryStatement;
      this.walkBlock(tr.tryBlock);
      if (tr.catchBody) this.walkBlock(tr.catchBody);
      if (tr.finallyBlock) this.walkBlock(tr.finallyBlock);
    } else if (t === "switch") {
      const sw = stmt as SwitchStatement;
      this.visitExpr(sw.discriminant);
      for (let ci = 0; ci < sw.cases.length; ci++) {
        const c = sw.cases[ci];
        if (c.test) this.visitExpr(c.test as Expression);
        this.walkStmts(c.consequent);
      }
    } else if (t === "return") {
      const r = stmt as ReturnStatement;
      if (r.value) this.visitExpr(r.value as Expression);
    } else if (t === "throw") {
      const th = stmt as ThrowStatement;
      this.visitExpr(th.argument);
    } else if (t === "block") {
      this.walkBlock(stmt as BlockStatement);
    } else if (t !== "break" && t !== "continue") {
      this.visitExpr(stmt as Expression);
    }
  }

  // Post-order: annotate children first so parent resolvers see already-
  // cached sub-expression types.
  private visitExpr(expr: Expression): void {
    if (!expr) return;
    const e = expr as { type: string };
    const t = e.type;

    if (t === "binary") {
      const b = expr as BinaryNode;
      this.visitExpr(b.left);
      this.visitExpr(b.right);
    } else if (t === "unary") {
      const u = expr as UnaryNode;
      this.visitExpr(u.operand);
    } else if (t === "call") {
      const c = expr as CallNode;
      for (let i = 0; i < c.args.length; i++) this.visitExpr(c.args[i]);
    } else if (t === "method_call") {
      const mc = expr as MethodCallNode;
      this.visitExpr(mc.object);
      for (let i = 0; i < mc.args.length; i++) this.visitExpr(mc.args[i]);
    } else if (t === "member_access") {
      const ma = expr as MemberAccessNode;
      this.visitExpr(ma.object);
    } else if (t === "index_access") {
      const ia = expr as IndexAccessNode;
      this.visitExpr(ia.object);
      this.visitExpr(ia.index);
    } else if (t === "array") {
      const ar = expr as ArrayNode;
      for (let i = 0; i < ar.elements.length; i++) this.visitExpr(ar.elements[i]);
    } else if (t === "object") {
      const ob = expr as ObjectNode;
      for (let i = 0; i < ob.properties.length; i++) {
        const prop = ob.properties[i] as ObjectProperty;
        this.visitExpr(prop.value);
      }
    } else if (t === "conditional") {
      const co = expr as ConditionalExpressionNode;
      this.visitExpr(co.condition);
      this.visitExpr(co.consequent);
      this.visitExpr(co.alternate);
    } else if (t === "await") {
      const aw = expr as AwaitExpressionNode;
      this.visitExpr(aw.argument);
    } else if (t === "new") {
      const n = expr as NewNode;
      for (let i = 0; i < n.args.length; i++) this.visitExpr(n.args[i]);
    } else if (t === "arrow_function") {
      const af = expr as ArrowFunctionNode;
      const body = af.body as { type: string };
      if (body.type === "block") {
        this.walkBlock(af.body as BlockStatement);
      } else {
        this.visitExpr(af.body as Expression);
      }
    } else if (t === "template_literal") {
      const tl = expr as TemplateLiteralNode;
      for (let i = 0; i < tl.parts.length; i++) {
        const part = tl.parts[i];
        const pt = part as { type: string };
        if (pt.type) this.visitExpr(part as Expression);
      }
    } else if (t === "spread_element") {
      const se = expr as SpreadElementNode;
      this.visitExpr(se.argument);
    } else if (t === "member_access_assignment") {
      const maa = expr as MemberAccessAssignmentNode;
      this.visitExpr(maa.object);
      this.visitExpr(maa.value);
    } else if (t === "index_access_assignment") {
      const iaa = expr as IndexAccessAssignmentNode;
      this.visitExpr(iaa.object);
      this.visitExpr(iaa.index);
      this.visitExpr(iaa.value);
    } else if (t === "map") {
      const m = expr as MapNode;
      for (let i = 0; i < m.entries.length; i++) {
        const entry = m.entries[i] as MapEntry;
        this.visitExpr(entry.key);
        this.visitExpr(entry.value);
      }
    } else if (t === "set") {
      const s = expr as SetNode;
      for (let i = 0; i < s.values.length; i++) this.visitExpr(s.values[i]);
    } else if (t === "type_assertion") {
      const ta = expr as TypeAssertionNode;
      this.visitExpr(ta.expression);
    }

    // After recursion, annotate this expression — but ONLY for truly-static
    // shapes. Array / map / set / object / new / binary / conditional all
    // recurse through variable / symbol-table lookups whose answers depend
    // on codegen-time state the annotator doesn't yet see; caching them
    // would freeze a pre-codegen wrong answer. Typed-literal and
    // template_literal results are stable (always same base). Everything
    // else gets resolved live by typeOf's fallback.
    if (!this.isStableExprType(e.type)) return;
    const resolved = this.sink.resolveExpressionTypeRich(expr);
    if (resolved && resolved.base && resolved.base !== "unknown") {
      this.sink.appendExpressionType(expr, resolved);
    }
  }

  private isStableExprType(t: string): boolean {
    return (
      t === "number" ||
      t === "string" ||
      t === "template_literal" ||
      t === "boolean" ||
      t === "null" ||
      t === "regex"
    );
  }
}

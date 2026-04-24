// AST type annotator — populates the expression-type cache BEFORE codegen
// runs. Replaces scattered, lazy re-derivation of types at each codegen site
// with a single up-front pass.
//
// Design intent: make `ctx.typeOf(expr)` a pure lookup. Codegen never asks
// TypeInference directly; this pass fills the table so codegen reads and
// emits LLVM, nothing more.
//
// Piece 1 scope: annotate (a) primitive literals whose types are trivially
// stable, and (b) `variable` reads where the declared type at the declaration
// site is a concrete non-union, non-nullable shape (plain primitive, array,
// interface, or class). This is the narrow subset where the declared-type
// answer is authoritative and cannot be invalidated by mid-codegen symbol-
// table refinement. Union / nullable / inferred types are deliberately NOT
// cached — those are Piece 2/3 (index_access, ternary narrowing).

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
  FunctionNode,
  ClassNode,
  ClassMethod,
  FunctionParameter,
  VariableNode,
} from "../ast/types.js";
import type { ResolvedType } from "../codegen/infrastructure/type-system.js";

// The annotator speaks to codegen through a narrow interface so this pass
// can be unit-tested against a mock, and so the concrete LLVMGenerator can
// evolve without breaking this file.
export interface TypeAnnotatorSink {
  resolveExpressionTypeRich(expr: Expression): ResolvedType | null;
  appendExpressionType(expr: Expression, type: ResolvedType): void;
  // Resolve a declared-type string (e.g. "string", "Node[]", "Map<string,number>")
  // to a ResolvedType. Returns null if the string is a union or otherwise
  // non-representable by a single ResolvedType.
  resolveDeclaredTypeString(typeStr: string): ResolvedType | null;
}

export function annotateTypes(ast: AST, sink: TypeAnnotatorSink): void {
  const walker = new TypeAnnotator(sink);
  walker.walkAST(ast);
}

// Per-scope env: maps variable name → declared ResolvedType. Each entry
// also records whether the binding came from a function parameter or a
// let/const declaration — Piece 1 only uses parameter bindings for
// `variable` annotation (decl bindings live here but don't feed the cache
// yet; Piece 3 will wire them in once refinement interactions are handled).
type BindingKind = "param" | "decl";
type ScopeEnv = { names: string[]; types: ResolvedType[]; kinds: BindingKind[] };

class TypeAnnotator {
  private sink: TypeAnnotatorSink;
  // Scope stack. Innermost scope is last.
  private scopes: ScopeEnv[];

  // Counters for optional debug reporting — only logged when
  // ANNOTATOR_STATS env is set.
  public statLiterals: number = 0;
  public statVariables: number = 0;
  public statParams: number = 0;
  public statDecls: number = 0;

  constructor(sink: TypeAnnotatorSink) {
    this.sink = sink;
    this.scopes = [];
  }

  getStats(): { literals: number; variables: number; params: number; decls: number } {
    return {
      literals: this.statLiterals,
      variables: this.statVariables,
      params: this.statParams,
      decls: this.statDecls,
    };
  }

  private pushScope(): void {
    this.scopes.push({ names: [], types: [], kinds: [] });
  }

  private popScope(): void {
    this.scopes.pop();
  }

  private defineInCurrentScope(name: string, type: ResolvedType, kind: BindingKind): void {
    if (this.scopes.length === 0) return;
    const top = this.scopes[this.scopes.length - 1];
    top.names.push(name);
    top.types.push(type);
    top.kinds.push(kind);
  }

  // Look up by innermost-first scope, but only return parameter bindings.
  // Shadowing by a decl binding hides an outer param binding (same scoping
  // rule TypeScript applies), so we must still traverse the name list
  // innermost-first and return null on the first match if it's a decl.
  private lookupParam(name: string): ResolvedType | null {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const sc = this.scopes[i];
      for (let j = sc.names.length - 1; j >= 0; j--) {
        if (sc.names[j] === name) {
          return sc.kinds[j] === "param" ? sc.types[j] : null;
        }
      }
    }
    return null;
  }

  // A declared-type string is safely annotatable if it's a single, concrete,
  // non-nullable shape. Union types (`A | B`) and nullable (`T | null`) are
  // deliberately excluded because method dispatch and narrowing on them
  // require Piece 3 work.
  private isSafelyAnnotatable(typeStr: string | undefined): boolean {
    if (!typeStr) return false;
    const t = typeStr.trim();
    if (t.length === 0) return false;
    if (t.indexOf("|") !== -1) return false;
    if (t.indexOf("?") !== -1) return false;
    if (t === "any" || t === "unknown" || t === "void" || t === "never") return false;
    if (t.indexOf("=>") !== -1) return false;
    if (t.indexOf("&") !== -1) return false;
    if (t.indexOf("{") !== -1) return false;
    return true;
  }

  walkAST(ast: AST): void {
    this.pushScope();
    if (ast.topLevelItems && ast.topLevelItems.length > 0) {
      this.walkStmts(ast.topLevelItems as Statement[]);
    }
    for (let i = 0; i < ast.functions.length; i++) {
      this.walkFunction(ast.functions[i]);
    }
    for (let i = 0; i < ast.classes.length; i++) {
      const cls = ast.classes[i];
      for (let j = 0; j < cls.methods.length; j++) {
        this.walkClassMethod(cls, cls.methods[j]);
      }
    }
    this.popScope();
  }

  private walkFunction(fn: FunctionNode): void {
    this.pushScope();
    this.bindParameters(fn.parameters, fn.params, fn.paramTypes);
    this.walkBlock(fn.body);
    this.popScope();
  }

  private walkClassMethod(_cls: ClassNode, m: ClassMethod): void {
    this.pushScope();
    this.bindParameters(m.parameters, m.params, m.paramTypes);
    this.walkBlock(m.body);
    this.popScope();
  }

  private bindParameters(
    parameters: FunctionParameter[] | undefined,
    paramNames: string[] | undefined,
    paramTypes: string[] | undefined,
  ): void {
    // Prefer the rich FunctionParameter[] form when present.
    if (parameters && parameters.length > 0) {
      for (let i = 0; i < parameters.length; i++) {
        const p = parameters[i];
        if (!p.name || !p.type) continue;
        if (!this.isSafelyAnnotatable(p.type)) continue;
        const rt = this.sink.resolveDeclaredTypeString(p.type);
        if (rt) {
          this.defineInCurrentScope(p.name, rt, "param");
          this.statParams++;
        }
      }
      return;
    }
    // Fallback: parallel arrays on the function node.
    if (!paramNames || !paramTypes) return;
    const n = paramNames.length < paramTypes.length ? paramNames.length : paramTypes.length;
    for (let i = 0; i < n; i++) {
      const name = paramNames[i];
      const t = paramTypes[i];
      if (!name || !t) continue;
      if (!this.isSafelyAnnotatable(t)) continue;
      const rt = this.sink.resolveDeclaredTypeString(t);
      if (rt) {
        this.defineInCurrentScope(name, rt, "param");
        this.statParams++;
      }
    }
  }

  private walkStmts(stmts: Statement[]): void {
    for (let i = 0; i < stmts.length; i++) {
      this.walkStmt(stmts[i]);
    }
  }

  private walkBlock(block: BlockStatement): void {
    this.pushScope();
    this.walkStmts(block.statements);
    this.popScope();
  }

  private walkStmt(stmt: Statement): void {
    const s = stmt as { type: string };
    const t = s.type;
    if (t === "variable_declaration") {
      const decl = stmt as VariableDeclaration;
      if (decl.value) this.visitExpr(decl.value as Expression);
      // Record declared type in current scope AFTER walking init (init
      // may reference the outer binding of `decl.name` if shadowing).
      if (decl.name && this.isSafelyAnnotatable(decl.declaredType)) {
        const rt = this.sink.resolveDeclaredTypeString(decl.declaredType!);
        if (rt) {
          this.defineInCurrentScope(decl.name, rt, "decl");
          this.statDecls++;
        }
      }
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
      this.pushScope();
      if (f.init) this.walkStmt(f.init as Statement);
      if (f.condition) this.visitExpr(f.condition as Expression);
      this.walkStmts(f.body.statements);
      if (f.update) this.visitExpr(f.update as Expression);
      this.popScope();
    } else if (t === "for_of") {
      const fo = stmt as ForOfStatement;
      this.visitExpr(fo.iterable);
      this.pushScope();
      // The iteration variable's type is derived from the iterable — don't
      // annotate it here; iterable resolution is Piece 2/3 territory.
      this.walkStmts(fo.body.statements);
      this.popScope();
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
      this.pushScope();
      const body = af.body as { type: string };
      if (body.type === "block") {
        this.walkStmts((af.body as BlockStatement).statements);
      } else {
        this.visitExpr(af.body as Expression);
      }
      this.popScope();
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

    // After recursion, annotate this expression.
    // Stable primitive literals: always safe.
    if (this.isStableExprType(e.type)) {
      const resolved = this.sink.resolveExpressionTypeRich(expr);
      if (resolved && resolved.base && resolved.base !== "unknown") {
        this.sink.appendExpressionType(expr, resolved);
        this.statLiterals++;
      }
      return;
    }
    // Variable reads bound to function parameters. Parameter types fixed at
    // function entry, never refined mid-codegen. Issue #658 gate-loosen step 1.
    if (e.type === "variable") {
      const v = expr as VariableNode;
      const bound = this.lookupParam(v.name);
      if (bound && this.isSafeVariableAnnotationType(bound)) {
        this.sink.appendExpressionType(expr, bound);
        this.statVariables++;
      }
      return;
    }
    // Member access whose resolved type is a concrete class. Interfaces
    // excluded — the previous attempt (#662) included them, which passed
    // arm64 CI + macOS but segfaulted on x86-64 Stage 0→1 self-hosting
    // (reverted in #666). Root cause TBD; class-only is the safe subset
    // reproduced stable across both arches via scripts/linux-x64.sh.
    // Issue #658 gate-loosen step 2 (partial).
    if (e.type === "member_access") {
      const resolved = this.sink.resolveExpressionTypeRich(expr);
      if (resolved) {
        if (resolved.sourceKind === "class" && this.isSafeVariableAnnotationType(resolved)) {
          this.sink.appendExpressionType(expr, resolved);
        } else if (this.isSafePrimitiveMemberAccess(resolved)) {
          // Issue #658 step 4. Narrowest safe primitive cell — `.length` /
          // `.size` on arrays/strings/maps/sets. Resolved base is "number",
          // sourceKind=primitive, arrayDepth=0. Stable LLVM type (double),
          // independent of source-collection layout. Per #658 data: 459
          // codegen-time miss events on chad-native; zero hit-diff predicted
          // because resolver is pure (#672) and result kind is closed-form.
          this.sink.appendExpressionType(expr, resolved);
        }
      }
      return;
    }
    // Type assertions (`x as Foo`). Result type is the literal AST string
    // `assertedType` — independent of symbol-table state and stable across
    // codegen phases. Real-world data (#658 comment 2026-04-22): 1611
    // codegen-time miss events on chad-native.ts; zero hit-diff after
    // admission would be observable in any cell already in the cache. Gated
    // through isSafeVariableAnnotationType so only sourceKind=class|interface
    // with arrayDepth=0 land in the cache — matches the safe subset the
    // member_access admission uses.
    if (e.type === "type_assertion") {
      const ta = expr as TypeAssertionNode;
      if (!this.isSafelyAnnotatable(ta.assertedType)) return;
      const resolved = this.sink.resolveExpressionTypeRich(expr);
      // Class-only — interface assertions destabilized stage 2 self-hosting
      // (same arch-divergence class as #662; native dispatch through interface
      // cache mismatched live-resolve). Re-evaluate after Tier 3 #11
      // (interface concretization pass).
      if (
        resolved &&
        resolved.sourceKind === "class" &&
        this.isSafeVariableAnnotationType(resolved)
      ) {
        this.sink.appendExpressionType(expr, resolved);
      }
      return;
    }
    // let/const decl bindings and interface-typed params are intentionally
    // skipped. Decl bindings can be refined mid-codegen (JSON.parse target
    // type, await result specialization); caching the declared type would
    // override the refinement. Interface params need live-resolution so
    // method-call dispatch sees the concrete implementing class instead of
    // the interface answer (which breaks class-dispatch's vtable lookup —
    // see isSafeVariableAnnotationType).
  }

  // A ResolvedType from a parameter declaration is safe to install in the
  // annotator cache for variable reads only when the LLVM representation is
  // fully determined by the base name. Classes and interfaces qualify.
  // Primitives, arrays, typed-arrays, Map, and Set have a family of LLVM
  // layouts that codegen chooses from at symbol-definition time, so the
  // declared answer can disagree with the symbol table's allocated storage
  // and produce wrong IR.
  // Narrow primitive admission for member_access only. Restricted to
  // base="number", arrayDepth=0, sourceKind=primitive, no nullable. Covers
  // `.length` / `.size`. Avoids string/boolean to keep the cell narrow —
  // boolean has i1↔double crossings in interface structs and string has
  // null-vs-empty edge cases.
  private isSafePrimitiveMemberAccess(rt: ResolvedType): boolean {
    if (rt.sourceKind !== "primitive") return false;
    if (rt.arrayDepth > 0) return false;
    if (rt.qualifiers.isNullable) return false;
    if (rt.base !== "number") return false;
    return true;
  }

  private isSafeVariableAnnotationType(rt: ResolvedType): boolean {
    if (rt.arrayDepth > 0) return false;
    if (rt.qualifiers.isNullable) return false;
    const b = rt.base;
    if (b === "number" || b === "string" || b === "boolean") return false;
    if (b === "null" || b === "void" || b === "unknown" || b === "any") return false;
    if (b.startsWith("Map<") || b.startsWith("Set<") || b.startsWith("Array<")) return false;
    if (b === "Uint8Array" || b === "ArrayBuffer" || b === "Int32Array") return false;
    if (rt.sourceKind !== "class" && rt.sourceKind !== "interface") return false;
    return true;
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

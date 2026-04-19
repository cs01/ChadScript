// Interface layout normalizer — ChadScript's equivalent of clang's InitListChecker.
//
// PROBLEM: object literals were emitted with properties in SOURCE ORDER. Two sites
// creating the same interface with different property orders (or missing optional
// fields) produced different LLVM struct layouts. GEP offsets computed from the
// interface declaration didn't match, causing garbage reads / segfaults (the
// original motivation for CLAUDE.md rule #3).
//
// THIS PASS: walks the AST; for every ObjectNode whose target type is a known
// interface, rewrites the properties array to match the interface's declared
// field order, filling missing fields with type-appropriate null/0/false
// literals. After this pass, object literal property order is invariant of
// user source order and always canonical. Codegen can always GEP by
// declaration index.
//
// Target-type resolution (matches clang's InitListChecker model):
//   1. `const x: I = {...}` — variable declaration with declaredType
//   2. `{...} as I` — type assertion
//   3. function / method / arrow return value where returnType is I
//   4. class field initializer with declared field type I (via tsType)
//   5. nested: property value when parent field's type is a known interface
//
// Unknown extra properties (not declared on the interface) are kept at the end —
// a later diagnostic pass can warn on them. This pass never drops data.

import type {
  AST,
  Expression,
  ObjectNode,
  ObjectProperty,
  InterfaceDeclaration,
  InterfaceField,
  VariableDeclaration,
  FunctionNode,
  ClassNode,
  ClassMethod,
  ClassField,
  TypeAssertionNode,
  Statement,
  ReturnStatement,
  IfStatement,
  WhileStatement,
  DoWhileStatement,
  ForStatement,
  ForOfStatement,
  BlockStatement,
  TryStatement,
  SwitchStatement,
  SwitchCase,
  ThrowStatement,
  BinaryNode,
  UnaryNode,
  CallNode,
  MethodCallNode,
  MemberAccessNode,
  IndexAccessNode,
  ConditionalExpressionNode,
  ArrowFunctionNode,
  NewNode,
  ArrayNode,
  AssignmentStatement,
  AwaitExpressionNode,
  SourceLocation,
} from "../ast/types.js";

function normStripOptional(name: string): string {
  if (name.endsWith("?")) return name.slice(0, name.length - 1);
  return name;
}

function normStripNullable(t: string): string {
  if (!t) return "";
  let s = t.trim();
  s = s.replace(" | null", "");
  s = s.replace(" | undefined", "");
  s = s.replace("null | ", "");
  s = s.replace("undefined | ", "");
  if (s.endsWith("?")) s = s.slice(0, s.length - 1);
  return s.trim();
}

function defaultLiteralFor(tsType: string, loc: SourceLocation | undefined): Expression {
  const t = normStripNullable(tsType);
  if (t === "number") {
    return { type: "number", value: 0, loc } as unknown as Expression;
  }
  if (t === "boolean") {
    return { type: "boolean", value: false, loc } as unknown as Expression;
  }
  return { type: "null", loc } as unknown as Expression;
}

export class InterfaceLayoutNormalizer {
  private ifaceNames: string[] = [];
  private ifaceDecls: InterfaceDeclaration[] = [];
  private reorderEnabled: boolean = true;
  private injectDefaultsEnabled: boolean = true;

  constructor(interfaces: InterfaceDeclaration[]) {
    for (let i = 0; i < interfaces.length; i++) {
      this.ifaceNames.push(interfaces[i].name);
      this.ifaceDecls.push(interfaces[i]);
    }
  }

  setFlags(reorder: boolean, injectDefaults: boolean): void {
    this.reorderEnabled = reorder;
    this.injectDefaultsEnabled = injectDefaults;
  }

  private lookupInterface(name: string): InterfaceDeclaration | null {
    const idx = this.ifaceNames.indexOf(name);
    if (idx === -1) return null;
    return this.ifaceDecls[idx];
  }

  private hasInterface(name: string): boolean {
    return this.ifaceNames.indexOf(name) !== -1;
  }

  // Flatten fields: extended interface fields first (deepest parent first),
  // then own fields. Mirrors InterfaceStructGenerator.getInheritedFields.
  private getAllFields(iface: InterfaceDeclaration): InterfaceField[] {
    const result: InterfaceField[] = [];
    const seen: string[] = [];
    this.collectFields(iface, result, seen);
    return result;
  }

  private collectFields(iface: InterfaceDeclaration, out: InterfaceField[], seen: string[]): void {
    if (seen.indexOf(iface.name) !== -1) return;
    seen.push(iface.name);
    if (iface.extends) {
      for (let i = 0; i < iface.extends.length; i++) {
        const parent = this.lookupInterface(iface.extends[i]);
        if (parent) this.collectFields(parent, out, seen);
      }
    }
    if (iface.fields) {
      for (let i = 0; i < iface.fields.length; i++) {
        out.push(iface.fields[i]);
      }
    }
  }

  // Rewrite obj.properties in place to canonical declaration order. Missing
  // fields are filled with type-appropriate defaults. Extra (unknown) props
  // stay at the end. Idempotent: re-applying is a no-op.
  normalizeObjectToInterface(obj: ObjectNode, interfaceName: string): void {
    const iface = this.lookupInterface(interfaceName);
    if (!iface) return;
    const fields = this.getAllFields(iface);
    if (fields.length === 0) return;

    // Lookup tables keyed by property name. Parallel string[]+Expression[] so
    // this pass self-hosts (Map<string,Expression> isn't supported in native).
    const existingKeys: string[] = [];
    const existingValues: Expression[] = [];
    for (let i = 0; i < obj.properties.length; i++) {
      const p = obj.properties[i];
      existingKeys.push(p.key);
      existingValues.push(p.value);
    }

    const newProps: ObjectProperty[] = [];
    const fieldNames: string[] = [];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const name = normStripOptional(f.name);
      fieldNames.push(name);
      const idx = existingKeys.indexOf(name);
      if (idx !== -1) {
        newProps.push({ key: name, value: existingValues[idx] });
      } else if (this.injectDefaultsEnabled) {
        newProps.push({ key: name, value: defaultLiteralFor(f.type, obj.loc) });
      }
      // else: skip missing field — leave it out, matching pre-pass behavior.
      // Downstream GEP may still read uninitialized memory for that field;
      // inject-defaults mode closes that gap when we're confident it's safe.
    }
    // Carry forward any properties the user wrote that don't match the interface.
    // Keeping them preserves original behavior for object literals treated as
    // free-form; a separate diagnostic can warn on them later.
    for (let i = 0; i < obj.properties.length; i++) {
      const p = obj.properties[i];
      if (fieldNames.indexOf(p.key) === -1) newProps.push(p);
    }
    if (this.reorderEnabled) {
      obj.properties = newProps;
    }

    // Recurse: when a field's type is itself a known interface and the value
    // the user provided is an object literal, normalize it too. Iterate
    // newProps (not fields) because with inject-defaults OFF, newProps can
    // be shorter than fields.length — missing optional fields aren't added.
    if (NORM_NESTED) {
      for (let pi = 0; pi < newProps.length; pi++) {
        const prop = newProps[pi];
        if (!prop || !prop.value) continue;
        if ((prop.value as { type?: string }).type !== "object") continue;
        // Find this key in interface fields to look up its declared type.
        let fieldType = "";
        for (let fi = 0; fi < fields.length; fi++) {
          if (normStripOptional(fields[fi].name) === prop.key) {
            fieldType = normStripNullable(fields[fi].type);
            break;
          }
        }
        if (!fieldType || !this.hasInterface(fieldType)) continue;
        this.normalizeObjectToInterface(prop.value as ObjectNode, fieldType);
      }
    }
  }

  // ── AST walk ──────────────────────────────────────────────────────────────

  visitAST(ast: AST): void {
    if (ast.functions) {
      for (let i = 0; i < ast.functions.length; i++) this.visitFunction(ast.functions[i]);
    }
    if (ast.classes) {
      for (let i = 0; i < ast.classes.length; i++) this.visitClass(ast.classes[i]);
    }
    if (ast.topLevelStatements) {
      for (let i = 0; i < ast.topLevelStatements.length; i++) {
        this.visitStatement(ast.topLevelStatements[i]);
      }
    }
    if (ast.topLevelExpressions) {
      for (let i = 0; i < ast.topLevelExpressions.length; i++) {
        const e = ast.topLevelExpressions[i];
        const t = (e as { type: string }).type;
        if (t === "if" || t === "while" || t === "for" || t === "for_of" || t === "try") {
          this.visitStatement(e as unknown as Statement);
        } else {
          this.visitExpression(e as unknown as Expression);
        }
      }
    }
  }

  private visitFunction(fn: FunctionNode): void {
    const returnIface = this.resolveInterfaceName(fn.returnType);
    if (fn.body) this.visitBlock(fn.body, returnIface);
  }

  private visitClass(cls: ClassNode): void {
    if (cls.fields) {
      for (let i = 0; i < cls.fields.length; i++) {
        const f = cls.fields[i] as ClassField;
        // tsType is the interface/class type (fieldType is the primitive slot).
        const fieldIface = this.resolveInterfaceName(f.tsType);
        if (
          NORM_CLASS_FIELD &&
          f.initializer &&
          fieldIface &&
          this.isObjectLiteral(f.initializer)
        ) {
          this.normalizeObjectToInterface(f.initializer as ObjectNode, fieldIface);
        }
        if (f.initializer) this.visitExpression(f.initializer);
      }
    }
    if (cls.methods) {
      for (let i = 0; i < cls.methods.length; i++) {
        const m = cls.methods[i] as ClassMethod;
        const returnIface = this.resolveInterfaceName(m.returnType);
        if (m.body) this.visitBlock(m.body, returnIface);
      }
    }
  }

  private visitStatement(stmt: Statement, returnIface?: string | null): void {
    if (!stmt) return;
    const t = (stmt as { type: string }).type;
    // Guard: Statement arrays (topLevelExpressions, ForStatement.update, etc.)
    // can legitimately hold expression-shaped nodes. Route them to visitExpression
    // instead of falling through a broken `.value` read on a struct that has no
    // `.value` field.
    if (
      t === "call" ||
      t === "method_call" ||
      t === "binary" ||
      t === "unary" ||
      t === "member_access" ||
      t === "index_access" ||
      t === "conditional" ||
      t === "new" ||
      t === "await" ||
      t === "type_assertion" ||
      t === "arrow_function" ||
      t === "template_literal" ||
      t === "string" ||
      t === "number" ||
      t === "boolean" ||
      t === "null" ||
      t === "undefined" ||
      t === "regex" ||
      t === "variable" ||
      t === "array" ||
      t === "object" ||
      t === "map" ||
      t === "set" ||
      t === "this" ||
      t === "super" ||
      t === "spread"
    ) {
      this.visitExpression(stmt as unknown as Expression);
      return;
    }
    if (t === "variable_declaration") {
      const v = stmt as VariableDeclaration;
      const declaredIface = this.resolveInterfaceName(v.declaredType);
      if (NORM_VARIABLE_DECL && v.value && declaredIface && this.isObjectLiteral(v.value)) {
        this.normalizeObjectToInterface(v.value as ObjectNode, declaredIface);
      }
      if (v.value) this.visitExpression(v.value);
      return;
    }
    if (t === "return") {
      const r = stmt as ReturnStatement;
      if (NORM_RETURN && r.value && returnIface && this.isObjectLiteral(r.value)) {
        this.normalizeObjectToInterface(r.value as ObjectNode, returnIface);
      }
      if (r.value) this.visitExpression(r.value);
      return;
    }
    if (t === "assignment") {
      const a = stmt as AssignmentStatement;
      if (a.value) this.visitExpression(a.value);
      return;
    }
    if (t === "if") {
      const i = stmt as IfStatement;
      if (i.condition) this.visitExpression(i.condition);
      this.visitBlock(i.thenBlock, returnIface);
      if (i.elseBlock) this.visitBlock(i.elseBlock, returnIface);
      return;
    }
    if (t === "while") {
      const w = stmt as WhileStatement;
      if (w.condition) this.visitExpression(w.condition);
      this.visitBlock(w.body, returnIface);
      return;
    }
    if (t === "do_while") {
      const d = stmt as DoWhileStatement;
      this.visitBlock(d.body, returnIface);
      if (d.condition) this.visitExpression(d.condition);
      return;
    }
    if (t === "for") {
      const f = stmt as ForStatement;
      if (f.init) this.visitStatement(f.init as Statement, returnIface);
      if (f.condition) this.visitExpression(f.condition);
      // update can be AssignmentStatement or Expression (e.g. `i++`, `foo()`).
      // Dispatch on its type discriminant — an Expression here crashes the
      // Statement walker's fallback because CallNode etc. have no `.value`.
      if (f.update) {
        const ut = (f.update as { type: string }).type;
        if (ut === "assignment") {
          this.visitStatement(f.update as Statement, returnIface);
        } else {
          this.visitExpression(f.update as Expression);
        }
      }
      this.visitBlock(f.body, returnIface);
      return;
    }
    if (t === "for_of") {
      const fo = stmt as ForOfStatement;
      if (fo.iterable) this.visitExpression(fo.iterable);
      this.visitBlock(fo.body, returnIface);
      return;
    }
    if (t === "block") {
      this.visitBlock(stmt as BlockStatement, returnIface);
      return;
    }
    if (t === "try") {
      const tr = stmt as TryStatement;
      this.visitBlock(tr.tryBlock, returnIface);
      if (tr.catchBody) this.visitBlock(tr.catchBody, returnIface);
      if (tr.finallyBlock) this.visitBlock(tr.finallyBlock, returnIface);
      return;
    }
    if (t === "switch") {
      const sw = stmt as SwitchStatement;
      if (sw.discriminant) this.visitExpression(sw.discriminant);
      if (sw.cases) {
        for (let i = 0; i < sw.cases.length; i++) {
          const c = sw.cases[i] as SwitchCase;
          if (c.test) this.visitExpression(c.test);
          if (c.consequent) {
            for (let j = 0; j < c.consequent.length; j++) {
              this.visitStatement(c.consequent[j], returnIface);
            }
          }
        }
      }
      return;
    }
    if (t === "throw") {
      const th = stmt as ThrowStatement;
      if (th.argument) this.visitExpression(th.argument);
      return;
    }
    // break, continue, and any unrecognized statement have nothing to recurse
    // into. Do NOT fall back to a `.value` read — most statement structs don't
    // have that field and GEP reads past the struct, returning garbage bytes.
  }

  private visitBlock(block: BlockStatement | undefined | null, returnIface?: string | null): void {
    if (!block || !block.statements) return;
    for (let i = 0; i < block.statements.length; i++) {
      this.visitStatement(block.statements[i], returnIface);
    }
  }

  private visitExpression(expr: Expression): void {
    if (!expr) return;
    const t = (expr as { type: string }).type;
    if (t === "type_assertion") {
      const ta = expr as TypeAssertionNode;
      const asserted = this.resolveInterfaceName(ta.assertedType);
      if (NORM_TYPE_ASSERTION && asserted && ta.expression && this.isObjectLiteral(ta.expression)) {
        this.normalizeObjectToInterface(ta.expression as ObjectNode, asserted);
      }
      if (ta.expression) this.visitExpression(ta.expression);
      return;
    }
    if (t === "object") {
      // Nested object without a target type — don't rewrite, but recurse into values.
      const obj = expr as ObjectNode;
      for (let i = 0; i < obj.properties.length; i++) {
        this.visitExpression(obj.properties[i].value);
      }
      return;
    }
    if (t === "array") {
      const arr = expr as ArrayNode;
      for (let i = 0; i < arr.elements.length; i++) this.visitExpression(arr.elements[i]);
      return;
    }
    if (t === "binary") {
      const b = expr as BinaryNode;
      if (b.left) this.visitExpression(b.left);
      if (b.right) this.visitExpression(b.right);
      return;
    }
    if (t === "unary") {
      const u = expr as UnaryNode;
      if (u.operand) this.visitExpression(u.operand);
      return;
    }
    if (t === "conditional") {
      const c = expr as ConditionalExpressionNode;
      if (c.condition) this.visitExpression(c.condition);
      if (c.consequent) this.visitExpression(c.consequent);
      if (c.alternate) this.visitExpression(c.alternate);
      return;
    }
    if (t === "call") {
      const c = expr as CallNode;
      if (c.args) for (let i = 0; i < c.args.length; i++) this.visitExpression(c.args[i]);
      return;
    }
    if (t === "method_call") {
      const mc = expr as MethodCallNode;
      if (mc.object) this.visitExpression(mc.object);
      if (mc.args) for (let i = 0; i < mc.args.length; i++) this.visitExpression(mc.args[i]);
      return;
    }
    if (t === "member_access") {
      const ma = expr as MemberAccessNode;
      if (ma.object) this.visitExpression(ma.object);
      return;
    }
    if (t === "index_access") {
      const ia = expr as IndexAccessNode;
      if (ia.object) this.visitExpression(ia.object);
      if (ia.index) this.visitExpression(ia.index);
      return;
    }
    if (t === "new") {
      const n = expr as NewNode;
      if (n.args) for (let i = 0; i < n.args.length; i++) this.visitExpression(n.args[i]);
      return;
    }
    if (t === "await") {
      const aw = expr as AwaitExpressionNode;
      if (aw.argument) this.visitExpression(aw.argument);
      return;
    }
    if (t === "arrow_function") {
      const af = expr as ArrowFunctionNode;
      const returnIface = this.resolveInterfaceName(af.returnType);
      if (af.body) {
        const bodyT = (af.body as { type?: string }).type;
        if (bodyT === "block") {
          this.visitBlock(af.body as BlockStatement, returnIface);
        } else {
          // Arrow with expression body — treat as the return value.
          if (NORM_ARROW_RETURN && returnIface && this.isObjectLiteral(af.body as Expression)) {
            this.normalizeObjectToInterface(af.body as ObjectNode, returnIface);
          }
          this.visitExpression(af.body as Expression);
        }
      }
      return;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private isObjectLiteral(expr: Expression | null | undefined): boolean {
    if (!expr) return false;
    return (expr as { type?: string }).type === "object";
  }

  // Returns the interface name if the given TS type string resolves to a known
  // interface (after stripping nullability). Returns null otherwise.
  private resolveInterfaceName(tsType: string | null | undefined): string | null {
    if (!tsType) return null;
    const stripped = normStripNullable(tsType);
    if (!stripped) return null;
    if (this.hasInterface(stripped)) return stripped;
    return null;
  }
}

// Rollout flags for incremental enablement. Both start OFF because even
// property reorder alone (without injecting any new AST nodes) causes the
// self-hosted compiler to SIGSEGV when rebuilding itself — codegen has
// position-dependence on object-literal source order in at least one path
// (likely `generateInlineObject` and/or any non-interface-typed fallback).
// Fixing that requires making every object-literal codegen path emit by
// a canonical layout — a follow-on to this scaffold.
//   REORDER_ENABLED: reorder existing properties to declaration order.
//   INJECT_DEFAULTS_ENABLED: fill missing optional fields with null/0/false.
// The walker still runs so the AST pass infrastructure lives in code and
// can be exercised incrementally.
// Rollout flags for incremental enablement. Even the narrowest setting
// (REORDER_ENABLED + NORM_VARIABLE_DECL only, nothing else) causes
// self-hosting to SIGSEGV. Root cause located but not yet fixed:
// `LLVMGenerator.getObjectMetadata` (llvm-generator.ts:1287) captures
// {keys, types} in the object literal's SOURCE order, while
// `generateInterfaceObject` emits the struct in DECLARATION order.
// Member access later uses the source-order metadata to GEP into the
// declaration-order struct — already-broken-by-design, but self-hosting
// accidentally works because the compiler source's object literals
// happen to be written in declaration order. Reordering exposes cases
// where an input's source order happens to differ and breaks.
// Flipping these on requires first making `getObjectMetadata` (and its
// consumers) canonical-layout-aware.
const REORDER_ENABLED = true;
const INJECT_DEFAULTS_ENABLED = true;

const NORM_VARIABLE_DECL = true;
const NORM_TYPE_ASSERTION = true;
const NORM_RETURN = true;
const NORM_CLASS_FIELD = true;
const NORM_NESTED = true;
const NORM_ARROW_RETURN = true;

export function normalizeInterfaceLayouts(ast: AST): void {
  if (!REORDER_ENABLED && !INJECT_DEFAULTS_ENABLED) return;
  if (!ast.interfaces || ast.interfaces.length === 0) return;
  const normalizer = new InterfaceLayoutNormalizer(ast.interfaces);
  normalizer.setFlags(REORDER_ENABLED, INJECT_DEFAULTS_ENABLED);
  normalizer.visitAST(ast);
}

// Whole-program allocation-layout analysis: the fact that makes field access sound under
// structural typing. Every place the program creates an object (a class, an object literal, a
// spread literal, a JSON.parse target) is a LAYOUT: its field names in record order plus the tsc
// type of the allocating expression. A value allocated with layout L can only reach code whose
// static type T satisfies `checker.isTypeAssignableTo(L.type, T)`, because every assignment on
// its way there was checked by tsc. So the layouts REACHING a receiver of static type T are
// exactly those, and a field access on T is static (one load) iff they all agree on the field's
// slot. The test is flow-insensitive and therefore conservative (it may include a layout that never
// actually arrives), which is what keeps it sound under array covariance and aliasing.
//
// Used by validate (property-add and spread rejections) and by lower (static slot vs inline cache,
// spread-literal dispatch). tsc is the only type oracle here: assignability is the checker's.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { LoadedProgram } from "../frontend/program.js";
import { classIdOf } from "./class-ids.js";
import { arrayElementType, valueTypeOfTsType } from "./type-translation.js";
import { isGenericDeclaration } from "./generics.js";

export type LayoutSite =
  | { kind: "class"; classId: string; decl: ts.ClassDeclaration }
  | { kind: "literal"; node: ts.ObjectLiteralExpression }
  // One result layout (field-name list) of a spread literal, with every combination of source
  // layouts that produces it: `combos[k][j]` is the layout id of the j-th spread item's value.
  | { kind: "spread"; node: ts.ObjectLiteralExpression; combos: number[][] }
  | { kind: "json"; call: ts.CallExpression };

export interface Layout {
  id: number;
  names: readonly string[];
  // The allocating expression's type. For a literal, the WIDENED type: the expression's own type
  // is a "fresh" literal type, and tsc's assignability applies excess-property checks to fresh
  // types, which would wrongly say `{ y, x }` never reaches `{ x }` after being bound to a const.
  // Widening drops the freshness while keeping contextual literal types (a `kind: "c"` stays "c").
  type: ts.Type;
  site: LayoutSite;
  // A JSON.parse layout's record follows the JSON TEXT: `names` are the fields it CAN have, in
  // declared order, but at run time they come in any order and these may be missing entirely.
  // Such a layout never agrees on a slot (agreedIndex), so every access to it is an inline cache.
  maybeAbsent?: ReadonlySet<string>;
  // Allocated by erased generic code (a generic class, or a literal inside a generic declaration):
  // its type mentions type parameters, which no concrete type is assignable from or to, so reach
  // is decided by field names instead (see reachingType).
  generic?: true;
  inheritsGeneric?: true;
}

// One item of a literal's property list, in source order.
export type LiteralItem = { kind: "prop"; name: string } | { kind: "spread"; expr: ts.Expression };

// A spread literal whose result layouts are the product of its sources' reaching sets. Past this
// many combinations for one literal it is rejected rather than compiled into a huge dispatch.
export const MAX_SPREAD_CASES = 64;

export class LayoutAnalysis {
  readonly layouts: Layout[] = [];
  private readonly reachCache = new Map<ts.Type, Layout[]>();
  private readonly literalLayouts = new Map<ts.ObjectLiteralExpression, Layout>();
  private readonly spreadResults = new Map<ts.ObjectLiteralExpression, Layout[]>();
  private readonly classLayouts = new Map<string, Layout>();
  private readonly jsonLayouts = new Map<ts.CallExpression, Layout[]>();
  // Spread literals that would need more than MAX_SPREAD_CASES result layouts.
  readonly explodedSpreads: ts.ObjectLiteralExpression[] = [];
  // Spread literals with a source that can be a JSON.parse object, whose layouts are made at run
  // time and so cannot be enumerated into spread cases.
  readonly dynamicSpreads: ts.ObjectLiteralExpression[] = [];

  // Whether the program has any generic declaration; without one reach is pure assignability,
  // exactly as before generics existed.
  generic = false;
  // Every instantiation `new C<...>(...)` creates, per generic class declaration.
  readonly instantiations = new Map<ts.ClassDeclaration, ts.Type[]>();

  addInstantiation(node: ts.NewExpression): void {
    const t = this.checker.getTypeAtLocation(node);
    const d = t.getSymbol()?.valueDeclaration;
    if (!d || !ts.isClassDeclaration(d) || !d.typeParameters?.length) return;
    const list = this.instantiations.get(d) ?? [];
    if (!list.includes(t)) list.push(t);
    this.instantiations.set(d, list);
  }

  constructor(readonly checker: ts.TypeChecker) {}

  private hasGenericBase(t: ts.Type): boolean {
    for (const b of this.checker.getBaseTypes(t as ts.InterfaceType)) {
      const d = b.symbol?.valueDeclaration;
      if (d && ts.isClassDeclaration(d) && (d.typeParameters?.length || this.hasGenericBase(b))) {
        return true;
      }
    }
    return false;
  }

  private add(
    names: readonly string[],
    type: ts.Type,
    site: LayoutSite,
    maybeAbsent?: ReadonlySet<string>,
  ): Layout {
    const l: Layout = { id: this.layouts.length, names, type, site };
    if (maybeAbsent) l.maybeAbsent = maybeAbsent;
    const at = site.kind === "class" ? site.decl : site.kind === "json" ? null : site.node;
    if (at && isGenericDeclaration(at)) l.generic = true;
    // A subclass of a generic class (`class NumBox extends Box<number>`) inherits fields the erased
    // base code stores, so its layout is checked like the base's (generic-rules.ts). It still
    // reaches by assignability: it is not generic itself.
    if (site.kind === "class" && this.hasGenericBase(type)) l.inheritsGeneric = true;
    this.layouts.push(l);
    return l;
  }

  addClass(decl: ts.ClassDeclaration): void {
    const classId = classIdOf(decl);
    const type = this.checker.getDeclaredTypeOfSymbol(
      this.checker.getSymbolAtLocation(decl.name!)!,
    );
    const vt = valueTypeOfTsType(type, decl.name!, this.checker);
    if (vt.kind !== "object") return ice(`layouts: class ${classId} is not an object type`);
    const l = this.add(
      vt.shape.fields.map((f) => f.name),
      type,
      { kind: "class", classId, decl },
    );
    this.classLayouts.set(classId, l);
  }

  addLiteral(node: ts.ObjectLiteralExpression): void {
    const items = literalItems(node);
    if (items.some((i) => i.kind === "spread")) {
      this.spreadResults.set(node, []);
      return; // resolved by the fixpoint in finish()
    }
    const names: string[] = [];
    for (const it of items) if (it.kind === "prop" && !names.includes(it.name)) names.push(it.name);
    const type = this.checker.getWidenedType(this.checker.getTypeAtLocation(node));
    this.literalLayouts.set(node, this.add(names, type, { kind: "literal", node }));
  }

  // Every object type a JSON.parse target contains is one layout whose record order and optional
  // keys come from the JSON text at run time (see Layout.maybeAbsent).
  addJsonParse(call: ts.CallExpression, target: ts.Type): void {
    const out: Layout[] = [];
    const seen = new Set<ts.Type>();
    const walk = (t: ts.Type): void => {
      if (seen.has(t)) return;
      seen.add(t);
      if (t.isUnion()) {
        for (const m of t.types) walk(m);
        return;
      }
      if (!(t.flags & ts.TypeFlags.Object)) return;
      const elem = arrayElementType(t, this.checker);
      if (elem) {
        walk(elem);
        return;
      }
      const vt = valueTypeOfTsType(t, call, this.checker);
      if (vt.kind !== "object") return;
      const absent = new Set<string>();
      for (const p of this.checker.getPropertiesOfType(t)) {
        if (jsonFieldPresence(p, call, this.checker).absentOk) absent.add(p.name);
      }
      out.push(
        this.add(
          vt.shape.fields.map((f) => f.name),
          t,
          { kind: "json", call },
          absent,
        ),
      );
      for (const p of this.checker.getPropertiesOfType(t)) {
        walk(this.checker.getTypeOfSymbolAtLocation(p, call));
      }
    };
    walk(target);
    this.jsonLayouts.set(call, out);
  }

  // Resolve spread literals: each result layout depends on the layouts reaching its sources, and
  // results are themselves layouts that can reach other spreads, so iterate to a fixpoint. It
  // terminates because a result only reorders names that already exist in the program.
  finish(): void {
    // Results of one site are deduplicated by field names: a spread whose result can reach its own
    // source (`clone(n: Named) { return { ...n } }`) would otherwise mint a new layout per round.
    const done = new Map<ts.ObjectLiteralExpression, Set<string>>();
    for (let round = 0; ; round++) {
      if (round > 64) ice("layouts: spread fixpoint did not converge");
      let changed = false;
      this.reachCache.clear();
      for (const [node, results] of this.spreadResults) {
        if (this.explodedSpreads.includes(node)) continue;
        const items = literalItems(node);
        if (this.dynamicSpreads.includes(node)) continue;
        const sourceSets = items
          .filter((i): i is Extract<LiteralItem, { kind: "spread" }> => i.kind === "spread")
          .map((i) => this.reachingType(this.checker.getTypeAtLocation(i.expr)));
        if (sourceSets.some((set) => set.some((l) => l.site.kind === "json"))) {
          this.dynamicSpreads.push(node);
          continue;
        }
        const count = sourceSets.reduce((n, s) => n * s.length, 1);
        if (count > MAX_SPREAD_CASES) {
          this.explodedSpreads.push(node);
          continue;
        }
        const seen = done.get(node) ?? new Set<string>();
        done.set(node, seen);
        const type = this.checker.getWidenedType(this.checker.getTypeAtLocation(node));
        for (const combo of product(sourceSets)) {
          const key = combo.map((l) => l.id).join(",");
          if (seen.has(key)) continue;
          seen.add(key);
          const names: string[] = [];
          let j = 0;
          for (const it of items) {
            const add = it.kind === "prop" ? [it.name] : combo[j++]!.names;
            for (const n of add) if (!names.includes(n)) names.push(n);
          }
          const sources = combo.map((l) => l.id);
          const same = results.find((r) => sameNames(r.names, names));
          if (same && same.site.kind === "spread") same.site.combos.push(sources);
          else results.push(this.add(names, type, { kind: "spread", node, combos: [sources] }));
          changed = true;
        }
      }
      if (!changed) break;
    }
    this.reachCache.clear();
  }

  // Layouts that can reach a value of static type `t` (null/undefined stripped).
  reachingType(t: ts.Type): Layout[] {
    const target = this.checker.getNonNullableType(t);
    const hit = this.reachCache.get(target);
    if (hit) return hit;
    // A generic layout or a type mentioning a type parameter has no assignability to go by, so it
    // reaches every layout that has all the type's data fields: conservative (more layouts only
    // push a site from a static slot to a by-name inline cache) and sound.
    const byNames = this.generic ? genericReach(target, this.checker) : null;
    const out = this.layouts.filter((l) => {
      if (this.checker.isTypeAssignableTo(l.type, target)) return true;
      if (byNames === null || !(l.generic || byNames.targetGeneric)) return false;
      // A generic class's instances are exactly its `new` sites' instantiations, which tsc can
      // compare; names only decide for a target that itself mentions a type parameter.
      if (l.site.kind === "class" && !byNames.targetGeneric) {
        const insts = this.instantiations.get(l.site.decl) ?? [];
        return insts.some((i) => this.checker.isTypeAssignableTo(i, target));
      }
      return byNames.names.every((n) => this.checker.getPropertyOfType(l.type, n) !== undefined);
    });
    this.reachCache.set(target, out);
    return out;
  }

  // Layouts that can reach the value of `expr`. `this` inside a class is an instance of that class
  // or a subclass (class methods are only ever called on instances), which is tighter than its
  // polymorphic `this` type and never includes a structurally compatible literal.
  reaching(expr: ts.Expression): Layout[] {
    if (expr.kind === ts.SyntaxKind.ThisKeyword) {
      const cls = enclosingClass(expr) ?? ice("layouts: `this` outside a class");
      return this.reachingThis(cls);
    }
    return this.reachingType(this.checker.getTypeAtLocation(expr));
  }

  reachingThis(cls: ts.ClassDeclaration): Layout[] {
    const self = this.classLayouts.get(classIdOf(cls)) ?? ice("layouts: class without a layout");
    return this.layouts.filter(
      (l) => l.site.kind === "class" && this.checker.isTypeAssignableTo(l.type, self.type),
    );
  }

  literalLayout(node: ts.ObjectLiteralExpression): Layout {
    return this.literalLayouts.get(node) ?? ice("layouts: literal was not collected");
  }

  spreadLayouts(node: ts.ObjectLiteralExpression): Layout[] {
    return this.spreadResults.get(node) ?? ice("layouts: spread literal was not collected");
  }

  classLayout(classId: string): Layout {
    return this.classLayouts.get(classId) ?? ice(`layouts: class ${classId} was not collected`);
  }

  jsonParseLayouts(call: ts.CallExpression): Layout[] {
    return this.jsonLayouts.get(call) ?? ice("layouts: JSON.parse site was not collected");
  }
}

// Where `name` lives in every one of `layouts`: its field index when they all agree, otherwise null
// (the access needs an inline cache). An empty reaching set also yields null: the site is dead as
// far as the analysis can see, and a by-name lookup is correct whatever arrives.
export function agreedIndex(layouts: readonly Layout[], name: string): number | null {
  if (layouts.length === 0) return null;
  if (layouts.some((l) => l.site.kind === "json")) return null;
  const idx = layouts[0]!.names.indexOf(name);
  if (idx < 0) return null;
  return layouts.every((l) => l.names[idx] === name) ? idx : null;
}

// How JSON text may supply a declared property: `absentOk` when the key may be missing (`x?:` or a
// type that includes undefined, which JSON cannot spell), `nullable` when JSON `null` is a value of
// the type. A JSON null for a property whose type has no null is a mismatch, like any other.
export function jsonFieldPresence(
  prop: ts.Symbol,
  node: ts.Node,
  checker: ts.TypeChecker,
): { absentOk: boolean; nullable: boolean } {
  const t = checker.getTypeOfSymbolAtLocation(prop, node);
  const members = t.isUnion() ? t.types : [t];
  return {
    absentOk:
      (prop.flags & ts.SymbolFlags.Optional) !== 0 ||
      members.some((m) => (m.flags & ts.TypeFlags.Undefined) !== 0),
    nullable: members.some((m) => (m.flags & ts.TypeFlags.Null) !== 0),
  };
}

// The property items of an object literal in source order.
export function literalItems(node: ts.ObjectLiteralExpression): LiteralItem[] {
  return node.properties.map((p): LiteralItem => {
    if (ts.isSpreadAssignment(p)) return { kind: "spread", expr: p.expression };
    if (
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
      (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
    ) {
      // A quoted name (`"content-type": ...`) is an ordinary field; validate rejects the
      // integer-like ones, which JS would order before every other key.
      return { kind: "prop", name: p.name.text };
    }
    return ice(`layouts: unsupported object literal member ${ts.SyntaxKind[p.kind]}`);
  });
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

function enclosingClass(node: ts.Node): ts.ClassDeclaration | null {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isClassDeclaration(p)) return p;
  }
  return null;
}

function product<T>(sets: readonly (readonly T[])[]): T[][] {
  let acc: T[][] = [[]];
  for (const s of sets) acc = acc.flatMap((prefix) => s.map((x) => [...prefix, x]));
  return acc;
}

// The analysis for a program, computed once per checker and shared by validate and lower.
const cache = new WeakMap<ts.TypeChecker, LayoutAnalysis>();

export function layoutsOf(loaded: LoadedProgram): LayoutAnalysis {
  const hit = cache.get(loaded.checker);
  if (hit) return hit;
  const a = new LayoutAnalysis(loaded.checker);
  const visit = (node: ts.Node): void => {
    const tps = (node as { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> })
      .typeParameters;
    if (tps && tps.length > 0) a.generic = true;
    if (ts.isNewExpression(node)) a.addInstantiation(node);
    // Only top-level classes exist at run time (lower builds method tables for exactly these).
    if (ts.isClassDeclaration(node) && node.name && ts.isSourceFile(node.parent)) a.addClass(node);
    else if (ts.isObjectLiteralExpression(node)) a.addLiteral(node);
    else if (isAnnotatedJsonParse(node)) {
      const decl = node.parent as ts.VariableDeclaration;
      a.addJsonParse(node, loaded.checker.getTypeFromTypeNode(decl.type!));
    }
    ts.forEachChild(node, visit);
  };
  for (const sf of loaded.initOrder) visit(sf);
  a.finish();
  cache.set(loaded.checker, a);
  return a;
}

// `JSON.parse(...)` as the initializer of an annotated declaration: the one admitted form.
function isAnnotatedJsonParse(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "JSON" &&
    node.expression.name.text === "parse" &&
    ts.isVariableDeclaration(node.parent) &&
    node.parent.type !== undefined
  );
}

// The member names (fields and methods) a value of type `t` must have, and whether `t` mentions a
// type parameter (then no layout is assignable to it, and names are all reach can go by).
function genericReach(
  t: ts.Type,
  checker: ts.TypeChecker,
): { names: string[]; targetGeneric: boolean } {
  const names = checker.getPropertiesOfType(t).map((p) => p.name);
  return { names, targetGeneric: mentionsTypeParameter(t, checker, 0) };
}

function mentionsTypeParameter(t: ts.Type, checker: ts.TypeChecker, depth: number): boolean {
  if (t.flags & ts.TypeFlags.TypeParameter) return true;
  if (depth > 3) return false;
  if (t.isUnionOrIntersection()) {
    return t.types.some((m) => mentionsTypeParameter(m, checker, depth + 1));
  }
  if (!(t.flags & ts.TypeFlags.Object)) return false;
  const ref = t as ts.TypeReference;
  if (
    ref.target &&
    checker.getTypeArguments(ref).some((a) => mentionsTypeParameter(a, checker, depth + 1))
  ) {
    return true;
  }
  return checker
    .getPropertiesOfType(t)
    .some((p) => mentionsTypeParameter(checker.getTypeOfSymbol(p), checker, depth + 1));
}

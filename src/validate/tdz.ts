// Temporal-dead-zone guard for module-scope variables.
//
// Top-level `let`/`const` are compiled to zero-initialized globals that `main` assigns when it
// reaches each declaration (see codegen's `globals` map). If code touches one BEFORE main gets to
// the assignment, the program sees a zero where JavaScript throws `ReferenceError: Cannot access
// 'x' before initialization`. A zero is a silent wrong answer, so that ordering is rejected.
//
// The analysis follows execution order. Top-level statements run in order; statement i (each
// declarator of a variable statement separately) runs the code it contains, except the bodies of
// the functions it merely defines, plus the bodies of every function that code can call,
// transitively. A module variable touched by any of that before its own declarator has run is a
// dead-zone access. Calls are resolved through the checker (a named function, a const-bound
// arrow, a method, a constructor with its field initializers). A call the checker cannot pin to
// one body (through a function-typed parameter, a stored callback, an interface method) may reach
// any function whose value has escaped so far, or any class method, so those are assumed to run.
//
// The check is per file, which is sufficient: modules are initialized in dependency order, so
// every other file's module variables are already assigned before this file's statements run.

import ts from "typescript";
import type { Diagnostic } from "../diagnostics.js";
import { CODE } from "./codes.js";

type FnLike =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

// A unit of code that runs when "called": a function body, or a class standing for what `new`
// runs besides the constructor body (instance field initializers, then the base class's).
type Body = FnLike | ts.ClassLikeDeclaration;

interface Summary {
  reads: Set<ts.Symbol>;
  calls: Set<Body>;
  escapes: Set<Body>;
  unknown: boolean;
}

function isFnLike(n: ts.Node): n is FnLike {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isConstructorDeclaration(n) ||
    ts.isGetAccessor(n) ||
    ts.isSetAccessor(n)
  );
}

function unparen(n: ts.Node): ts.Node {
  while (ts.isParenthesizedExpression(n)) n = n.expression;
  return n;
}

// The function a value-position reference stands for: a function declaration, or a variable
// initialized with a function expression / arrow.
function functionOfSymbol(sym: ts.Symbol | undefined): FnLike | undefined {
  const d = sym?.valueDeclaration;
  if (!d) return undefined;
  if (ts.isFunctionDeclaration(d) && d.body) return d;
  if (ts.isVariableDeclaration(d) && d.initializer) {
    const init = unparen(d.initializer);
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init;
  }
  return undefined;
}

function classOf(
  expr: ts.Expression,
  checker: ts.TypeChecker,
): ts.ClassLikeDeclaration | undefined {
  let sym = checker.getSymbolAtLocation(expr);
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
  const d = sym?.valueDeclaration;
  return d && ts.isClassLike(d) ? d : undefined;
}

export function tdzDiagnostics(sf: ts.SourceFile, checker: ts.TypeChecker): Diagnostic[] {
  // Every module variable (and class: a class binding is not hoisted either) of this file, with
  // the execution position of its declarator.
  const position = new Map<ts.Symbol, { name: ts.Identifier; pos: number }>();
  let n = 0;
  for (const stmt of sf.statements) {
    if (ts.isClassDeclaration(stmt)) {
      const sym = stmt.name ? checker.getSymbolAtLocation(stmt.name) : undefined;
      if (sym && stmt.name) position.set(sym, { name: stmt.name, pos: n });
      n++;
      continue;
    }
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      const pos = n++;
      const bind = (name: ts.BindingName): void => {
        if (ts.isIdentifier(name)) {
          const sym = checker.getSymbolAtLocation(name);
          if (sym) position.set(sym, { name, pos });
          return;
        }
        for (const el of name.elements) if (!ts.isOmittedExpression(el)) bind(el.name);
      };
      bind(d.name);
    }
  }
  if (position.size === 0) return [];

  // With a top-level await, a timer callback can run between two top-level statements.
  let topLevelAwait = false;
  const findAwait = (node: ts.Node): void => {
    if (isFnLike(node)) return;
    if (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier)) {
      topLevelAwait = true;
      return;
    }
    ts.forEachChild(node, findAwait);
  };
  findAwait(sf);

  const summaries = new Map<Body, Summary>();
  const newSummary = (): Summary => ({
    reads: new Set(),
    calls: new Set(),
    escapes: new Set(),
    unknown: false,
  });

  // Add what `node` does when it executes to `s`. Nested function definitions are not entered.
  const scan = (node: ts.Node, s: Summary): void => {
    if (
      ts.isTypeNode(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node)
    ) {
      return;
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      // A function value being created. Where it goes decides whether it can be called: a direct
      // callee (an IIFE) or a variable initializer is tracked by name; anywhere else it escapes.
      let at: ts.Node = node;
      while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
      const p = at.parent;
      if (ts.isCallExpression(p) && p.expression === at) s.calls.add(node);
      else if (!(ts.isVariableDeclaration(p) && p.initializer === at)) s.escapes.add(node);
      return;
    }
    if (isFnLike(node)) return; // a declaration, hoisted or not: defining it runs nothing
    if (ts.isClassLike(node)) {
      // Defining a class runs its `extends` expression and static initializers.
      for (const h of node.heritageClauses ?? []) scan(h, s);
      for (const m of node.members) {
        const isStatic = ts.canHaveModifiers(m)
          ? (ts.getModifiers(m) ?? []).some((x) => x.kind === ts.SyntaxKind.StaticKeyword)
          : false;
        if (ts.isPropertyDeclaration(m) && isStatic && m.initializer) scan(m.initializer, s);
        if (ts.isClassStaticBlockDeclaration(m)) scan(m.body, s);
      }
      return;
    }
    if (ts.isIdentifier(node)) {
      scanIdentifier(node, s);
      return;
    }
    if (ts.isShorthandPropertyAssignment(node)) {
      const sym = checker.getShorthandAssignmentValueSymbol(node);
      noteSymbol(sym, node.name, s);
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      // An accessor runs on a plain read or write of the property.
      const decls = checker.getSymbolAtLocation(node.name)?.declarations ?? [];
      for (const d of decls) {
        if ((ts.isGetAccessor(d) || ts.isSetAccessor(d)) && d.body) s.calls.add(d);
        if (ts.isMethodDeclaration(d) && d.body && !isCallee(node)) s.escapes.add(d);
      }
      scan(node.expression, s);
      return;
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      scanCall(node, s);
      return;
    }
    ts.forEachChild(node, (c) => scan(c, s));
  };

  const isCallee = (node: ts.Node): boolean => {
    let at: ts.Node = node;
    while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
    const p = at.parent;
    return (ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression === at;
  };

  const noteSymbol = (sym: ts.Symbol | undefined, at: ts.Identifier, s: Summary): void => {
    if (!sym) return;
    if (position.has(sym)) s.reads.add(sym);
    // A named function used as a value (not called right here) escapes.
    const fn = functionOfSymbol(sym);
    if (fn && !isCallee(at)) s.escapes.add(fn);
  };

  const scanIdentifier = (id: ts.Identifier, s: Summary): void => {
    const sym = checker.getSymbolAtLocation(id);
    // A declaration's own name is not an access.
    const decl = sym?.valueDeclaration;
    if (decl && (decl as ts.NamedDeclaration).name === id) return;
    noteSymbol(sym, id, s);
  };

  const scanCall = (call: ts.CallExpression | ts.NewExpression, s: Summary): void => {
    const args = call.arguments ?? [];
    const callee = call.expression;
    if (ts.isNewExpression(call)) {
      const cls = classOf(callee, checker);
      if (cls) s.calls.add(cls);
    }
    if (callee.kind === ts.SyntaxKind.SuperKeyword) {
      const cls = ts.findAncestor(call, ts.isClassLike);
      const base = cls?.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)
        ?.types[0]?.expression;
      const baseClass = base ? classOf(base, checker) : undefined;
      if (baseClass) s.calls.add(baseClass);
    }
    const decl = checker.getResolvedSignature(call)?.declaration;
    const builtin = decl !== undefined && decl.getSourceFile().isDeclarationFile;
    if (decl && !builtin && isFnLike(decl) && decl.body) {
      s.calls.add(decl);
    } else if (builtin) {
      // A builtin calls only the functions handed to it (conservatively, right away), except a
      // timer callback, which runs after all top-level code unless a top-level await can let the
      // event loop run in between.
      const deferred = !topLevelAwait && ts.isIdentifier(callee) && callee.text === "setTimeout";
      for (const a of args) {
        const arg = unparen(a);
        if (deferred && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))) continue;
        if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
          s.calls.add(arg);
          s.escapes.add(arg); // a builtin may also keep it (`fns.push(f)`)
        } else if (!deferred) {
          const fn = ts.isIdentifier(arg)
            ? functionOfSymbol(checker.getSymbolAtLocation(arg))
            : undefined;
          if (fn) s.calls.add(fn);
          else if (
            checker.getSignaturesOfType(checker.getTypeAtLocation(arg), ts.SignatureKind.Call)
              .length > 0
          ) {
            s.unknown = true;
          }
        }
      }
      scan(callee, s);
      for (const a of args) {
        const arg = unparen(a);
        if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) continue;
        scan(a, s);
      }
      return;
    } else if (!ts.isNewExpression(call) && callee.kind !== ts.SyntaxKind.SuperKeyword) {
      // Through a function-typed value or an interface method: could be any escaped function.
      s.unknown = true;
    }
    if (!(ts.isArrowFunction(unparen(callee)) || ts.isFunctionExpression(unparen(callee)))) {
      scan(callee, s);
    } else {
      s.calls.add(unparen(callee) as FnLike);
    }
    for (const a of args) scan(a, s);
  };

  const summaryOf = (b: Body): Summary => {
    let s = summaries.get(b);
    if (s) return s;
    s = newSummary();
    summaries.set(b, s);
    if (ts.isClassLike(b)) {
      // `new C()`: instance field initializers, the constructor, and the base class's.
      for (const m of b.members) {
        const isStatic = ts.canHaveModifiers(m)
          ? (ts.getModifiers(m) ?? []).some((x) => x.kind === ts.SyntaxKind.StaticKeyword)
          : false;
        if (ts.isPropertyDeclaration(m) && !isStatic && m.initializer) scan(m.initializer, s);
        if (ts.isConstructorDeclaration(m) && m.body) s.calls.add(m);
      }
      const base = b.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)
        ?.types[0]?.expression;
      const baseClass = base ? classOf(base, checker) : undefined;
      if (baseClass) s.calls.add(baseClass);
    } else if (b.body) {
      // Parameter defaults run on the call too.
      for (const p of b.parameters) if (p.initializer) scan(p.initializer, s);
      scan(b.body, s);
    }
    return s;
  };

  // Every method and accessor with a body in the program's user files: what an unresolvable call
  // (an interface method) might dispatch to.
  const methods: Body[] = [];
  const collectMethods = (node: ts.Node): void => {
    if (
      (ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) &&
      node.body
    ) {
      methods.push(node);
    }
    ts.forEachChild(node, collectMethods);
  };
  collectMethods(sf);

  const out: Diagnostic[] = [];
  const reported = new Set<ts.Symbol>();
  // Functions whose value has escaped in code that already ran (or is running).
  const escaped = new Set<Body>();

  // Everything statement code `s` can reach; report module variables touched before `now`.
  const check = (root: Summary, now: number): void => {
    const seen = new Set<Summary>([root]);
    const work: Summary[] = [root];
    let unknown = false;
    const visit = (b: Body): void => {
      const s = summaryOf(b);
      if (!seen.has(s)) {
        seen.add(s);
        work.push(s);
      }
    };
    while (work.length > 0) {
      const s = work.pop()!;
      for (const sym of s.reads) {
        const decl = position.get(sym)!;
        if (decl.pos >= now && !reported.has(sym)) {
          reported.add(sym);
          const { line, character } = sf.getLineAndCharacterOfPosition(decl.name.getStart(sf));
          out.push({
            code: CODE.TDZ_MODULE_VAR,
            message:
              `\`${decl.name.text}\` is used before its declaration runs (Node throws ` +
              `ReferenceError: Cannot access '${decl.name.text}' before initialization)`,
            span: { file: sf.fileName, line: line + 1, col: character + 1 },
            suggestion:
              "move this declaration above the first statement whose code (or a function it " +
              "calls) uses it",
          });
        }
      }
      for (const b of s.escapes) {
        if (!escaped.has(b)) {
          escaped.add(b);
          if (unknown) visit(b);
        }
      }
      for (const b of s.calls) visit(b);
      if (s.unknown && !unknown) {
        unknown = true;
        for (const b of escaped) visit(b);
        for (const b of methods) visit(b);
      }
    }
  };

  let now = 0;
  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        const s = newSummary();
        if (d.initializer) scan(d.initializer, s);
        check(s, now);
        now++;
      }
      continue;
    }
    const s = newSummary();
    scan(stmt, s);
    if (ts.isClassDeclaration(stmt)) {
      // The class binding exists (inside the class too) before its static initializers run.
      now++;
      check(s, now);
      continue;
    }
    check(s, now);
  }
  return out;
}

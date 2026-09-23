// Class identity in generated code. A class's methods, constructor and vtable are emitted under
// names derived from its id (`<id>.method`, `<id>.vtable`), and instanceof compares vtables, so
// the id must be unique across the whole program: two modules may each declare `class Point`.
// The id is the source name, suffixed with the declaring module's id outside the entry module.
// The format contract (`<name>` or `<name>.<module>`) is what classDisplayName in hir/types.ts
// relies on to recover the source name for printing.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import { moduleIdOf } from "../frontend/module-graph.js";
import type { LowerCtx } from "./lower.js";

export function classIdOf(decl: ts.ClassDeclaration): string {
  const name = decl.name?.text ?? ice("lower: anonymous class (the validator rejects these)");
  const mod = moduleIdOf(decl.getSourceFile());
  return mod === "" ? name : `${name}.${mod}`;
}

// The class declaration behind a type, when the type is a class instance type.
export function classDeclOfType(t: ts.Type): ts.ClassDeclaration | null {
  const d = t.symbol?.valueDeclaration;
  return d !== undefined && ts.isClassDeclaration(d) ? d : null;
}

// The class whose `Class.constructor` HFunc a `new`/`super()` must actually call. A class that
// declares neither a constructor nor a field initializer emits no constructor at all, so naming
// the immediate base blindly produces a call to a function that was never emitted.
export function constructorClassOf(className: string, ctx: LowerCtx): string | null {
  const decl = ctx.classDecls.get(className) ?? ice(`lower: unknown class ${className}`);
  const sym = decl.name ? ctx.checker.getSymbolAtLocation(decl.name) : undefined;
  let t = sym ? ctx.checker.getDeclaredTypeOfSymbol(sym) : undefined;
  while (t) {
    const d = classDeclOfType(t);
    if (d) {
      // A class runs its own constructor if it declares one, OR if it has field initializers (which
      // are lowered into a synthesized constructor — see lowerClass).
      const hasCtorWork = d.members.some(
        (m) =>
          (ts.isConstructorDeclaration(m) && m.body) ||
          (ts.isPropertyDeclaration(m) && m.initializer !== undefined),
      );
      if (hasCtorWork) return classIdOf(d);
      const bases = ctx.checker.getBaseTypes(t as ts.InterfaceType);
      t = bases.find((b) => {
        const bd = b.symbol?.valueDeclaration;
        return bd && ts.isClassDeclaration(bd);
      });
    } else break;
  }
  return null;
}

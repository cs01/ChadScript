// `x instanceof C`: for a program class, the receiver's shape is C's or a subclass's; for an error
// class (Error, TypeError, ...), a test of the CsThrown's error kind (lower/errors.ts), since the
// builtin classes are not in the program's class hierarchy.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { HExpr } from "../hir/nodes.js";
import type { ValueType } from "../hir/types.js";
import { type LowerCtx, lowerExpr, symbolOf, unparen } from "./lower.js";
import { namespaceMemberOf } from "./module-refs.js";
import { classIdOf } from "./class-ids.js";
import { ERROR_KINDS, builtinErrorConstructor } from "./errors.js";

export function lowerInstanceof(b: ts.BinaryExpression, type: ValueType, ctx: LowerCtx): HExpr {
  // The class is named directly or through a module namespace (`x instanceof m.C`).
  const right = unparen(b.right);
  const classRef = ts.isIdentifier(right)
    ? right
    : (namespaceMemberOf(right, ctx.checker) ??
      ice("lower: instanceof right side must be a class name"));
  const left = lowerExpr(b.left, ctx);
  // `e instanceof TypeError` on a caught value or an Error → the CsThrown's error kind. (The
  // error classes are builtins, not user classes, so they are not in the vtable hierarchy.)
  const errorClass = builtinErrorConstructor(classRef, ctx.checker);
  if (errorClass && left.type.kind === "unknown") {
    return { kind: "thrownIsError", value: left, errorKind: ERROR_KINDS[errorClass], type };
  }
  const classDecl = symbolOf(classRef, ctx)?.valueDeclaration;
  if (!classDecl || !ts.isClassDeclaration(classDecl)) {
    return ice(`lower: instanceof ${classRef.text} is not a class`);
  }
  const target = classIdOf(classDecl);
  const matches = [...ctx.classAncestors]
    .filter(([, anc]) => anc.has(target))
    .map(([name]) => name);
  if (matches.length === 0) ice(`lower: instanceof unknown class ${target}`);
  const shapes = matches.map((c) => ctx.shapes.classShape(c));
  return { kind: "instanceofCheck", value: left, shapes, type };
}

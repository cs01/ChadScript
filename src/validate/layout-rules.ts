// Whole-program rules over allocation layouts (lower/layouts.ts). They run after the per-node
// walk, on a program that is otherwise in the subset, because they need every allocation site:
//
//   - CS1235: a property write whose receiver can be an object created WITHOUT that property. JS
//     would add the property; the subset forbids property addition (objects have fixed shapes).
//   - CS1236: a site whose possible runtime layouts the compiler will not enumerate (a spread with
//     too many source-layout combinations), or cannot read with one representation
//     (Object.values over objects whose fields have different representations).
//   - CS1238: console.log / JSON.stringify of a value that can hold something unrenderable
//     (render-rules.ts).

import ts from "typescript";
import { type Diagnostic, ice } from "../diagnostics.js";
import type { LoadedProgram } from "../frontend/program.js";
import { type LayoutSite, layoutsOf, MAX_SPREAD_CASES } from "../lower/layouts.js";
import { UnrepresentableTypeError, valueTypeOfTsType } from "../lower/type-translation.js";
import type { ValueType } from "../hir/types.js";
import { CODE } from "./codes.js";
import { spanOf } from "./validate.js";
import { renderDiagnostic } from "./render-rules.js";

export function layoutDiagnostics(loaded: LoadedProgram): Diagnostic[] {
  const analysis = layoutsOf(loaded);
  const checker = loaded.checker;
  const out: Diagnostic[] = [];

  for (const node of analysis.explodedSpreads) {
    out.push({
      code: CODE.LAYOUT_LIMIT,
      message:
        `this spread can copy from objects of more than ${MAX_SPREAD_CASES} different layouts ` +
        "(the product of each source's possible layouts)",
      span: spanOf(node, node.getSourceFile()),
      suggestion: "copy the fields you need explicitly: `{ a: src.a, b: src.b }`",
    });
  }

  for (const node of analysis.dynamicSpreads) {
    out.push({
      code: CODE.LAYOUT_LIMIT,
      message:
        "this spread can copy from an object made by JSON.parse, whose key order is only known " +
        "at run time",
      span: spanOf(node, node.getSourceFile()),
      suggestion: "copy the fields you need explicitly: `{ a: src.a, b: src.b }`",
    });
  }

  const checkWrite = (pa: ts.PropertyAccessExpression): void => {
    const name = pa.name.text;
    const recv = checker.getNonNullableType(checker.getTypeAtLocation(pa.expression));
    const prop = checker.getPropertyOfType(recv, name);
    if (!prop || !(prop.flags & ts.SymbolFlags.Property)) return;
    const without = analysis
      .reaching(pa.expression)
      .find((l) => !l.names.includes(name) || l.maybeAbsent?.has(name));
    if (!without) return;
    out.push({
      code: CODE.PROPERTY_ADD,
      message:
        `assigning \`.${name}\` can add a property to an object created without it ` +
        `(${describeSite(without.site)}); objects cannot gain properties`,
      span: spanOf(pa, pa.getSourceFile()),
      suggestion:
        without.site.kind === "json"
          ? `copy the parsed fields into a new literal that includes it: \`{ a: p.a, ${name}: value }\``
          : `create every such object with the property: declare it \`${name}?: T | undefined\` and ` +
            `initialize it (\`${name}: undefined\`), or use a class that declares \`${name}\``,
    });
  };

  const checkValues = (call: ts.CallExpression, arg: ts.Expression): void => {
    const kinds = new Set<string>();
    for (const l of analysis.reaching(arg)) {
      for (const name of l.names) {
        const prop = checker.getPropertyOfType(l.type, name);
        if (!prop) continue;
        kinds.add(
          valueTypeOfTsType(checker.getTypeOfSymbolAtLocation(prop, call), call, checker).kind,
        );
      }
    }
    if (kinds.size <= 1) return;
    out.push({
      code: CODE.LAYOUT_LIMIT,
      message:
        "`Object.values` here can see objects whose fields have different types " +
        `(${[...kinds].join(", ")}), which one array cannot hold`,
      span: spanOf(call, call.getSourceFile()),
      suggestion: "list the fields explicitly: `[o.a, o.b]`",
    });
  };

  // A method call through an object type reaches, per layout, a class method or a function-valued
  // field, and calls it with the SITE's argument and return representations. Every target must
  // agree with them (tsc's function assignability is looser: `() => number` is assignable where
  // `(x: number) => number | undefined` is expected), or the call would pass or read the wrong
  // machine types.
  const checkMethodCall = (call: ts.CallExpression, pa: ts.PropertyAccessExpression): void => {
    const recv = checker.getNonNullableType(checker.getTypeAtLocation(pa.expression));
    if (!(recv.flags & ts.TypeFlags.Object) || !isObjectValue(recv, pa, checker)) return;
    // Builtin receivers (`console.log`, `Math.max`, a module namespace) are lowered by name, not
    // dispatched through a shape, even when a program object happens to match their type.
    const decls = recv.getSymbol()?.declarations ?? [];
    if (decls.some((d) => d.getSourceFile().isDeclarationFile || ts.isSourceFile(d))) return;
    const site = checker.getResolvedSignature(call);
    if (!site) return;
    const siteSig = signatureRepr(site, call, checker);
    for (const l of analysis.reaching(pa.expression)) {
      const prop = checker.getPropertyOfType(l.type, pa.name.text);
      const sig = prop
        ? checker.getSignaturesOfType(
            checker.getTypeOfSymbolAtLocation(prop, call),
            ts.SignatureKind.Call,
          )[0]
        : undefined;
      const problem = !sig
        ? "has no such method"
        : sameRepr(signatureRepr(sig, call, checker), siteSig)
          ? null
          : "declares it with parameter or return types other than this call's";
      if (!problem) continue;
      out.push({
        code: CODE.METHOD_REPRESENTATION,
        message:
          `\`.${pa.name.text}()\` can be called on an object (${describeSite(l.site)}) that ` +
          problem,
        span: spanOf(call, call.getSourceFile()),
        suggestion: "give every implementation exactly the interface's parameter and return types",
      });
      return;
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      checkMethodCall(node, node.expression);
      const render = renderDiagnostic(node, analysis, checker);
      if (render) out.push(render);
    }
    if (
      ts.isBinaryExpression(node) &&
      isAssignment(node.operatorToken.kind) &&
      ts.isPropertyAccessExpression(node.left)
    ) {
      checkWrite(node.left);
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      ts.isPropertyAccessExpression(node.operand)
    ) {
      checkWrite(node.operand);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Object" &&
      node.expression.name.text === "values" &&
      node.arguments[0]
    ) {
      checkValues(node, node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  for (const sf of loaded.initOrder) visit(sf);
  return out;
}

function isObjectValue(t: ts.Type, node: ts.Node, checker: ts.TypeChecker): boolean {
  try {
    return valueTypeOfTsType(t, node, checker).kind === "object";
  } catch (e) {
    if (e instanceof UnrepresentableTypeError) return false;
    throw e;
  }
}

// A signature as the value domain sees it: parameter types then the return (null = void).
function signatureRepr(sig: ts.Signature, node: ts.Node, checker: ts.TypeChecker): ValueType {
  const params = sig.parameters.map((p) =>
    valueTypeOfTsType(checker.getTypeOfSymbolAtLocation(p, node), node, checker),
  );
  const r = checker.getReturnTypeOfSignature(sig);
  const ret =
    r.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)
      ? null
      : valueTypeOfTsType(r, node, checker);
  return { kind: "function", params, ret };
}

// Same machine representation (objects are all one pointer kind, whatever their fields).
function sameRepr(a: ValueType | null, b: ValueType | null, depth = 0): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (depth > 8) return true;
  switch (a.kind) {
    case "array":
      return sameRepr(a.element, (b as typeof a).element, depth + 1);
    case "set":
      return sameRepr(a.element, (b as typeof a).element, depth + 1);
    case "optional":
      return sameRepr(a.inner, (b as typeof a).inner, depth + 1);
    case "promise":
      return sameRepr(a.inner, (b as typeof a).inner, depth + 1);
    case "map": {
      const m = b as typeof a;
      return sameRepr(a.key, m.key, depth + 1) && sameRepr(a.value, m.value, depth + 1);
    }
    case "function": {
      const f = b as typeof a;
      return (
        a.params.length === f.params.length &&
        a.params.every((p, i) => sameRepr(p, f.params[i]!, depth + 1)) &&
        sameRepr(a.ret, f.ret, depth + 1)
      );
    }
    case "opaque":
      return a.name === (b as typeof a).name;
    case "value": {
      // Both are Value words; they agree when each tag's member has the same representation.
      const v = b as typeof a;
      if (a.members.length !== v.members.length) return false;
      return a.members.every((m) => {
        const other = v.members.find((n) => n.kind === m.kind);
        return other !== undefined && (m.kind === "object" || sameRepr(m, other, depth + 1));
      });
    }
    case "number":
    case "string":
    case "boolean":
    case "null":
    case "undefined":
    case "unknown":
    case "object":
      return true;
    default: {
      const never: never = a;
      return ice(`sameRepr: unhandled ${(never as { kind: string }).kind}`);
    }
  }
}

function isAssignment(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function describeSite(site: LayoutSite): string {
  const at = (n: ts.Node): string => {
    const sf = n.getSourceFile();
    const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    return `${sf.fileName.split("/").pop()}:${line + 1}`;
  };
  switch (site.kind) {
    case "class":
      return `class ${site.decl.name?.text ?? "?"} at ${at(site.decl)}`;
    case "literal":
    case "spread":
      return `the object literal at ${at(site.node)}`;
    case "json":
      return `JSON.parse at ${at(site.call)}, which omits keys absent from the JSON text`;
    default: {
      const never: never = site;
      return ice(`describeSite: unhandled ${(never as { kind: string }).kind}`);
    }
  }
}

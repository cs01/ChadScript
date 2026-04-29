import type { SyntaxNode } from "../parser-py.js";
import type { HIRType, HIRExpr } from "./types.js";
import { F64, I64, I1, I8PTR, VOID, BOXED } from "./types.js";
import type { LowerCtx } from "./lower-py-ctx.js";

export { F64, I64, I1, I8PTR, VOID, BOXED };

export function namedChildren(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let i = 0; i < node.namedChildCount; i++) result.push(node.namedChild(i)!);
  return result;
}

export function interpretEscape(esc: string): string {
  switch (esc) {
    case "\\n": return "\n";
    case "\\t": return "\t";
    case "\\\\": return "\\";
    case '\\"': return '"';
    case "\\'": return "'";
    case "\\0": return "\0";
    default: return esc;
  }
}

function processStringContent(node: SyntaxNode): string {
  const raw = node.text;
  let result = "";
  let lastEnd = 0;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    if (child.type === "escape_sequence") {
      const start = child.startIndex - node.startIndex;
      result += raw.slice(lastEnd, start);
      result += interpretEscape(child.text);
      lastEnd = child.endIndex - node.startIndex;
    }
  }
  result += raw.slice(lastEnd);
  return result;
}

export function extractStringContent(node: SyntaxNode): string {
  let result = "";
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)!;
    if (child.type === "string_content") {
      result += processStringContent(child);
    } else if (child.type === "escape_sequence") {
      result += interpretEscape(child.text);
    }
  }
  return result;
}

export function mapPrefix(keyType: HIRType, valueType: HIRType): string {
  const k = keyType.kind === "i8ptr" ? "str" : "num";
  const v = valueType.kind === "i8ptr" ? "str" : "num";
  return `cs2_${k}_${v}_map`;
}

export function resolveArithResultType(a: HIRType, b: HIRType): HIRType {
  if (a.kind === "f64" || b.kind === "f64") return F64;
  if (a.kind === "i64" || b.kind === "i64") return I64;
  return F64;
}

export function coerceTo(expr: HIRExpr, target: HIRType): HIRExpr {
  if (expr.type.kind === target.kind) return expr;
  if (expr.type.kind === "i64" && target.kind === "f64") {
    return { kind: "widen_f64", value: expr, type: F64 };
  }
  if (expr.type.kind === "f64" && target.kind === "i64") {
    return { kind: "narrow_i64", value: expr, type: I64 };
  }
  if (expr.type.kind === "i1" && target.kind === "i64") {
    return { kind: "narrow_i64", value: expr, type: I64 };
  }
  return expr;
}

export function coerceToF64(expr: HIRExpr): HIRExpr {
  return coerceTo(expr, F64);
}

export function resolveType(node: SyntaxNode, ctx: LowerCtx): HIRType {
  if (node.type === "type") {
    const inner = node.namedChild(0);
    return inner ? resolveType(inner, ctx) : BOXED;
  }
  if (node.type === "generic_type") {
    const baseName = node.namedChild(0)!.text;
    const typeParams = node.namedChild(1);
    if (baseName === "list" && typeParams) {
      const elemNode = typeParams.namedChild(0);
      const elemType = elemNode ? resolveType(elemNode, ctx) : F64;
      return { kind: "array", element: elemType };
    }
    if (baseName === "dict" && typeParams) {
      const keyNode = typeParams.namedChild(0);
      const valNode = typeParams.namedChild(1);
      const rawKey = keyNode ? resolveType(keyNode, ctx) : I8PTR;
      const rawVal = valNode ? resolveType(valNode, ctx) : I8PTR;
      const keyType = rawKey.kind === "i64" ? F64 : rawKey;
      return { kind: "map", key: keyType, value: rawVal };
    }
    if (baseName === "set" && typeParams) {
      const elemNode = typeParams.namedChild(0);
      const elemType = elemNode ? resolveType(elemNode, ctx) : F64;
      const storageType = elemType.kind === "i64" ? F64 : elemType;
      return { kind: "set", element: storageType };
    }
    if ((baseName === "Optional" || baseName === "Union") && typeParams) {
      const inner = typeParams.namedChild(0);
      return inner ? resolveType(inner, ctx) : BOXED;
    }
    return BOXED;
  }
  if (node.type === "none") return VOID;
  const text = node.text;
  switch (text) {
    case "int": return I64;
    case "float": return F64;
    case "str": return I8PTR;
    case "bool": return I1;
    case "None": return VOID;
    default:
      if (ctx.classes.has(text)) return { kind: "ptr", pointee: text };
      return BOXED;
  }
}

export function inferType(node: SyntaxNode): HIRType {
  switch (node.type) {
    case "integer": return I64;
    case "float": return F64;
    case "string": return I8PTR;
    case "true":
    case "false":
      return I1;
    case "list": {
      if (node.namedChildCount === 0) return { kind: "array", element: F64 };
      const first = node.namedChild(0)!;
      const t = inferType(first);
      return { kind: "array", element: t };
    }
    case "dictionary": {
      if (node.namedChildCount === 0) return { kind: "map", key: I8PTR, value: I8PTR };
      const pair = node.namedChild(0)!;
      if (pair.type === "pair") {
        const kRaw = inferType(pair.namedChild(0)!);
        const vRaw = inferType(pair.namedChild(1)!);
        return {
          kind: "map",
          key: kRaw.kind === "i64" ? F64 : kRaw,
          value: vRaw,
        };
      }
      return { kind: "map", key: I8PTR, value: I8PTR };
    }
    default: return BOXED;
  }
}

export function defaultValue(type: HIRType): HIRExpr {
  switch (type.kind) {
    case "f64": return { kind: "literal_f64", value: 0, type: F64 };
    case "i64": return { kind: "literal_i64", value: 0, type: I64 };
    case "i1": return { kind: "literal_i1", value: false, type: I1 };
    case "i8ptr": return { kind: "literal_string", value: "", type: I8PTR };
    case "array": return { kind: "alloc_array", elementType: type.element, initialValues: [], type };
    case "map": return { kind: "alloc_map", keyType: type.key, valueType: type.value, entries: [], type };
    default: return { kind: "literal_null", type: { kind: "ptr", pointee: "" } };
  }
}

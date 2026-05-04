import type { HIRType, HIRParam, BinaryOp } from "./types.js";
import { F64, I64, I1, I8PTR, VOID, BOXED, DYNOBJ, DYNARRAY } from "./types.js";

export let sourceText = "";
export let lineOffsets: number[] = [];

export function buildLineOffsets(source: string): number[] {
  const offsets = [0];
  const len = source.length;
  for (let i = 0; i < len; i++) {
    const ch = source[i];
    if (ch === "\n") offsets.push(i + 1);
  }
  return offsets;
}

export function setSourceText(s: string): void {
  sourceText = s;
}

export function setLineOffsets(o: number[]): void {
  lineOffsets = o;
}

export function offsetToLine(offset: number): number {
  let lo = 0;
  let hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineOffsets[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

export let nextId = 0;
export const locals = new Map<string, { id: number; type: HIRType; mutable: boolean }>();
export const catchParamIds = new Set<number>();

export let expectedClosureParamTypes: HIRType[] | null = null;
export function setExpectedClosureParamTypes(types: HIRType[] | null): void {
  expectedClosureParamTypes = types;
}
export const globals = new Map<string, { type: HIRType; mutable: boolean }>();
export const functionRegistry = new Map<string, { params: HIRParam[]; returnType: HIRType }>();
export const classRegistry = new Map<
  string,
  {
    fields: { name: string; type: HIRType }[];
    methods: Map<string, { params: HIRParam[]; returnType: HIRType }>;
    parent?: string;
  }
>();
export const interfaceRegistry = new Map<
  string,
  {
    fields: { name: string; type: HIRType }[];
    methods: { name: string; params: HIRParam[]; returnType: HIRType }[];
  }
>();
export const restParamRegistry = new Map<string, number>();
export const typeAliasRegistry = new Map<string, HIRType>();
export let isModuleScope = true;
export let expectedArrayElementType: HIRType | null = null;
export let expectedMapType: HIRType | null = null;
export let expectedDeclType: HIRType | null = null;
export let currentClassName: string | null = null;
export let sourceFilePath: string | null = null;
export let nextAnonId = 0;
export const fnAliases = new Map<string, string>();
export const builtinImports = new Map<string, { module: string; imported: string }>();
export const pendingFunctions: import("./types.js").HIRFunction[] = [];
export let outerLocals: Map<string, { id: number; type: HIRType; mutable: boolean }> | null = null;
export let capturedIds = new Set<number>();
export const closureInfoMap = new Map<
  string,
  { captures: { id: number; type: HIRType }[]; params: HIRType[]; returnType: HIRType }
>();

export const enumRegistry = new Map<
  string,
  { members: { name: string; value: number | string }[]; memberType: HIRType }
>();
export const genericFunctionTemplates = new Map<string, { decl: any; typeParams: string[] }>();
export const genericClassTemplates = new Map<string, { decl: any; typeParams: string[] }>();
export const genericSpecializations = new Map<string, boolean>();
export let typeParamContext: Map<string, HIRType> | null = null;
export let pendingGenericClasses: { hirClass: import("./types.js").HIRClass; fns: import("./types.js").HIRFunction[] }[] = [];

export function setTypeParamContext(ctx: Map<string, HIRType> | null): void {
  typeParamContext = ctx;
}

export const narrowedLocals = new Map<string, HIRType>();

export function pushNarrowing(name: string, type: HIRType): void {
  narrowedLocals.set(name, type);
}

export function popNarrowing(name: string): void {
  narrowedLocals.delete(name);
}

export function mangleGenericName(baseName: string, typeArgs: HIRType[]): string {
  return `${baseName}_${typeArgs.map(mangleType).join("_")}`;
}

function mangleType(t: HIRType): string {
  switch (t.kind) {
    case "f64":
      return "f64";
    case "i64":
      return "i64";
    case "i1":
      return "i1";
    case "i8ptr":
      return "str";
    case "void":
      return "void";
    case "boxed":
      return "boxed";
    case "ptr":
      return t.pointee;
    case "array":
      return `arr_${mangleType(t.element)}`;
    case "closure":
      return "closure";
    case "struct":
      return t.name;
    case "promise":
      return `promise_${mangleType(t.inner)}`;
    default:
      throw new Error(`cannot mangle type: ${(t as any).kind}`);
  }
}

export function setNextId(n: number): void {
  nextId = n;
}

export let currentLoweringFn: string | null = null;
export function setCurrentLoweringFn(name: string | null): void {
  currentLoweringFn = name;
}

export let currentReturnType: HIRType | null = null;
export function setCurrentReturnType(t: HIRType | null): void {
  currentReturnType = t;
}

export function setIsModuleScope(v: boolean): void {
  isModuleScope = v;
}

export function setExpectedArrayElementType(t: HIRType | null): void {
  expectedArrayElementType = t;
}

export function setExpectedMapType(t: HIRType | null): void {
  expectedMapType = t;
}

export function setExpectedDeclType(t: HIRType | null): void {
  expectedDeclType = t;
}

export function setCurrentClassName(name: string | null): void {
  currentClassName = name;
}

export function setSourceFilePath(path: string | null): void {
  sourceFilePath = path;
}

export function setNextAnonId(n: number): void {
  nextAnonId = n;
}

export function incNextAnonId(): number {
  return nextAnonId++;
}

export function setOuterLocals(
  m: Map<string, { id: number; type: HIRType; mutable: boolean }> | null,
): void {
  outerLocals = m;
}

export function setCapturedIds(s: Set<number>): void {
  capturedIds = s;
}

export function freshId(): number {
  return nextId++;
}

export function resetState(): void {
  nextId = 0;
  locals.clear();
}

export function resolveTypeAnnotation(ann: any): HIRType {
  if (!ann) return BOXED;

  const ta = ann.type === "TsTypeAnnotation" ? ann.typeAnnotation : ann;
  if (!ta) return BOXED;

  if (ta.type === "TsKeywordType") {
    switch (ta.kind) {
      case "number":
        return F64;
      case "string":
        return I8PTR;
      case "boolean":
        return I1;
      case "void":
        return VOID;
      case "any":
        return BOXED;
      default:
        return BOXED;
    }
  }

  if (ta.type === "TsTypeAnnotation") {
    return resolveTypeAnnotation(ta.typeAnnotation);
  }

  if (ta.type === "TsArrayType") {
    const elem = resolveTypeAnnotation(ta.elemType);
    return { kind: "array", element: elem };
  }

  if (ta.type === "TsTupleType") {
    const elems: HIRType[] = (ta.elemTypes || []).map((e: any) =>
      resolveTypeAnnotation(e.ty || e),
    );
    const first = elems[0] ?? BOXED;
    const allSame = elems.every((e) => e.kind === first.kind);
    return { kind: "array", element: allSame ? first : BOXED };
  }

  if (ta.type === "TsTypeReference" && ta.typeName?.type === "Identifier") {
    const name = ta.typeName.value;

    if (typeParamContext && typeParamContext.has(name)) {
      return typeParamContext.get(name)!;
    }

    if (name === "Array" && ta.typeParams?.params?.length === 1) {
      const elem = resolveTypeAnnotation(ta.typeParams.params[0]);
      return { kind: "array", element: elem };
    }

    if (name === "Promise" && ta.typeParams?.params?.length === 1) {
      const inner = resolveTypeAnnotation(ta.typeParams.params[0]);
      return { kind: "promise", inner };
    }

    if (name === "Map" && ta.typeParams?.params?.length === 2) {
      const key = resolveTypeAnnotation(ta.typeParams.params[0]);
      const value = resolveTypeAnnotation(ta.typeParams.params[1]);
      return { kind: "map", key, value };
    }

    if (name === "Record" && ta.typeParams?.params?.length === 2) {
      const key = resolveTypeAnnotation(ta.typeParams.params[0]);
      const value = resolveTypeAnnotation(ta.typeParams.params[1]);
      return { kind: "map", key, value };
    }

    if (name === "Set" && ta.typeParams?.params?.length === 1) {
      const elem = resolveTypeAnnotation(ta.typeParams.params[0]);
      return { kind: "set", element: elem };
    }

    if (enumRegistry.has(name)) {
      return enumRegistry.get(name)!.memberType;
    }

    if (name === "Date") {
      return { kind: "ptr", pointee: "Date" };
    }

    if (classRegistry.has(name) || interfaceRegistry.has(name)) {
      return { kind: "ptr", pointee: name };
    }

    if (typeAliasRegistry.has(name)) {
      return typeAliasRegistry.get(name)!;
    }
  }

  if (ta.type === "TsUnionType" && Array.isArray(ta.types)) {
    const nonNull = ta.types.filter(
      (t: any) => !(t.type === "TsKeywordType" && (t.kind === "null" || t.kind === "undefined")),
    );
    if (nonNull.length === 1) {
      return resolveTypeAnnotation(nonNull[0]);
    }
    if (nonNull.some((t: any) => t.type === "TsTypeLiteral")) {
      const props = collectUnionProps(nonNull);
      const variants = nonNull
        .filter((t: any) => t.type === "TsTypeLiteral")
        .map((t: any) => extractVariant(t));
      return { kind: "dynobj", props: props.length > 0 ? props : undefined, variants };
    }
    return BOXED;
  }

  if (ta.type === "TsTypeLiteral") {
    const props = extractTypeLiteralProps(ta);
    return { kind: "dynobj", props: props.length > 0 ? props : undefined };
  }

  if (ta.type === "TsIntersectionType" && Array.isArray(ta.types)) {
    const allProps: { name: string; type: HIRType }[] = [];
    for (const t of ta.types) {
      const resolved = resolveTypeAnnotation(t);
      if (resolved.kind === "dynobj" && resolved.props) {
        allProps.push(...resolved.props);
      }
    }
    return { kind: "dynobj", props: allProps.length > 0 ? allProps : undefined };
  }

  if (ta.type === "TsLiteralType") {
    if (ta.literal?.type === "StringLiteral") return I8PTR;
    if (ta.literal?.type === "NumericLiteral") return F64;
    if (ta.literal?.type === "BooleanLiteral") return I1;
    return BOXED;
  }

  if (ta.type === "TsFunctionType" || ta.type === "TsParenthesizedType") {
    const fnType = ta.type === "TsParenthesizedType" ? ta.typeAnnotation : ta;
    if (fnType.type === "TsFunctionType") {
      const params = (fnType.params || []).map((p: any) => resolveTypeAnnotation(p.typeAnnotation));
      const ret = fnType.typeAnnotation ? resolveTypeAnnotation(fnType.typeAnnotation) : VOID;
      return { kind: "closure", params, returnType: ret };
    }
  }

  return BOXED;
}

function extractTypeLiteralProps(ta: any): { name: string; type: HIRType }[] {
  const props: { name: string; type: HIRType }[] = [];
  if (ta.type !== "TsTypeLiteral" || !ta.members) return props;
  for (const m of ta.members) {
    if (m.type === "TsPropertySignature" && m.key?.type === "Identifier") {
      props.push({ name: m.key.value, type: resolveTypeAnnotation(m.typeAnnotation) });
    }
  }
  return props;
}

function extractVariant(ta: any): { fields: { name: string; type: HIRType }[]; literals: Record<string, string> } {
  const fields: { name: string; type: HIRType }[] = [];
  const literals: Record<string, string> = {};
  if (ta.type !== "TsTypeLiteral" || !ta.members) return { fields, literals };
  for (const m of ta.members) {
    if (m.type === "TsPropertySignature" && m.key?.type === "Identifier") {
      const name = m.key.value;
      const typeAnn = m.typeAnnotation;
      if (typeAnn?.type === "TsLiteralType" && typeAnn.literal?.type === "StringLiteral") {
        literals[name] = typeAnn.literal.value;
      }
      fields.push({ name, type: resolveTypeAnnotation(typeAnn) });
    }
  }
  return { fields, literals };
}

function collectUnionProps(variants: any[]): { name: string; type: HIRType }[] {
  const allProps = new Map<string, HIRType[]>();
  for (const v of variants) {
    if (v.type !== "TsTypeLiteral") continue;
    const vProps = extractTypeLiteralProps(v);
    for (const p of vProps) {
      if (!allProps.has(p.name)) allProps.set(p.name, []);
      allProps.get(p.name)!.push(p.type);
    }
  }
  const result: { name: string; type: HIRType }[] = [];
  for (const [name, types] of allProps) {
    const first = types[0];
    const allSame = types.every((t) => t.kind === first.kind);
    result.push({ name, type: allSame ? first : BOXED });
  }
  return result;
}

export function coerce(
  expr: import("./types.js").HIRExpr,
  target: HIRType,
): import("./types.js").HIRExpr {
  if (expr.type.kind === target.kind) {
    if (
      expr.type.kind === "ptr" &&
      target.kind === "ptr" &&
      (expr.type as any).pointee !== (target as any).pointee
    ) {
      const srcName = (expr.type as any).pointee as string;
      const dstName = (target as any).pointee as string;
      if (classRegistry.has(srcName) && interfaceRegistry.has(dstName)) {
        return {
          kind: "wrap_interface",
          value: expr,
          className: srcName,
          interfaceName: dstName,
          type: target,
        };
      }
    }
    return expr;
  }
  if (expr.type.kind === "i64" && target.kind === "f64") {
    return { kind: "widen_f64", value: expr, type: F64 };
  }
  if (expr.type.kind === "f64" && target.kind === "i64") {
    return { kind: "narrow_i64", value: expr, type: I64 };
  }
  if (expr.kind === "literal_null" && target.kind === "ptr") {
    return { kind: "literal_null", type: target };
  }
  if (target.kind === "boxed" && expr.type.kind !== "boxed") {
    return { kind: "box", value: expr, fromType: expr.type, type: BOXED };
  }
  if (expr.type.kind === "boxed" && target.kind !== "boxed") {
    return { kind: "unbox", value: expr, toType: target, type: target };
  }
  if (expr.type.kind === "dynarray" && target.kind === "array") {
    return {
      kind: "runtime_call",
      func: "cs2_obj_array_from_dynarray",
      args: [expr],
      returnType: target,
      type: target,
    };
  }
  if (expr.type.kind === "array" && target.kind === "dynarray") {
    const elKind = ((expr.type as any).element as HIRType | undefined)?.kind;
    let convName: string;
    if (elKind === "i8ptr") convName = "cs2_dynarray_from_str_array";
    else if (elKind === "f64" || elKind === "i64") convName = "cs2_dynarray_from_num_array";
    else if (elKind === "boxed") convName = "cs2_dynarray_from_boxed_array";
    else convName = "cs2_dynarray_from_obj_array";
    return {
      kind: "runtime_call",
      func: convName,
      args: [expr],
      returnType: DYNARRAY,
      type: DYNARRAY,
    };
  }
  return expr;
}

export function coerceToCondition(
  expr: import("./types.js").HIRExpr,
): import("./types.js").HIRExpr {
  if (expr.type.kind === "boxed") {
    return {
      kind: "binary",
      op: "ne" as BinaryOp,
      left: {
        kind: "runtime_call",
        func: "nanbox_truthy",
        args: [expr],
        returnType: I64,
        type: I64,
      },
      right: { kind: "literal_i64", value: 0, type: I64 },
      type: I1,
    };
  }
  return expr;
}

export function resolveArithType(a: HIRType, b: HIRType): HIRType {
  if (a.kind === "i64" && b.kind === "i64") return I64;
  if (a.kind === "f64" || b.kind === "f64") return F64;
  if (a.kind === "i64" || b.kind === "i64") return I64;
  return F64;
}

export function defaultValue(type: HIRType): import("./types.js").HIRExpr {
  switch (type.kind) {
    case "f64":
      return { kind: "literal_f64", value: 0, type: F64 };
    case "i64":
      return { kind: "literal_i64", value: 0, type: I64 };
    case "i1":
      return { kind: "literal_i1", value: false, type: I1 };
    case "i8ptr":
      return { kind: "literal_string", value: "", type: I8PTR };
    default:
      return { kind: "literal_null", type: { kind: "ptr", pointee: "" } };
  }
}

export function lineOf(node: { span?: { start: number } }): number | undefined {
  return node.span ? offsetToLine(node.span.start) : undefined;
}

export function withLine<T extends import("./types.js").HIRStmt>(
  stmt: T,
  node: { span?: { start: number } },
): T {
  const line = lineOf(node);
  if (line !== undefined) (stmt as any).line = line;
  return stmt;
}

export function arrayPrefix(elemType: HIRType): string {
  if (elemType.kind === "i8ptr") return "cs2_str_array";
  if (elemType.kind === "ptr" || elemType.kind === "dynobj" || elemType.kind === "dynarray" || elemType.kind === "map" || elemType.kind === "boxed" || elemType.kind === "array") return "cs2_obj_array";
  return "cs2_num_array";
}

export function mapPrefix(keyType: HIRType, valueType: HIRType): string {
  const k = keyType.kind === "i8ptr" ? "str" : "num";
  const primitiveVal = valueType.kind === "i8ptr" || valueType.kind === "f64" || valueType.kind === "i64" || valueType.kind === "i1";
  const v = valueType.kind === "i8ptr" ? "str" : primitiveVal ? "num" : "ptr";
  return `cs2_${k}_${v}_map`;
}

export function setPrefix(elemType: HIRType): string {
  return elemType.kind === "i8ptr" ? "cs2_str_set" : "cs2_num_set";
}

export function mapBinaryOp(op: string): BinaryOp {
  switch (op) {
    case "+":
      return "add";
    case "-":
      return "sub";
    case "*":
      return "mul";
    case "/":
      return "div";
    case "%":
      return "rem";
    case "===":
    case "==":
      return "eq";
    case "!==":
    case "!=":
      return "ne";
    case "<":
      return "lt";
    case "<=":
      return "le";
    case ">":
      return "gt";
    case ">=":
      return "ge";
    case "&&":
      return "and";
    case "||":
      return "or";
    case "&":
      return "bit_and";
    case "|":
      return "bit_or";
    case "^":
      return "bit_xor";
    case "<<":
      return "shl";
    case ">>":
      return "shr";
    case ">>>":
      return "ushr";
    default:
      throw new Error(`unsupported binary operator: ${op}`);
  }
}

export const BITWISE_OPS = new Set<string>();
BITWISE_OPS.add("bit_and");
BITWISE_OPS.add("bit_or");
BITWISE_OPS.add("bit_xor");
BITWISE_OPS.add("shl");
BITWISE_OPS.add("shr");
BITWISE_OPS.add("ushr");

export const compoundOpMap: Record<string, BinaryOp> = {
  "+=": "add",
  "-=": "sub",
  "*=": "mul",
  "/=": "div",
  "%=": "rem",
  "&=": "bit_and",
  "|=": "bit_or",
  "^=": "bit_xor",
  "<<=": "shl",
  ">>=": "shr",
  ">>>=": "ushr",
};

export function resolveObjectDestructProps(
  properties: any[],
): { fieldName: string; localName: string; span: any }[] {
  return properties.map((prop: any) => {
    switch (prop.type) {
      case "AssignmentPatternProperty":
        return { fieldName: prop.key.value, localName: prop.key.value, span: prop.span };
      case "KeyValuePatternProperty":
        return { fieldName: prop.key.value, localName: prop.value.value, span: prop.key.span };
      default:
        throw new Error(`unsupported object destructuring property: ${prop.type}`);
    }
  });
}

export type NumericKind = "integer" | "float";

export function stripOptional(name: string): string {
  if (!name) return "";
  return name.endsWith("?") ? name.slice(0, name.length - 1) : name;
}

export function stripNullable(t: string): string {
  if (!t) return "";
  let str = t.trim();
  if (str.indexOf(" | null") !== -1) str = str.replace(" | null", "");
  if (str.indexOf(" | undefined") !== -1) str = str.replace(" | undefined", "");
  if (str.indexOf("null | ") !== -1) str = str.replace("null | ", "");
  if (str.indexOf("undefined | ") !== -1) str = str.replace("undefined | ", "");
  return str.trim();
}

interface TypeQualifiers {
  isNullable: boolean;
  isOptional: boolean;
  numericKind?: NumericKind;
}

export interface ResolvedType {
  base: string;
  qualifiers: TypeQualifiers;
  arrayDepth: number;
  typeParams?: ResolvedType[];
  id?: number;
  cachedLlvmType?: string;
}

const DEFAULT_QUALIFIERS: TypeQualifiers = { isNullable: false, isOptional: false };

export function createResolvedType(
  base: string,
  qualifiers: Partial<TypeQualifiers> = {},
  arrayDepth: number = 0,
  typeParams?: ResolvedType[],
): ResolvedType {
  return {
    base,
    qualifiers: { ...DEFAULT_QUALIFIERS, ...qualifiers },
    arrayDepth,
    typeParams,
  };
}

export function parseTypeString(typeStr: string): ResolvedType {
  if (!typeStr) {
    return createResolvedType("unknown");
  }

  let str = typeStr.trim();
  const qualifiers: TypeQualifiers = { isNullable: false, isOptional: false };

  if (str.indexOf(" | undefined") !== -1) {
    qualifiers.isNullable = true;
    str = str.replace(" | undefined", "");
  }
  if (str.indexOf(" | null") !== -1) {
    qualifiers.isNullable = true;
    str = str.replace(" | null", "");
  }
  if (str.endsWith("?")) {
    qualifiers.isOptional = true;
    str = str.slice(0, str.length - 1);
  }

  let arrayDepth = 0;
  while (str.endsWith("[]")) {
    arrayDepth++;
    str = str.slice(0, -2);
  }

  const genericParsed = parseGenericTypeString(str);
  if (genericParsed) {
    const base = genericParsed.base;
    const paramsStr = genericParsed.params;
    const typeParams = parseGenericParams(paramsStr);
    return { base, qualifiers, arrayDepth, typeParams };
  }

  return { base: str, qualifiers, arrayDepth };
}

function parseGenericParams(paramsStr: string): ResolvedType[] {
  if (!paramsStr) return [];
  const params: ResolvedType[] = [];
  let depth = 0;
  let current = "";

  for (let i = 0; i < paramsStr.length; i++) {
    const char = paramsStr[i];
    if (char === "<") {
      depth++;
      current += char;
    } else if (char === ">") {
      depth--;
      current += char;
    } else if (char === "," && depth === 0) {
      params.push(parseTypeString(current.trim()));
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    params.push(parseTypeString(current.trim()));
  }

  return params;
}

export function createIntegerType(): ResolvedType {
  return createResolvedType("number", { numericKind: "integer" });
}

export function createFloatType(): ResolvedType {
  return createResolvedType("number", { numericKind: "float" });
}

export function tsTypeToLlvm(tsType: string): string {
  return canonicalTypeToLlvm(tsType, "default", false, false, "");
}

export function resolvedTypeToLlvm(rt: ResolvedType): string {
  if (rt.cachedLlvmType) return rt.cachedLlvmType;
  if (rt.arrayDepth > 0) {
    if (rt.base === "string") return "%StringArray*";
    if (rt.base === "number" || rt.base === "boolean") return "%Array*";
    return "%ObjectArray*";
  }
  if (rt.base === "string") return "i8*";
  if (rt.base === "Uint8Array" && rt.arrayDepth === 0) return "%Uint8Array*";
  if (rt.base === "number" && rt.qualifiers.numericKind === "integer") return "i64";
  if (rt.base === "number" || rt.base === "boolean") return "double";
  if (rt.base === "void") return "void";
  if (rt.base === "null" || rt.base === "undefined") return "i8*";
  if (rt.base.startsWith("Map")) return "%StringMap*";
  if (rt.base.startsWith("Set")) return "%StringSet*";
  return "i8*";
}

export type TypeMappingMode = "default" | "param" | "return" | "struct_field" | "json";

export function canonicalTypeToLlvm(
  tsType: string,
  mode: string,
  isEnum: boolean,
  isInterface: boolean,
  fieldName: string,
): string {
  if (tsType === null || tsType === undefined || tsType === "") {
    // Empty/null type: callers should provide a valid type. These defaults are
    // intentional language semantics — untyped returns are double (number),
    // untyped params/fields are i8* (pointer, the safer default).
    if (mode === "return") return "double";
    return "i8*";
  }

  // FFI type passthrough — zero-cost: maps directly to LLVM types with no
  // double conversion. Used in `declare function` for calling C code.
  if (tsType === "i8") return "i8";
  if (tsType === "i16") return "i16";
  if (tsType === "i32") return "i32";
  if (tsType === "i64") return "i64";
  if (tsType === "u8") return "i8";
  if (tsType === "u16") return "i16";
  if (tsType === "u32") return "i32";
  if (tsType === "u64") return "i64";
  if (tsType === "f32") return "float";
  if (tsType === "f64") return "double";
  if (tsType === "i8_ptr" || tsType === "ptr") return "i8*";

  if (fieldName === "nodePtr" || fieldName === "treePtr") return "i8*";

  if (mode === "param") {
    if (tsType === "any" || tsType === "unknown") {
      throw new Error(
        `Parameter type '${tsType}' is not allowed — add explicit type annotations or fix the parser`,
      );
    }
  }

  if (isEnum) return "double";

  if (tsType === "string") return "i8*";
  if (tsType === "number" || tsType === "boolean") return "double";
  if (tsType === "void") return "void";
  if (tsType === "string[]") return "%StringArray*";
  if (tsType === "number[]" || tsType === "boolean[]") return "%Array*";
  if (tsType === "Uint8Array") return "%Uint8Array*";
  if (tsType.endsWith("[]")) return "%ObjectArray*";
  if (tsType.startsWith("Set<")) return "%StringSet*";
  if (tsType.startsWith("Map<")) return "%StringMap*";
  if (tsType.startsWith("'") || tsType.startsWith('"')) return "i8*";

  if (tsType.indexOf(" | ") !== -1) {
    const parts = tsType.split(" | ");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (part === "null" || part === "undefined") continue;
      return canonicalTypeToLlvm(part, mode, isEnum, isInterface, fieldName);
    }
  }

  if (isInterface && (mode === "param" || mode === "struct_field")) {
    return `%${tsType}*`;
  }

  if (mode === "return") {
    if (tsType !== "number" && tsType !== "boolean") return "i8*";
    return "double";
  }

  if (mode === "json") {
    return "i8*";
  }

  return "i8*";
}

export function tsTypeToLlvmJson(tsType: string): string {
  return canonicalTypeToLlvm(tsType, "json", false, false, "");
}

export function checkUnsafeUnionType(typeStr: string): string | null {
  if (!typeStr || typeStr.indexOf(" | ") === -1) return null;

  const parts = splitTopLevelUnion(typeStr);
  if (parts.length <= 1) return null;

  const nonNullParts: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (part !== "null" && part !== "undefined") {
      nonNullParts.push(part);
    }
  }

  if (nonNullParts.length <= 1) return null;

  const llvmTypes: string[] = [];
  for (let i = 0; i < nonNullParts.length; i++) {
    llvmTypes.push(tsTypeToLlvm(nonNullParts[i]));
  }

  let hasDifferentTypes = false;
  for (let i = 1; i < llvmTypes.length; i++) {
    if (llvmTypes[i] !== llvmTypes[0]) {
      hasDifferentTypes = true;
      break;
    }
  }

  if (hasDifferentTypes) {
    return (
      "Union type '" +
      typeStr +
      "' has members with different native representations (" +
      llvmTypes.join(", ") +
      "). This will be miscompiled. Use a single concrete type or a common base type instead."
    );
  }

  return null;
}

function splitTopLevelUnion(typeStr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (let i = 0; i < typeStr.length; i++) {
    const ch = typeStr[i];
    if (ch === "{" || ch === "<" || ch === "(") {
      depth++;
      current += ch;
    } else if (ch === "}" || ch === ">" || ch === ")") {
      depth--;
      current += ch;
    } else if (ch === "|" && depth === 0 && typeStr[i - 1] === " " && typeStr[i + 1] === " ") {
      parts.push(current.slice(0, current.length - 1));
      current = "";
      i++;
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

export function parseMapTypeString(s: string): { keyType: string; valueType: string } | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed.startsWith("Map<")) return null;
  if (!trimmed.endsWith(">")) return null;
  const inner = trimmed.substring(4, trimmed.length - 1);
  let depth = 0;
  let commaIdx: number = -1;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "<") {
      depth = depth + 1;
    } else if (ch === ">") {
      depth = depth - 1;
    } else if (ch === "," && depth === 0) {
      commaIdx = i;
      break;
    }
  }
  if (commaIdx === -1) return null;
  const keyType = inner.substring(0, commaIdx).trim();
  const valueType = inner.substring(commaIdx + 1).trim();
  if (!keyType || !valueType) return null;
  return { keyType, valueType };
}

export function parseSetTypeString(s: string): { valueType: string } | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed.startsWith("Set<")) return null;
  if (!trimmed.endsWith(">")) return null;
  const valueType = trimmed.substring(4, trimmed.length - 1).trim();
  if (!valueType) return null;
  return { valueType };
}

export function parseArrayTypeString(s: string): { elementType: string } | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed.endsWith("[]")) return null;
  const elementType = trimmed.substring(0, trimmed.length - 2).trim();
  if (!elementType) return null;
  return { elementType };
}

export function isEnumType(
  typeName: string,
  enums: { name: string }[] | null | undefined,
): boolean {
  if (!enums) return false;
  let checkType = typeName;
  if (checkType.indexOf(" | ") !== -1) {
    const parts = checkType.split(" | ");
    for (let j = 0; j < parts.length; j++) {
      const part = parts[j].trim();
      if (part !== "undefined" && part !== "null") {
        checkType = part;
        break;
      }
    }
  }
  for (let i = 0; i < enums.length; i++) {
    if (enums[i].name === checkType) {
      return true;
    }
  }
  return false;
}

export function mapParamTypeToLLVM(
  paramType: string,
  paramName: string,
  paramIsEnum: boolean,
  paramIsInterface: boolean,
): string {
  return canonicalTypeToLlvm(paramType, "param", paramIsEnum, paramIsInterface, paramName);
}

export function mapReturnTypeToLLVM(returnType: string, returnIsEnum: boolean): string {
  return canonicalTypeToLlvm(returnType, "return", returnIsEnum, false, "");
}

function parseGenericTypeString(s: string): { base: string; params: string } | null {
  if (!s) return null;
  const lt = s.indexOf("<");
  if (lt === -1) return null;
  if (!s.endsWith(">")) return null;
  const base = s.substring(0, lt);
  const params = s.substring(lt + 1, s.length - 1);
  return { base, params };
}

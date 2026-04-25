import {
  ResolvedType,
  createResolvedType,
  createIntegerType,
  parseTypeString,
  isAnyArrayTsType,
} from "./type-system.js";

export class TypeContext {
  private nextId: number = 1;
  private internMap: Map<string, ResolvedType>;
  private internKeys: string[];
  private internKeysCount: number = 0;

  public numberType: ResolvedType;
  public integerType: ResolvedType;
  public stringType: ResolvedType;
  public booleanType: ResolvedType;
  public voidType: ResolvedType;
  public nullType: ResolvedType;
  public unknownType: ResolvedType;

  constructor() {
    this.internMap = new Map();
    this.internKeys = [];

    this.numberType = this.intern("number", "double");
    const intType = createIntegerType();
    intType.id = this.nextId++;
    intType.cachedLlvmType = "i64";
    this.integerType = intType;
    this.stringType = this.intern("string", "i8*");
    this.booleanType = this.intern("boolean", "double");
    this.voidType = this.intern("void", "void");
    this.nullType = this.intern("null", "i8*");
    this.unknownType = this.intern("unknown", "i8*");
  }

  private canonicalKey(base: string, arrayDepth: number, isNullable: boolean): string {
    let key = base;
    for (let i = 0; i < arrayDepth; i++) {
      key = key + "[]";
    }
    if (isNullable) {
      key = key + "?";
    }
    return key;
  }

  private intern(
    base: string,
    llvmType: string,
    arrayDepth?: number,
    isNullable?: boolean,
  ): ResolvedType {
    const depth = arrayDepth || 0;
    const nullable = isNullable || false;
    const key = this.canonicalKey(base, depth, nullable);
    const existing = this.internMap.get(key);
    if (existing) {
      return existing;
    }
    const resolved = createResolvedType(base, { isNullable: nullable }, depth);
    resolved.id = this.nextId;
    this.nextId++;
    resolved.cachedLlvmType = llvmType;
    this.internMap.set(key, resolved);
    this.internKeys.push(key);
    this.internKeysCount++;
    return resolved;
  }

  getArrayType(elementBase: string): ResolvedType {
    if (elementBase === "string") {
      return this.intern("string", "%StringArray*", 1);
    }
    if (elementBase === "number" || elementBase === "boolean") {
      return this.intern("number", "%Array*", 1);
    }
    return this.intern(elementBase, "%ObjectArray*", 1);
  }

  getMapType(keyType: string, valueType: string): ResolvedType {
    const base = "Map<" + keyType + "," + valueType + ">";
    return this.intern(base, "%StringMap*");
  }

  getSetType(valueType: string): ResolvedType {
    const base = "Set<" + valueType + ">";
    const llvmType = valueType === "string" ? "%StringSet*" : "%Set*";
    return this.intern(base, llvmType);
  }

  getInterfaceType(name: string): ResolvedType {
    return this.intern(name, "%" + name + "*");
  }

  getClassType(name: string): ResolvedType {
    return this.intern(name, "i8*");
  }

  getNullableType(base: ResolvedType): ResolvedType {
    const llvm = base.cachedLlvmType || "i8*";
    return this.intern(base.base, llvm, base.arrayDepth, true);
  }

  getById(id: number): ResolvedType | undefined {
    const keys = this.internKeys;
    for (let i = 0; i < this.internKeysCount; i++) {
      const val = this.internMap.get(keys[i]);
      if (val && val.id === id) {
        return val;
      }
    }
    return undefined;
  }

  private resolvePrimitive(typeStr: string): ResolvedType | null {
    if (!typeStr) return this.unknownType;
    if (typeStr === "string") return this.stringType;
    if (typeStr === "number") return this.numberType;
    if (typeStr === "boolean") return this.booleanType;
    return null;
  }

  private resolveSpecial(typeStr: string): ResolvedType | null {
    if (typeStr === "void") return this.voidType;
    if (typeStr === "null" || typeStr === "undefined") return this.nullType;
    if (typeStr === "string[]") return this.getArrayType("string");
    if (typeStr === "number[]") return this.getArrayType("number");
    return null;
  }

  resolve(typeStr: string): ResolvedType {
    const prim = this.resolvePrimitive(typeStr);
    if (prim) return prim;
    const special = this.resolveSpecial(typeStr);
    if (special) return special;
    if (typeStr === "boolean[]") return this.getArrayType("boolean");
    if (isAnyArrayTsType(typeStr)) {
      const parsed = parseTypeString(typeStr);
      if (parsed.arrayDepth > 1) return parsed;
      const elem = typeStr.substring(0, typeStr.length - 2);
      return this.getArrayType(elem);
    }
    if (typeStr.startsWith("Map<")) {
      const inner = typeStr.substring(4, typeStr.length - 1);
      const comma = inner.indexOf(",");
      if (comma !== -1) {
        return this.getMapType(inner.substring(0, comma).trim(), inner.substring(comma + 1).trim());
      }
    }
    if (typeStr.startsWith("Set<")) {
      const inner = typeStr.substring(4, typeStr.length - 1);
      return this.getSetType(inner.trim());
    }
    return this.getInterfaceType(typeStr);
  }
}

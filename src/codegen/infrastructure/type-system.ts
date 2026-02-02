export type NumericKind = 'integer' | 'float';

export function stripOptional(name: string): string {
  return name.endsWith('?') ? name.slice(0, -1) : name;
}

export interface TypeQualifiers {
  isNullable: boolean;
  isOptional: boolean;
  numericKind?: NumericKind;
}

export interface ResolvedType {
  base: string;
  qualifiers: TypeQualifiers;
  arrayDepth: number;
  typeParams?: ResolvedType[];
}

const DEFAULT_QUALIFIERS: TypeQualifiers = { isNullable: false, isOptional: false };

export function createResolvedType(
  base: string,
  qualifiers: Partial<TypeQualifiers> = {},
  arrayDepth: number = 0,
  typeParams?: ResolvedType[]
): ResolvedType {
  return {
    base,
    qualifiers: { ...DEFAULT_QUALIFIERS, ...qualifiers },
    arrayDepth,
    typeParams
  };
}

export function parseTypeString(typeStr: string): ResolvedType {
  if (!typeStr) {
    return createResolvedType('unknown');
  }

  let str = typeStr.trim();
  const qualifiers: TypeQualifiers = { isNullable: false, isOptional: false };

  if (str.indexOf(' | undefined') !== -1) {
    qualifiers.isNullable = true;
    str = str.replace(' | undefined', '');
  }
  if (str.indexOf(' | null') !== -1) {
    qualifiers.isNullable = true;
    str = str.replace(' | null', '');
  }
  if (str.endsWith('?')) {
    qualifiers.isOptional = true;
    str = str.slice(0, -1);
  }

  let arrayDepth = 0;
  while (str.endsWith('[]')) {
    arrayDepth++;
    str = str.slice(0, -2);
  }

  const genericMatch = str.match(/^(\w+)<(.+)>$/);
  if (genericMatch) {
    const base = genericMatch[1];
    const paramsStr = genericMatch[2];
    const typeParams = parseGenericParams(paramsStr);
    return { base, qualifiers, arrayDepth, typeParams };
  }

  return { base: str, qualifiers, arrayDepth };
}

function parseGenericParams(paramsStr: string): ResolvedType[] {
  const params: ResolvedType[] = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < paramsStr.length; i++) {
    const char = paramsStr[i];
    if (char === '<') {
      depth++;
      current += char;
    } else if (char === '>') {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0) {
      params.push(parseTypeString(current.trim()));
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    params.push(parseTypeString(current.trim()));
  }

  return params;
}

export function toLlvmType(resolved: ResolvedType): string {
  if (resolved.arrayDepth > 0) {
    if (resolved.base === 'string') {
      return '%StringArray*';
    }
    return '%Array*';
  }

  switch (resolved.base) {
    case 'string':
      return 'i8*';
    case 'number':
      return 'double';
    case 'boolean':
      return 'double';
    case 'void':
      return 'void';
    case 'Map':
      if (resolved.typeParams && resolved.typeParams.length >= 1) {
        if (resolved.typeParams[0].base === 'string') {
          return '%StringMap*';
        }
      }
      return '%Map*';
    case 'Set':
      if (resolved.typeParams && resolved.typeParams.length >= 1) {
        if (resolved.typeParams[0].base === 'string') {
          return '%StringSet*';
        }
      }
      return '%Set*';
    default:
      return 'i8*';
  }
}

export function typeEquals(a: ResolvedType, b: ResolvedType): boolean {
  if (a.base !== b.base) return false;
  if (a.arrayDepth !== b.arrayDepth) return false;
  if (a.qualifiers.isNullable !== b.qualifiers.isNullable) return false;
  if (a.qualifiers.isOptional !== b.qualifiers.isOptional) return false;

  if (a.typeParams && b.typeParams) {
    if (a.typeParams.length !== b.typeParams.length) return false;
    for (let i = 0; i < a.typeParams.length; i++) {
      if (!typeEquals(a.typeParams[i], b.typeParams[i])) return false;
    }
  } else if (a.typeParams || b.typeParams) {
    return false;
  }

  return true;
}

export function isNumericType(resolved: ResolvedType): boolean {
  return resolved.base === 'number' && resolved.arrayDepth === 0;
}

export function isIntegerType(resolved: ResolvedType): boolean {
  return resolved.base === 'number' && resolved.arrayDepth === 0 && resolved.qualifiers.numericKind === 'integer';
}

export function isFloatType(resolved: ResolvedType): boolean {
  return resolved.base === 'number' && resolved.arrayDepth === 0 && resolved.qualifiers.numericKind !== 'integer';
}

export function createIntegerType(): ResolvedType {
  return createResolvedType('number', { numericKind: 'integer' });
}

export function createFloatType(): ResolvedType {
  return createResolvedType('number', { numericKind: 'float' });
}

export function isStringType(resolved: ResolvedType): boolean {
  return resolved.base === 'string' && resolved.arrayDepth === 0;
}

export function isArrayType(resolved: ResolvedType): boolean {
  return resolved.arrayDepth > 0;
}

export function getArrayElementType(resolved: ResolvedType): ResolvedType | null {
  if (resolved.arrayDepth === 0) return null;
  return {
    base: resolved.base,
    qualifiers: { ...resolved.qualifiers },
    arrayDepth: resolved.arrayDepth - 1,
    typeParams: resolved.typeParams
  };
}

export function typeToString(resolved: ResolvedType): string {
  let str = resolved.base;

  if (resolved.typeParams && resolved.typeParams.length > 0) {
    str += '<' + resolved.typeParams.map(typeToString).join(', ') + '>';
  }

  for (let i = 0; i < resolved.arrayDepth; i++) {
    str += '[]';
  }

  if (resolved.qualifiers.isOptional) {
    str += '?';
  }
  if (resolved.qualifiers.isNullable) {
    str += ' | null';
  }

  return str;
}

export interface NumericConversionContext {
  nextTemp(): string;
  emit(instruction: string): void;
  setVariableType?(name: string, type: string): void;
}

export function ensureDouble(
  value: string,
  sourceType: ResolvedType | undefined,
  ctx: NumericConversionContext
): string {
  if (!sourceType || sourceType.base !== 'number') {
    return value;
  }
  if (sourceType.qualifiers.numericKind !== 'integer') {
    return value;
  }
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = sitofp i32 ${value} to double`);
  if (ctx.setVariableType) {
    ctx.setVariableType(temp, 'double');
  }
  return temp;
}

export function ensureI32(
  value: string,
  sourceType: ResolvedType | undefined,
  ctx: NumericConversionContext
): string {
  if (!sourceType || sourceType.base !== 'number') {
    return value;
  }
  if (sourceType.qualifiers.numericKind === 'integer') {
    return value;
  }
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = fptosi double ${value} to i32`);
  if (ctx.setVariableType) {
    ctx.setVariableType(temp, 'i32');
  }
  return temp;
}

export function ensureI64(
  value: string,
  sourceType: ResolvedType | undefined,
  ctx: NumericConversionContext
): string {
  if (!sourceType || sourceType.base !== 'number') {
    return value;
  }
  if (sourceType.qualifiers.numericKind === 'integer') {
    const temp = ctx.nextTemp();
    ctx.emit(`${temp} = sext i32 ${value} to i64`);
    if (ctx.setVariableType) {
      ctx.setVariableType(temp, 'i64');
    }
    return temp;
  }
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = fptosi double ${value} to i64`);
  if (ctx.setVariableType) {
    ctx.setVariableType(temp, 'i64');
  }
  return temp;
}

export function getNumericLlvmType(resolved: ResolvedType | undefined): string {
  if (!resolved || resolved.base !== 'number') {
    return 'double';
  }
  return resolved.qualifiers.numericKind === 'integer' ? 'i32' : 'double';
}

export function tsTypeToLlvm(tsType: string): string {
  if (tsType === 'string') return 'i8*';
  if (tsType === 'number') return 'double';
  if (tsType === 'boolean') return 'double';
  if (tsType === 'void') return 'void';
  if (tsType === 'string[]') return '%StringArray*';
  if (tsType === 'number[]' || tsType === 'boolean[]') return '%Array*';
  if (tsType.startsWith("'") || tsType.startsWith('"')) return 'i8*';
  return 'i8*';
}

export function tsTypeToLlvmJson(tsType: string): string {
  if (tsType === 'string') return 'i8*';
  if (tsType === 'number') return 'double';
  if (tsType === 'boolean') return 'double';
  if (tsType === 'string[]') return '%StringArray*';
  if (tsType === 'number[]') return '%Array*';
  return 'i8*';
}

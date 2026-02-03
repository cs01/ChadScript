export type NumericKind = 'integer' | 'float';

export function stripOptional(name: string): string {
  return name.endsWith('?') ? name.slice(0, -1) : name;
}

export function stripNullable(t: string): string {
  let str = t.trim();
  if (str.indexOf(' | null') !== -1) str = str.replace(' | null', '');
  if (str.indexOf(' | undefined') !== -1) str = str.replace(' | undefined', '');
  if (str.indexOf('null | ') !== -1) str = str.replace('null | ', '');
  if (str.indexOf('undefined | ') !== -1) str = str.replace('undefined | ', '');
  return str.trim();
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

export function createIntegerType(): ResolvedType {
  return createResolvedType('number', { numericKind: 'integer' });
}

export function createFloatType(): ResolvedType {
  return createResolvedType('number', { numericKind: 'float' });
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

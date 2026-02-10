import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseMapTypeString, parseSetTypeString, parseArrayTypeString, stripOptional, stripNullable, parseTypeString, tsTypeToLlvm, tsTypeToLlvmJson, checkUnsafeUnionType } from '../../src/codegen/infrastructure/type-system.js';

describe('stripOptional', () => {
  it('should return empty string for null/undefined/empty input', () => {
    assert.strictEqual(stripOptional(''), '');
    assert.strictEqual(stripOptional(null as unknown as string), '');
    assert.strictEqual(stripOptional(undefined as unknown as string), '');
  });

  it('should strip trailing question mark', () => {
    assert.strictEqual(stripOptional('name?'), 'name');
  });

  it('should return unchanged string without question mark', () => {
    assert.strictEqual(stripOptional('name'), 'name');
  });
});

describe('stripNullable', () => {
  it('should return empty string for null/undefined/empty input', () => {
    assert.strictEqual(stripNullable(''), '');
    assert.strictEqual(stripNullable(null as unknown as string), '');
    assert.strictEqual(stripNullable(undefined as unknown as string), '');
  });

  it('should strip | null suffix', () => {
    assert.strictEqual(stripNullable('string | null'), 'string');
  });

  it('should strip | undefined suffix', () => {
    assert.strictEqual(stripNullable('string | undefined'), 'string');
  });

  it('should strip null | prefix', () => {
    assert.strictEqual(stripNullable('null | string'), 'string');
  });

  it('should return unchanged string without nullable', () => {
    assert.strictEqual(stripNullable('string'), 'string');
  });
});

describe('parseTypeString', () => {
  it('should return unknown for null/undefined/empty input', () => {
    const empty = parseTypeString('');
    assert.strictEqual(empty.base, 'unknown');
    const nullInput = parseTypeString(null as unknown as string);
    assert.strictEqual(nullInput.base, 'unknown');
    const undefinedInput = parseTypeString(undefined as unknown as string);
    assert.strictEqual(undefinedInput.base, 'unknown');
  });

  it('should parse simple type', () => {
    const result = parseTypeString('string');
    assert.strictEqual(result.base, 'string');
    assert.strictEqual(result.arrayDepth, 0);
  });

  it('should parse array type', () => {
    const result = parseTypeString('number[]');
    assert.strictEqual(result.base, 'number');
    assert.strictEqual(result.arrayDepth, 1);
  });

  it('should parse nullable type', () => {
    const result = parseTypeString('string | null');
    assert.strictEqual(result.base, 'string');
    assert.strictEqual(result.qualifiers.isNullable, true);
  });

  it('should parse optional type', () => {
    const result = parseTypeString('string?');
    assert.strictEqual(result.base, 'string');
    assert.strictEqual(result.qualifiers.isOptional, true);
  });
});

describe('tsTypeToLlvm', () => {
  it('should return i8* for null/undefined/empty input', () => {
    assert.strictEqual(tsTypeToLlvm(''), 'i8*');
    assert.strictEqual(tsTypeToLlvm(null as unknown as string), 'i8*');
    assert.strictEqual(tsTypeToLlvm(undefined as unknown as string), 'i8*');
  });

  it('should map string to i8*', () => {
    assert.strictEqual(tsTypeToLlvm('string'), 'i8*');
  });

  it('should map number to double', () => {
    assert.strictEqual(tsTypeToLlvm('number'), 'double');
  });

  it('should map void to void', () => {
    assert.strictEqual(tsTypeToLlvm('void'), 'void');
  });
});

describe('tsTypeToLlvmJson', () => {
  it('should return i8* for null/undefined/empty input', () => {
    assert.strictEqual(tsTypeToLlvmJson(''), 'i8*');
    assert.strictEqual(tsTypeToLlvmJson(null as unknown as string), 'i8*');
    assert.strictEqual(tsTypeToLlvmJson(undefined as unknown as string), 'i8*');
  });

  it('should map string to i8*', () => {
    assert.strictEqual(tsTypeToLlvmJson('string'), 'i8*');
  });

  it('should map number to double', () => {
    assert.strictEqual(tsTypeToLlvmJson('number'), 'double');
  });

  it('should map boolean to double', () => {
    assert.strictEqual(tsTypeToLlvmJson('boolean'), 'double');
  });
});

describe('parseMapTypeString', () => {
  it('should parse simple Map<string, number>', () => {
    const result = parseMapTypeString('Map<string, number>');
    assert.deepStrictEqual(result, { keyType: 'string', valueType: 'number' });
  });

  it('should parse Map<string, string>', () => {
    const result = parseMapTypeString('Map<string, string>');
    assert.deepStrictEqual(result, { keyType: 'string', valueType: 'string' });
  });

  it('should parse Map with interface value type', () => {
    const result = parseMapTypeString('Map<string, UserInterface>');
    assert.deepStrictEqual(result, { keyType: 'string', valueType: 'UserInterface' });
  });

  it('should parse nested Map types', () => {
    const result = parseMapTypeString('Map<string, Map<string, number>>');
    assert.deepStrictEqual(result, { keyType: 'string', valueType: 'Map<string, number>' });
  });

  it('should handle whitespace around input', () => {
    const result = parseMapTypeString('  Map<string, number>  ');
    assert.deepStrictEqual(result, { keyType: 'string', valueType: 'number' });
  });

  it('should handle whitespace around types', () => {
    const result = parseMapTypeString('Map< string , number >');
    assert.deepStrictEqual(result, { keyType: 'string', valueType: 'number' });
  });

  it('should return null for empty string', () => {
    assert.strictEqual(parseMapTypeString(''), null);
  });

  it('should return null for null/undefined input', () => {
    assert.strictEqual(parseMapTypeString(null as unknown as string), null);
    assert.strictEqual(parseMapTypeString(undefined as unknown as string), null);
  });

  it('should return null for non-Map type', () => {
    assert.strictEqual(parseMapTypeString('Set<string>'), null);
    assert.strictEqual(parseMapTypeString('string'), null);
    assert.strictEqual(parseMapTypeString('number[]'), null);
  });

  it('should return null for Map with no closing bracket', () => {
    assert.strictEqual(parseMapTypeString('Map<string, number'), null);
  });

  it('should return null for Map with no comma', () => {
    assert.strictEqual(parseMapTypeString('Map<string>'), null);
  });

  it('should return null for Map with empty key type', () => {
    assert.strictEqual(parseMapTypeString('Map<, number>'), null);
  });

  it('should return null for Map with empty value type', () => {
    assert.strictEqual(parseMapTypeString('Map<string, >'), null);
  });
});

describe('parseSetTypeString', () => {
  it('should parse Set<string>', () => {
    const result = parseSetTypeString('Set<string>');
    assert.deepStrictEqual(result, { valueType: 'string' });
  });

  it('should parse Set<number>', () => {
    const result = parseSetTypeString('Set<number>');
    assert.deepStrictEqual(result, { valueType: 'number' });
  });

  it('should parse Set with interface type', () => {
    const result = parseSetTypeString('Set<UserInterface>');
    assert.deepStrictEqual(result, { valueType: 'UserInterface' });
  });

  it('should handle whitespace around input', () => {
    const result = parseSetTypeString('  Set<string>  ');
    assert.deepStrictEqual(result, { valueType: 'string' });
  });

  it('should handle whitespace around the type parameter', () => {
    const result = parseSetTypeString('Set< string >');
    assert.deepStrictEqual(result, { valueType: 'string' });
  });

  it('should return null for empty string', () => {
    assert.strictEqual(parseSetTypeString(''), null);
  });

  it('should return null for null/undefined input', () => {
    assert.strictEqual(parseSetTypeString(null as unknown as string), null);
    assert.strictEqual(parseSetTypeString(undefined as unknown as string), null);
  });

  it('should return null for non-Set type', () => {
    assert.strictEqual(parseSetTypeString('Map<string, number>'), null);
    assert.strictEqual(parseSetTypeString('string'), null);
    assert.strictEqual(parseSetTypeString('number[]'), null);
  });

  it('should return null for Set with no closing bracket', () => {
    assert.strictEqual(parseSetTypeString('Set<string'), null);
  });

  it('should return null for Set with empty type parameter', () => {
    assert.strictEqual(parseSetTypeString('Set<>'), null);
  });
});

describe('parseArrayTypeString', () => {
  it('should parse string[]', () => {
    const result = parseArrayTypeString('string[]');
    assert.deepStrictEqual(result, { elementType: 'string' });
  });

  it('should parse number[]', () => {
    const result = parseArrayTypeString('number[]');
    assert.deepStrictEqual(result, { elementType: 'number' });
  });

  it('should parse interface array type', () => {
    const result = parseArrayTypeString('UserInterface[]');
    assert.deepStrictEqual(result, { elementType: 'UserInterface' });
  });

  it('should parse boolean[]', () => {
    const result = parseArrayTypeString('boolean[]');
    assert.deepStrictEqual(result, { elementType: 'boolean' });
  });

  it('should handle whitespace around input', () => {
    const result = parseArrayTypeString('  string[]  ');
    assert.deepStrictEqual(result, { elementType: 'string' });
  });

  it('should return null for empty string', () => {
    assert.strictEqual(parseArrayTypeString(''), null);
  });

  it('should return null for null/undefined input', () => {
    assert.strictEqual(parseArrayTypeString(null as unknown as string), null);
    assert.strictEqual(parseArrayTypeString(undefined as unknown as string), null);
  });

  it('should return null for non-array type', () => {
    assert.strictEqual(parseArrayTypeString('string'), null);
    assert.strictEqual(parseArrayTypeString('Map<string, number>'), null);
    assert.strictEqual(parseArrayTypeString('Set<string>'), null);
  });

  it('should return null for bare brackets', () => {
    assert.strictEqual(parseArrayTypeString('[]'), null);
  });
});

describe('checkUnsafeUnionType', () => {
  it('should return null for non-union types', () => {
    assert.strictEqual(checkUnsafeUnionType('string'), null);
    assert.strictEqual(checkUnsafeUnionType('number'), null);
    assert.strictEqual(checkUnsafeUnionType('boolean'), null);
    assert.strictEqual(checkUnsafeUnionType('void'), null);
    assert.strictEqual(checkUnsafeUnionType('string[]'), null);
  });

  it('should return null for null/undefined/empty input', () => {
    assert.strictEqual(checkUnsafeUnionType(''), null);
    assert.strictEqual(checkUnsafeUnionType(null as unknown as string), null);
    assert.strictEqual(checkUnsafeUnionType(undefined as unknown as string), null);
  });

  it('should return null for nullable unions (same LLVM type)', () => {
    assert.strictEqual(checkUnsafeUnionType('string | null'), null);
    assert.strictEqual(checkUnsafeUnionType('number | undefined'), null);
    assert.strictEqual(checkUnsafeUnionType('string | null | undefined'), null);
    assert.strictEqual(checkUnsafeUnionType('null | string'), null);
  });

  it('should return null for unions with same LLVM representation', () => {
    assert.strictEqual(checkUnsafeUnionType('string | SomeInterface'), null);
  });

  it('should return error for string | number (i8* vs double)', () => {
    const result = checkUnsafeUnionType('string | number');
    assert.notStrictEqual(result, null);
    assert.ok(result!.indexOf('string | number') !== -1);
    assert.ok(result!.indexOf('i8*') !== -1);
    assert.ok(result!.indexOf('double') !== -1);
  });

  it('should return error for number | boolean | string', () => {
    const result = checkUnsafeUnionType('number | boolean | string');
    assert.notStrictEqual(result, null);
    assert.ok(result!.indexOf('i8*') !== -1);
  });

  it('should return error for string[] | number[] (different array types)', () => {
    const result = checkUnsafeUnionType('string[] | number[]');
    assert.notStrictEqual(result, null);
    assert.ok(result!.indexOf('%StringArray*') !== -1);
    assert.ok(result!.indexOf('%Array*') !== -1);
  });

  it('should ignore unions nested inside object literal types', () => {
    assert.strictEqual(checkUnsafeUnionType("{ name: string; fieldType: 'double' | 'string' | 'number[]' }[]"), null);
  });

  it('should ignore unions nested inside generic types', () => {
    assert.strictEqual(checkUnsafeUnionType('Map<string, number | string>'), null);
  });
});

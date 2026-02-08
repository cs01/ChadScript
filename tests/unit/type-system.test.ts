import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseMapTypeString, parseSetTypeString, parseArrayTypeString } from '../../src/codegen/infrastructure/type-system.js';

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

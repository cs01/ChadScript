import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TypeContext } from '../../src/codegen/infrastructure/type-context.js';

describe('TypeContext', () => {
  it('should provide singleton primitive types', () => {
    const ctx = new TypeContext();
    assert.strictEqual(ctx.numberType.base, 'number');
    assert.strictEqual(ctx.numberType.cachedLlvmType, 'double');
    assert.strictEqual(ctx.stringType.base, 'string');
    assert.strictEqual(ctx.stringType.cachedLlvmType, 'i8*');
    assert.strictEqual(ctx.booleanType.base, 'boolean');
    assert.strictEqual(ctx.booleanType.cachedLlvmType, 'double');
    assert.strictEqual(ctx.voidType.base, 'void');
    assert.strictEqual(ctx.voidType.cachedLlvmType, 'void');
    assert.strictEqual(ctx.nullType.base, 'null');
    assert.strictEqual(ctx.nullType.cachedLlvmType, 'i8*');
  });

  it('should assign unique IDs to types', () => {
    const ctx = new TypeContext();
    assert.ok(ctx.numberType.id !== undefined);
    assert.ok(ctx.stringType.id !== undefined);
    assert.notStrictEqual(ctx.numberType.id, ctx.stringType.id);
  });

  it('should intern primitive types (same reference)', () => {
    const ctx = new TypeContext();
    const num1 = ctx.resolve('number');
    const num2 = ctx.resolve('number');
    assert.strictEqual(num1, num2);
    assert.strictEqual(num1, ctx.numberType);
  });

  it('should intern array types', () => {
    const ctx = new TypeContext();
    const arr1 = ctx.getArrayType('string');
    const arr2 = ctx.getArrayType('string');
    assert.strictEqual(arr1, arr2);
    assert.strictEqual(arr1.base, 'string');
    assert.strictEqual(arr1.arrayDepth, 1);
    assert.strictEqual(arr1.cachedLlvmType, '%StringArray*');
  });

  it('should create correct array types for different element types', () => {
    const ctx = new TypeContext();
    const strArr = ctx.getArrayType('string');
    const numArr = ctx.getArrayType('number');
    const objArr = ctx.getArrayType('MyInterface');

    assert.strictEqual(strArr.cachedLlvmType, '%StringArray*');
    assert.strictEqual(numArr.cachedLlvmType, '%Array*');
    assert.strictEqual(objArr.cachedLlvmType, '%ObjectArray*');
  });

  it('should intern map types', () => {
    const ctx = new TypeContext();
    const map1 = ctx.getMapType('string', 'number');
    const map2 = ctx.getMapType('string', 'number');
    assert.strictEqual(map1, map2);
    assert.strictEqual(map1.cachedLlvmType, '%StringMap*');
  });

  it('should intern set types', () => {
    const ctx = new TypeContext();
    const set1 = ctx.getSetType('string');
    const set2 = ctx.getSetType('string');
    assert.strictEqual(set1, set2);
    assert.strictEqual(set1.cachedLlvmType, '%StringSet*');
  });

  it('should intern interface types', () => {
    const ctx = new TypeContext();
    const iface1 = ctx.getInterfaceType('MyInterface');
    const iface2 = ctx.getInterfaceType('MyInterface');
    assert.strictEqual(iface1, iface2);
    assert.strictEqual(iface1.cachedLlvmType, '%MyInterface*');
  });

  it('should intern class types', () => {
    const ctx = new TypeContext();
    const cls1 = ctx.getClassType('MyClass');
    const cls2 = ctx.getClassType('MyClass');
    assert.strictEqual(cls1, cls2);
    assert.strictEqual(cls1.cachedLlvmType, 'i32*');
  });

  it('should resolve type strings', () => {
    const ctx = new TypeContext();
    assert.strictEqual(ctx.resolve('string'), ctx.stringType);
    assert.strictEqual(ctx.resolve('number'), ctx.numberType);
    assert.strictEqual(ctx.resolve('boolean'), ctx.booleanType);
    assert.strictEqual(ctx.resolve('void'), ctx.voidType);
    assert.strictEqual(ctx.resolve('null'), ctx.nullType);
    assert.strictEqual(ctx.resolve('undefined'), ctx.nullType);
    assert.strictEqual(ctx.resolve('string[]'), ctx.getArrayType('string'));
    assert.strictEqual(ctx.resolve('number[]'), ctx.getArrayType('number'));
  });

  it('should create nullable types', () => {
    const ctx = new TypeContext();
    const nullable = ctx.getNullableType(ctx.stringType);
    assert.strictEqual(nullable.base, 'string');
    assert.strictEqual(nullable.qualifiers.isNullable, true);
    assert.strictEqual(nullable.cachedLlvmType, 'i8*');
  });

  it('should differentiate types by ID for fast comparison', () => {
    const ctx = new TypeContext();
    const str = ctx.stringType;
    const num = ctx.numberType;
    assert.notStrictEqual(str.id, num.id);

    const str2 = ctx.resolve('string');
    assert.strictEqual(str.id, str2.id);
  });

  it('should handle unknown/empty type strings', () => {
    const ctx = new TypeContext();
    const unknown = ctx.resolve('');
    assert.strictEqual(unknown, ctx.unknownType);
    assert.strictEqual(unknown.base, 'unknown');
  });

  it('should find types by ID', () => {
    const ctx = new TypeContext();
    const numId = ctx.numberType.id!;
    const found = ctx.getById(numId);
    assert.strictEqual(found, ctx.numberType);
  });
});

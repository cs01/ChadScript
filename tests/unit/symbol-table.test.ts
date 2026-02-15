import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SymbolTable, SymbolKind } from '../../src/codegen/infrastructure/symbol-table.js';

describe('SymbolTable', () => {
  describe('define and lookup', () => {
    it('should define and lookup a number variable', () => {
      const table = new SymbolTable();
      table.define('x', SymbolKind.Number, 'double', '%1', 'local');

      const symbol = table.lookup('x');
      assert.strictEqual(symbol?.name, 'x');
      assert.strictEqual(symbol?.kind, SymbolKind.Number);
      assert.strictEqual(symbol?.llvmType, 'double');
      assert.strictEqual(symbol?.allocaRegister, '%1');
      assert.strictEqual(symbol?.scope, 'local');
    });

    it('should define and lookup a string variable', () => {
      const table = new SymbolTable();
      table.define('name', SymbolKind.String, 'i8*', '%2', 'local');

      const symbol = table.lookup('name');
      assert.strictEqual(symbol?.name, 'name');
      assert.strictEqual(symbol?.kind, SymbolKind.String);
      assert.strictEqual(symbol?.llvmType, 'i8*');
    });

    it('should define a global variable', () => {
      const table = new SymbolTable();
      table.define('globalVar', SymbolKind.Number, 'double', '@global', 'global');

      const symbol = table.lookup('globalVar');
      assert.strictEqual(symbol?.scope, 'global');
    });

    it('should return undefined for non-existent variable', () => {
      const table = new SymbolTable();
      const symbol = table.lookup('nonexistent');
      assert.strictEqual(symbol, undefined);
    });
  });

  describe('has', () => {
    it('should return true for existing variable', () => {
      const table = new SymbolTable();
      table.define('x', SymbolKind.Number, 'double', '%1', 'local');
      assert.strictEqual(table.has('x'), true);
    });

    it('should return false for non-existent variable', () => {
      const table = new SymbolTable();
      assert.strictEqual(table.has('nonexistent'), false);
    });
  });

  describe('getType and getAlloca', () => {
    it('should get LLVM type', () => {
      const table = new SymbolTable();
      table.define('x', SymbolKind.Number, 'double', '%1', 'local');
      assert.strictEqual(table.getType('x'), 'double');
    });

    it('should get alloca register', () => {
      const table = new SymbolTable();
      table.define('x', SymbolKind.Number, 'double', '%1', 'local');
      assert.strictEqual(table.getAlloca('x'), '%1');
    });

    it('should return undefined for non-existent variable', () => {
      const table = new SymbolTable();
      assert.strictEqual(table.getType('nonexistent'), undefined);
      assert.strictEqual(table.getAlloca('nonexistent'), undefined);
    });
  });

  describe('getKind', () => {
    it('should get symbol kind', () => {
      const table = new SymbolTable();
      table.define('x', SymbolKind.Number, 'double', '%1', 'local');
      assert.strictEqual(table.getKind('x'), SymbolKind.Number);
    });

    it('should return undefined for non-existent variable', () => {
      const table = new SymbolTable();
      assert.strictEqual(table.getKind('nonexistent'), undefined);
    });
  });

  describe('updateAlloca', () => {
    it('should update alloca register', () => {
      const table = new SymbolTable();
      table.define('x', SymbolKind.Number, 'double', '%1', 'local');
      table.updateAlloca('x', '%100');
      assert.strictEqual(table.getAlloca('x'), '%100');
    });

    it('should do nothing for non-existent variable', () => {
      const table = new SymbolTable();
      // Should not throw
      table.updateAlloca('nonexistent', '%100');
    });
  });

  describe('clear', () => {
    it('should clear all symbols', () => {
      const table = new SymbolTable();
      table.define('x', SymbolKind.Number, 'double', '%1', 'local');
      table.define('y', SymbolKind.String, 'i8*', '%2', 'local');
      table.define('z', SymbolKind.Number, 'double', '@global', 'global');

      table.clear();

      assert.strictEqual(table.has('x'), false);
      assert.strictEqual(table.has('y'), false);
      assert.strictEqual(table.has('z'), false);
      assert.strictEqual(table.getAll().length, 0);
    });
  });

  describe('clearLocals', () => {
    it('should clear only local symbols', () => {
      const table = new SymbolTable();
      table.define('localVar', SymbolKind.Number, 'double', '%1', 'local');
      table.define('globalVar', SymbolKind.Number, 'double', '@global', 'global');

      table.clearLocals();

      assert.strictEqual(table.has('localVar'), false);
      assert.strictEqual(table.has('globalVar'), true);
    });

    it('should preserve all globals', () => {
      const table = new SymbolTable();
      table.define('global1', SymbolKind.Number, 'double', '@g1', 'global');
      table.define('global2', SymbolKind.String, 'i8*', '@g2', 'global');
      table.define('local1', SymbolKind.Number, 'double', '%1', 'local');

      table.clearLocals();

      assert.strictEqual(table.has('global1'), true);
      assert.strictEqual(table.has('global2'), true);
      assert.strictEqual(table.has('local1'), false);
    });
  });

  describe('remove', () => {
    it('should remove a symbol', () => {
      const table = new SymbolTable();
      table.define('x', SymbolKind.Number, 'double', '%1', 'local');
      table.remove('x');
      assert.strictEqual(table.has('x'), false);
    });
  });

  describe('type predicates', () => {
    it('should identify number variables', () => {
      const table = new SymbolTable();
      table.define('x', SymbolKind.Number, 'double', '%1', 'local');
      assert.strictEqual(table.isNumber('x'), true);
      assert.strictEqual(table.isString('x'), false);
    });

    it('should identify string variables', () => {
      const table = new SymbolTable();
      table.define('name', SymbolKind.String, 'i8*', '%1', 'local');
      assert.strictEqual(table.isString('name'), true);
      assert.strictEqual(table.isNumber('name'), false);
    });

    it('should identify boolean variables', () => {
      const table = new SymbolTable();
      table.define('flag', SymbolKind.Boolean, 'i1', '%1', 'local');
      assert.strictEqual(table.isBoolean('flag'), true);
    });

    it('should identify array variables', () => {
      const table = new SymbolTable();
      table.define('arr', SymbolKind.Array, '%Array*', '%1', 'local');
      table.define('strArr', SymbolKind.StringArray, '%StringArray*', '%2', 'local');
      table.define('boolArr', SymbolKind.BooleanArray, '%BooleanArray*', '%3', 'local');

      assert.strictEqual(table.isArray('arr'), true);
      assert.strictEqual(table.isArray('strArr'), true);
      assert.strictEqual(table.isArray('boolArr'), true);
      assert.strictEqual(table.isNumberArray('arr'), true);
      assert.strictEqual(table.isStringArray('strArr'), true);
      assert.strictEqual(table.isBooleanArray('boolArr'), true);
    });

    it('should identify object variables', () => {
      const table = new SymbolTable();
      table.define('obj', SymbolKind.Object, '%Object*', '%1', 'local');
      assert.strictEqual(table.isObject('obj'), true);
    });

    it('should identify map variables', () => {
      const table = new SymbolTable();
      table.define('map', SymbolKind.Map, '%Map*', '%1', 'local');
      assert.strictEqual(table.isMap('map'), true);
    });

    it('should identify set variables', () => {
      const table = new SymbolTable();
      table.define('set', SymbolKind.Set, '%Set*', '%1', 'local');
      assert.strictEqual(table.isSet('set'), true);
    });

    it('should identify class variables', () => {
      const table = new SymbolTable();
      table.define('instance', SymbolKind.Class, 'i32*', '%1', 'local');
      assert.strictEqual(table.isClass('instance'), true);
    });

    it('should identify regex variables', () => {
      const table = new SymbolTable();
      table.define('pattern', SymbolKind.Regex, 'i8*', '%1', 'local');
      assert.strictEqual(table.isRegex('pattern'), true);
    });

    it('should identify JSON variables', () => {
      const table = new SymbolTable();
      table.define('json', SymbolKind.JSON, 'i8*', '%1', 'local');
      assert.strictEqual(table.isJSON('json'), true);
    });

    it('should identify process.argv variables', () => {
      const table = new SymbolTable();
      table.define('argv', SymbolKind.ProcessArgv, 'i8**', '%1', 'local');
      assert.strictEqual(table.isProcessArgv('argv'), true);
    });
  });

  describe('metadata handling', () => {
    it('should store and retrieve object metadata', () => {
      const table = new SymbolTable();
      table.defineWithMetadata('user', SymbolKind.Object, '%User*', '%1', 'local', {
        objectMetadata: {
          keys: ['name', 'age'],
          types: ['i8*', 'double']
        }
      });

      const metadata = table.getObjectMetadata('user');
      assert.deepStrictEqual(metadata, {
        keys: ['name', 'age'],
        types: ['i8*', 'double']
      });
    });

    it('should store and retrieve class metadata', () => {
      const table = new SymbolTable();
      table.defineWithMetadata('instance', SymbolKind.Class, 'i32*', '%1', 'local', {
        classMetadata: {
          className: 'Person',
          fields: ['name', 'age']
        }
      });

      const metadata = table.getClassMetadata('instance');
      assert.strictEqual(metadata?.className, 'Person');
      assert.deepStrictEqual(metadata?.fields, ['name', 'age']);
    });

    it('should store and retrieve array metadata', () => {
      const table = new SymbolTable();
      table.defineWithMetadata('arr', SymbolKind.StringArray, '%StringArray*', '%1', 'local', {
        arrayMetadata: {
          elementType: 'string'
        }
      });

      const metadata = table.getArrayMetadata('arr');
      assert.strictEqual(metadata?.elementType, 'string');
    });
  });

  describe('getAll and filtering', () => {
    it('should get all symbols', () => {
      const table = new SymbolTable();
      table.define('x', SymbolKind.Number, 'double', '%1', 'local');
      table.define('name', SymbolKind.String, 'i8*', '%2', 'local');

      const all = table.getAll();
      assert.strictEqual(all.length, 2);
    });

    it('should get symbols by kind', () => {
      const table = new SymbolTable();
      table.define('x', SymbolKind.Number, 'double', '%1', 'local');
      table.define('y', SymbolKind.Number, 'double', '%2', 'local');
      table.define('name', SymbolKind.String, 'i8*', '%3', 'local');

      const numbers = table.getByKind(SymbolKind.Number);
      assert.strictEqual(numbers.length, 2);

      const strings = table.getByKind(SymbolKind.String);
      assert.strictEqual(strings.length, 1);
    });

    it('should get local and global symbols separately', () => {
      const table = new SymbolTable();
      table.define('local1', SymbolKind.Number, 'double', '%1', 'local');
      table.define('local2', SymbolKind.Number, 'double', '%2', 'local');
      table.define('global1', SymbolKind.Number, 'double', '@g1', 'global');

      const locals = table.getLocals();
      const globals = table.getGlobals();

      assert.strictEqual(locals.length, 2);
      assert.strictEqual(globals.length, 1);
    });
  });

  describe('backward compatibility methods', () => {
    it('should get string alloca (legacy stringVariables.get())', () => {
      const table = new SymbolTable();
      table.define('name', SymbolKind.String, 'i8*', '%str_ptr', 'local');
      assert.strictEqual(table.getStringAlloca('name'), '%str_ptr');
    });

    it('should get array alloca (legacy arrayVariables.get())', () => {
      const table = new SymbolTable();
      table.define('arr', SymbolKind.Array, '%Array*', '%arr_ptr', 'local');
      assert.strictEqual(table.getArrayAlloca('arr'), '%arr_ptr');
    });

    it('should get object info (legacy objectVariables.get())', () => {
      const table = new SymbolTable();
      table.defineWithMetadata('user', SymbolKind.Object, '%User*', '%obj_ptr', 'local', {
        objectMetadata: {
          keys: ['name', 'age'],
          types: ['i8*', 'double']
        }
      });

      const info = table.getObjectInfo('user');
      assert.strictEqual(info?.ptr, '%obj_ptr');
      assert.deepStrictEqual(info?.keys, ['name', 'age']);
      assert.deepStrictEqual(info?.types, ['i8*', 'double']);
    });

    it('should get class info (legacy classInstanceVariables.get())', () => {
      const table = new SymbolTable();
      table.defineWithMetadata('instance', SymbolKind.Class, 'i32*', '%class_ptr', 'local', {
        classMetadata: {
          className: 'Person'
        }
      });

      const info = table.getClassInfo('instance');
      assert.strictEqual(info?.ptr, '%class_ptr');
      assert.strictEqual(info?.className, 'Person');
    });
  });

  describe('clone and merge', () => {
    it('should clone symbol table', () => {
      const table = new SymbolTable();
      table.define('x', SymbolKind.Number, 'double', '%1', 'local');
      table.define('y', SymbolKind.String, 'i8*', '%2', 'local');

      const cloned = table.clone();
      assert.strictEqual(cloned.has('x'), true);
      assert.strictEqual(cloned.has('y'), true);

      // Verify it's a separate instance
      cloned.remove('x');
      assert.strictEqual(cloned.has('x'), false);
      assert.strictEqual(table.has('x'), true); // Original unchanged
    });

    it('should merge symbol tables', () => {
      const table1 = new SymbolTable();
      table1.define('x', SymbolKind.Number, 'double', '%1', 'local');

      const table2 = new SymbolTable();
      table2.define('y', SymbolKind.String, 'i8*', '%2', 'local');

      table1.merge(table2);

      assert.strictEqual(table1.has('x'), true);
      assert.strictEqual(table1.has('y'), true);
      assert.strictEqual(table1.getAll().length, 2);
    });
  });

  describe('dump', () => {
    it('should dump symbol table for debugging', () => {
      const table = new SymbolTable();
      table.define('x', SymbolKind.Number, 'double', '%1', 'local');
      table.define('name', SymbolKind.String, 'i8*', '%2', 'local');

      const output = table.dump();
      assert.match(output, /=== Symbol Table ===/);
      assert.match(output, /x: 0 \(double\) -> %1 \[local\]/);
      assert.match(output, /name: 1 \(i8\*\) -> %2 \[local\]/);
    });

    it('should dump object metadata', () => {
      const table = new SymbolTable();
      table.defineWithMetadata('user', SymbolKind.Object, '%User*', '%1', 'local', {
        objectMetadata: {
          keys: ['name', 'age'],
          types: ['i8*', 'double']
        }
      });

      const output = table.dump();
      assert.match(output, /Object: keys=name, age/);
    });

    it('should dump class metadata', () => {
      const table = new SymbolTable();
      table.defineWithMetadata('instance', SymbolKind.Class, 'i32*', '%1', 'local', {
        classMetadata: {
          className: 'Person'
        }
      });

      const output = table.dump();
      assert.match(output, /Class: Person/);
    });
  });

  describe('hierarchical scopes', () => {
    it('should push and pop scopes', () => {
      const table = new SymbolTable();
      table.define('x', SymbolKind.Number, 'double', '%1', 'local');

      table.pushScope('block');
      table.define('y', SymbolKind.Number, 'double', '%2', 'local');

      assert.strictEqual(table.has('x'), true);
      assert.strictEqual(table.has('y'), true);

      table.popScope();

      assert.strictEqual(table.has('x'), true);
      assert.strictEqual(table.has('y'), false);
    });

    it('should support nested scopes', () => {
      const table = new SymbolTable();
      table.define('a', SymbolKind.Number, 'double', '%1', 'local');

      table.pushScope('block');
      table.define('b', SymbolKind.Number, 'double', '%2', 'local');

      table.pushScope('block');
      table.define('c', SymbolKind.Number, 'double', '%3', 'local');

      assert.strictEqual(table.has('a'), true);
      assert.strictEqual(table.has('b'), true);
      assert.strictEqual(table.has('c'), true);

      table.popScope();
      assert.strictEqual(table.has('a'), true);
      assert.strictEqual(table.has('b'), true);
      assert.strictEqual(table.has('c'), false);

      table.popScope();
      assert.strictEqual(table.has('a'), true);
      assert.strictEqual(table.has('b'), false);
      assert.strictEqual(table.has('c'), false);
    });

    it('should not pop below global scope', () => {
      const table = new SymbolTable();
      table.define('x', SymbolKind.Number, 'double', '%1', 'global');
      table.popScope();
      assert.strictEqual(table.has('x'), true);
    });

    it('should preserve globals when popping scopes', () => {
      const table = new SymbolTable();
      table.define('g', SymbolKind.Number, 'double', '@g', 'global');

      table.pushScope('block');
      table.define('x', SymbolKind.Number, 'double', '%1', 'local');
      table.popScope();

      assert.strictEqual(table.has('g'), true);
      assert.strictEqual(table.has('x'), false);
    });

    it('lookupLocal should only find symbols in current scope', () => {
      const table = new SymbolTable();
      table.define('outer', SymbolKind.Number, 'double', '%1', 'local');

      table.pushScope('block');
      table.define('inner', SymbolKind.Number, 'double', '%2', 'local');

      assert.ok(table.lookupLocal('inner'));
      assert.strictEqual(table.lookupLocal('outer'), undefined);
      assert.ok(table.lookup('outer'));
    });

    it('should support closure capture across scopes', () => {
      const table = new SymbolTable();
      table.define('x', SymbolKind.Number, 'double', '%1', 'local');

      table.pushScope('block');
      table.define('y', SymbolKind.String, 'i8*', '%2', 'local');

      const scopeVars = table.getScopeVarsForClosure();
      assert.strictEqual(scopeVars.get('x'), 'double');
      assert.strictEqual(scopeVars.get('y'), 'i8*');
    });
  });
});

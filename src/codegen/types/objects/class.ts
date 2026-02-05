import { Expression, ClassNode, ClassMethod, ClassField, VariableNode, InterfaceDeclaration, CommonField } from '../../../ast/types.js';
import { IGeneratorContext } from '../../infrastructure/generator-context.js';
import { SymbolKind } from '../../infrastructure/symbol-table.js';
import { stripOptional, tsTypeToLlvm as tsTypeToLlvmUtil } from '../../infrastructure/type-system.js';

// ============================================
// CLASS GENERATOR - Class and instance operations
// ============================================

export class ClassGenerator {
  // Track class structures: className -> ALL fields (including inherited)
  private classFields: Map<string, { name: string; fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean'; tsType?: string }[]> = new Map();

  constructor(private ctx: IGeneratorContext) {}

  private findClassNode(className: string): ClassNode | null {
    if (!this.ctx.ast || !this.ctx.ast.classes) return null;
    for (let ci = 0; ci < this.ctx.ast.classes.length; ci++) {
      const c = this.ctx.ast.classes[ci] as ClassNode;
      if (c.name === className) {
        return c;
      }
    }
    return null;
  }

  private getAllFieldsIncludingInherited(classNode: ClassNode): ClassField[] {
    const allFields: ClassField[] = [];
    if (classNode.extends) {
      const parentClass = this.findClassNode(classNode.extends);
      if (parentClass) {
        const parentFields = this.getAllFieldsIncludingInherited(parentClass);
        for (let i = 0; i < parentFields.length; i++) {
          allFields.push(parentFields[i]);
        }
      }
    }
    for (let i = 0; i < classNode.fields.length; i++) {
      allFields.push(classNode.fields[i]);
    }
    return allFields;
  }

  private fieldToLlvmType(f: ClassField): string {
    if (f.fieldType === 'string') {
      return 'i8*';
    } else if (f.fieldType === 'string[]') {
      return '%StringArray*';
    } else if (f.fieldType.endsWith('[]')) {
      return '%Array*';
    } else if (f.fieldType === 'boolean') {
      return 'i1';
    } else if (f.tsType) {
      if (f.tsType.startsWith('Map<string,')) {
        return '%StringMap*';
      } else if (f.tsType.startsWith('Map<')) {
        return '%Map*';
      } else if (f.tsType === 'Set<string>') {
        return '%StringSet*';
      } else if (f.tsType.startsWith('Set<')) {
        return '%Set*';
      } else if (f.tsType === 'number' || f.tsType === 'boolean') {
        return 'double';
      } else if (f.tsType === 'number[]' || f.tsType === 'boolean[]') {
        return '%Array*';
      } else if (f.tsType.endsWith('[]')) {
        return '%ObjectArray*';
      } else {
        const classNode = this.findClassNode(f.tsType);
        if (classNode) {
          return `%${f.tsType}_struct*`;
        }
        if (this.ctx.interfaceStructGen && this.ctx.interfaceStructGen.hasInterface(f.tsType)) {
          return `%${f.tsType}*`;
        }
        return 'i8*';
      }
    }
    return 'double';
  }

  private emitFieldInit(fieldPtr: string, llvmType: string): void {
    if (llvmType === 'i1') {
      this.emit(`store i1 false, i1* ${fieldPtr}`);
    } else if (llvmType === 'double') {
      this.emit(`store double 0.0, double* ${fieldPtr}`);
    } else if (llvmType === '%Array*') {
      const sizePtr = this.nextTemp();
      this.emit(`${sizePtr} = getelementptr %Array, %Array* null, i32 1`);
      const structSize = this.nextTemp();
      this.emit(`${structSize} = ptrtoint %Array* ${sizePtr} to i64`);
      const arrayMem = this.nextTemp();
      this.emit(`${arrayMem} = call i8* @GC_malloc(i64 ${structSize})`);
      const arrayPtr = this.nextTemp();
      this.emit(`${arrayPtr} = bitcast i8* ${arrayMem} to %Array*`);
      const dataPtr = this.nextTemp();
      this.emit(`${dataPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
      this.emit(`store double* null, double** ${dataPtr}`);
      const lenPtr = this.nextTemp();
      this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
      this.emit(`store i32 0, i32* ${lenPtr}`);
      const capPtr = this.nextTemp();
      this.emit(`${capPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
      this.emit(`store i32 0, i32* ${capPtr}`);
      this.emit(`store %Array* ${arrayPtr}, %Array** ${fieldPtr}`);
    } else if (llvmType === '%StringArray*') {
      const sizePtr = this.nextTemp();
      this.emit(`${sizePtr} = getelementptr %StringArray, %StringArray* null, i32 1`);
      const structSize = this.nextTemp();
      this.emit(`${structSize} = ptrtoint %StringArray* ${sizePtr} to i64`);
      const arrayMem = this.nextTemp();
      this.emit(`${arrayMem} = call i8* @GC_malloc(i64 ${structSize})`);
      const arrayPtr = this.nextTemp();
      this.emit(`${arrayPtr} = bitcast i8* ${arrayMem} to %StringArray*`);
      const dataPtr = this.nextTemp();
      this.emit(`${dataPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
      this.emit(`store i8** null, i8*** ${dataPtr}`);
      const lenPtr = this.nextTemp();
      this.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
      this.emit(`store i32 0, i32* ${lenPtr}`);
      const capPtr = this.nextTemp();
      this.emit(`${capPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`);
      this.emit(`store i32 0, i32* ${capPtr}`);
      this.emit(`store %StringArray* ${arrayPtr}, %StringArray** ${fieldPtr}`);
    } else if (llvmType === '%ObjectArray*') {
      const sizePtr = this.nextTemp();
      this.emit(`${sizePtr} = getelementptr %ObjectArray, %ObjectArray* null, i32 1`);
      const structSize = this.nextTemp();
      this.emit(`${structSize} = ptrtoint %ObjectArray* ${sizePtr} to i64`);
      const arrayMem = this.nextTemp();
      this.emit(`${arrayMem} = call i8* @GC_malloc(i64 ${structSize})`);
      const arrayPtr = this.nextTemp();
      this.emit(`${arrayPtr} = bitcast i8* ${arrayMem} to %ObjectArray*`);
      const dataPtr = this.nextTemp();
      this.emit(`${dataPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`);
      this.emit(`store i8* null, i8** ${dataPtr}`);
      const lenPtr = this.nextTemp();
      this.emit(`${lenPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 1`);
      this.emit(`store i32 0, i32* ${lenPtr}`);
      const capPtr = this.nextTemp();
      this.emit(`${capPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 2`);
      this.emit(`store i32 0, i32* ${capPtr}`);
      this.emit(`store %ObjectArray* ${arrayPtr}, %ObjectArray** ${fieldPtr}`);
    } else if (llvmType === '%StringMap*') {
      const sizePtr = this.nextTemp();
      this.emit(`${sizePtr} = getelementptr %StringMap, %StringMap* null, i32 1`);
      const structSize = this.nextTemp();
      this.emit(`${structSize} = ptrtoint %StringMap* ${sizePtr} to i64`);
      const mapMem = this.nextTemp();
      this.emit(`${mapMem} = call i8* @GC_malloc(i64 ${structSize})`);
      const mapPtr = this.nextTemp();
      this.emit(`${mapPtr} = bitcast i8* ${mapMem} to %StringMap*`);
      const keysDataMem = this.nextTemp();
      this.emit(`${keysDataMem} = call i8* @GC_malloc(i64 16)`);
      const keysData = this.nextTemp();
      this.emit(`${keysData} = bitcast i8* ${keysDataMem} to i8**`);
      const valuesDataMem = this.nextTemp();
      this.emit(`${valuesDataMem} = call i8* @GC_malloc(i64 16)`);
      const valuesData = this.nextTemp();
      this.emit(`${valuesData} = bitcast i8* ${valuesDataMem} to i8**`);
      const keysPtr = this.nextTemp();
      this.emit(`${keysPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`);
      this.emit(`store i8** ${keysData}, i8*** ${keysPtr}`);
      const valuesPtr = this.nextTemp();
      this.emit(`${valuesPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`);
      this.emit(`store i8** ${valuesData}, i8*** ${valuesPtr}`);
      const lenPtr = this.nextTemp();
      this.emit(`${lenPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`);
      this.emit(`store i32 0, i32* ${lenPtr}`);
      const capPtr = this.nextTemp();
      this.emit(`${capPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`);
      this.emit(`store i32 2, i32* ${capPtr}`);
      this.emit(`store %StringMap* ${mapPtr}, %StringMap** ${fieldPtr}`);
    } else {
      this.emit(`store ${llvmType} null, ${llvmType}* ${fieldPtr}`);
    }
  }

  // Helper methods delegate to context
  private nextTemp(): string { return this.ctx.nextTemp(); }
  private emit(instruction: string): void { this.ctx.emit(instruction); }

  // Helper to get field info
  getFieldInfo(className: string, fieldName: string): { index: number; type: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean'; tsType?: string } | null {
    let fields = this.classFields.get(className);

    if (!fields) {
      const classNode = this.findClassNode(className);
      if (classNode) {
        fields = this.getAllFieldsIncludingInherited(classNode);
        this.classFields.set(className, fields);
      }
    }

    if (fields) {
      let index = -1;
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i] as { name: string; fieldType: string; tsType: string };
        if (f.name === fieldName) {
          index = i;
          break;
        }
      }
      if (index !== -1) {
        const foundField = fields[index] as { name: string; fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean'; tsType: string };
        return { index, type: foundField.fieldType, tsType: foundField.tsType };
      }
    }

    return null;
  }

  // Helper to get just the field type as a string (for ChadScript compatibility)
  getFieldType(className: string, fieldName: string): string | null {
    const info = this.getFieldInfo(className, fieldName);
    if (info) {
      const infoTyped = info as { index: number; type: string; tsType: string };
      return infoTyped.type;
    }
    return null;
  }

  // Helper to get just the tsType as a string (for ChadScript compatibility)
  getFieldTsType(className: string, fieldName: string): string | null {
    const info = this.getFieldInfo(className, fieldName);
    if (info) {
      const infoTyped = info as { index: number; type: string; tsType: string };
      return infoTyped.tsType || null;
    }
    return null;
  }

  getMethodInfo(className: string, methodName: string): { method: ClassMethod; ownerClass: string } | null {
    let classNodeResult: ClassNode | null = null;
    if (this.ctx.ast && this.ctx.ast.classes) {
      for (let ci = 0; ci < this.ctx.ast.classes.length; ci++) {
        const c = this.ctx.ast.classes[ci] as { name: string };
        if (c.name === className) {
          classNodeResult = this.ctx.ast.classes[ci] as ClassNode;
          break;
        }
      }
    }
    if (!classNodeResult) {
      return null;
    }
    const classNode = classNodeResult as ClassNode;
    for (let mi = 0; mi < classNode.methods.length; mi++) {
      const m = classNode.methods[mi] as { name: string; isConstructor: boolean };
      if (m.name === methodName && !m.isConstructor) {
        return { method: classNode.methods[mi] as ClassMethod, ownerClass: className };
      }
    }
    if (classNode.extends) {
      return this.getMethodInfo(classNode.extends as string, methodName);
    }
    return null;
  }

  // Helper to get class fields
  getClassFields(className: string): { name: string; fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean' }[] {
    return this.classFields.get(className) || [];
  }

  generateClass(classNode: ClassNode): string {
    let ir = '';
    const className = classNode.name;

    const allFields = this.getAllFieldsIncludingInherited(classNode);

    this.classFields.set(className, allFields);

    if (!this.structTypesEmitted) {
      if (allFields.length > 0) {
        const fieldTypes: string[] = [];
        for (let fi = 0; fi < allFields.length; fi++) {
          const f = allFields[fi] as ClassField;
          fieldTypes.push(this.fieldToLlvmType(f));
        }
        ir += `%${className}_struct = type { ${fieldTypes.join(', ')} }\n\n`;
      } else {
        ir += `%${className}_struct = type { }\n\n`;
      }
    }

    let constructorResult: ClassMethod | null = null;
    const regularMethods: ClassMethod[] = [];
    for (let mi = 0; mi < classNode.methods.length; mi++) {
      const m = classNode.methods[mi] as { isConstructor: boolean };
      if (m.isConstructor) {
        constructorResult = classNode.methods[mi] as ClassMethod;
      } else {
        regularMethods.push(classNode.methods[mi] as ClassMethod);
      }
    }
    const constructor = constructorResult as ClassMethod;

    if (constructorResult) {
      this.ctx.output.length = 0;
      ir += this.generateConstructor(className, constructor, allFields);
      ir += '\n';
    } else {
      ir += this.generateDefaultConstructor(className, allFields);
      ir += '\n';
    }

    for (const method of regularMethods) {
      this.ctx.output.length = 0;
      ir += this.generateMethod(className, method, allFields);
      ir += '\n';
    }

    return ir;
  }

  private generateConstructor(className: string, constructor: ClassMethod, fields: { name: string; fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean'; tsType?: string }[]): string {
    const structType = `%${className}_struct*`;
    let ir = `define ${structType} @${className}_constructor(`;

    const paramLLVMTypes: string[] = [];
    const paramTsTypes: string[] = constructor.paramTypes || [];
    if (constructor.paramTypes && constructor.paramTypes.length > 0) {
      for (const pType of constructor.paramTypes) {
        paramLLVMTypes.push(this.tsTypeToLlvm(pType));
      }
    } else {
      for (let i = 0; i < constructor.params.length; i++) {
        paramLLVMTypes.push('double');
      }
    }

    ir += paramLLVMTypes.map((t, i) => `${t} %arg${i}`).join(', ');
    ir += ') {\n';
    ir += 'entry:\n';
    this.ctx.setCurrentLabel('entry');

    for (let i = 0; i < constructor.params.length; i++) {
      const paramName = constructor.params[i];
      const allocaReg = this.nextTemp();
      const llvmType = paramLLVMTypes[i];
      const tsType = paramTsTypes[i];

      this.defineParameterWithType(paramName, allocaReg, llvmType, tsType);
      this.emit(`${allocaReg} = alloca ${llvmType}`);
      this.emit(`store ${llvmType} %arg${i}, ${llvmType}* ${allocaReg}`);
    }

    let objPtr: string;

    if (fields.length > 0) {
      // Calculate size of struct
      const sizeofReg = this.nextTemp();
      this.emit(`${sizeofReg} = getelementptr %${className}_struct, %${className}_struct* null, i32 1`);
      const sizeReg = this.nextTemp();
      this.emit(`${sizeReg} = ptrtoint %${className}_struct* ${sizeofReg} to i64`);

      // Allocate memory
      const objMem = this.nextTemp();
      this.emit(`${objMem} = call i8* @GC_malloc(i64 ${sizeReg})`);
      objPtr = this.nextTemp();
      this.emit(`${objPtr} = bitcast i8* ${objMem} to %${className}_struct*`);

      // Initialize all fields to 0/null
      for (let i = 0; i < fields.length; i++) {
        const fieldPtr = this.nextTemp();
        const classField = fields[i];
        const llvmType = this.fieldToLlvmType(classField);
        this.emit(`${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${objPtr}, i32 0, i32 ${i}`);
        this.emitFieldInit(fieldPtr, llvmType);
      }
    } else {
      // Empty struct (no fields) - allocate minimal memory for the struct type
      const sizeofReg = this.nextTemp();
      this.emit(`${sizeofReg} = getelementptr %${className}_struct, %${className}_struct* null, i32 1`);
      const sizeReg = this.nextTemp();
      this.emit(`${sizeReg} = ptrtoint %${className}_struct* ${sizeofReg} to i64`);
      const objMem = this.nextTemp();
      this.emit(`${objMem} = call i8* @GC_malloc(i64 ${sizeReg})`);
      objPtr = this.nextTemp();
      this.emit(`${objPtr} = bitcast i8* ${objMem} to %${className}_struct*`);
    }

    // Set 'this' pointer so constructor body can use it
    this.ctx.thisPointer = objPtr;
    // Set current class name for super resolution
    this.ctx.currentClassName = className;
    // Set current function name for TypeChecker lookups
    this.ctx.currentFunction = 'constructor';
    // Set return type for return statements in constructor body (update main generator)
    this.ctx.currentFunctionReturnType = structType;

    // Assign parameter properties (e.g., constructor(private ctx: Foo) creates this.ctx = ctx)
    if (constructor.parameterProperties) {
      for (let i = 0; i < constructor.parameterProperties.length; i++) {
        const propName = constructor.parameterProperties[i];
        const paramIndex = constructor.params.indexOf(propName);
        if (paramIndex !== -1) {
          const fieldInfo = this.getFieldInfo(className, propName);
          if (fieldInfo) {
            const fieldInfoTyped = fieldInfo as { index: number; type: string; tsType?: string };
            const fieldIndex = fieldInfoTyped.index;
            const paramAlloca = this.ctx.getVariableAlloca(propName);
            if (paramAlloca) {
              const paramLlvmType = paramLLVMTypes[paramIndex];
              const loadedValue = this.nextTemp();
              this.emit(`${loadedValue} = load ${paramLlvmType}, ${paramLlvmType}* ${paramAlloca}`);

              const fieldLlvmType = this.fieldToLlvmType(fields[fieldIndex]);

              let valueToStore = loadedValue;
              if (paramLlvmType !== fieldLlvmType && paramLlvmType === 'i8*') {
                const castValue = this.nextTemp();
                this.emit(`${castValue} = bitcast i8* ${loadedValue} to ${fieldLlvmType}`);
                valueToStore = castValue;
              }

              const fieldPtr = this.nextTemp();
              this.emit(`${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${objPtr}, i32 0, i32 ${fieldIndex}`);
              this.emit(`store ${fieldLlvmType} ${valueToStore}, ${fieldLlvmType}* ${fieldPtr}`);
            }
          }
        }
      }
    }

    // Execute constructor body
    this.ctx.generateBlock(constructor.body, constructor.params);

    const deferredAllocas = this.ctx.allocaInstructions;
    if (deferredAllocas.length > 0) {
      const newOutput: string[] = [];
      for (let i = 0; i < deferredAllocas.length; i++) {
        newOutput.push(deferredAllocas[i]);
      }
      for (let i = 0; i < this.ctx.output.length; i++) {
        newOutput.push(this.ctx.output[i]);
      }
      this.ctx.output.length = 0;
      for (let i = 0; i < newOutput.length; i++) {
        this.ctx.output.push(newOutput[i]);
      }
      deferredAllocas.length = 0;
    }

    // Return the instance pointer
    if (this.ctx.output.length > 0) {
      ir += this.ctx.output.map(line => '  ' + line).join('\n') + '\n';
    }
    ir += `  ret ${structType} ${objPtr}\n`;
    ir += '}\n';

    return ir;
  }

  private generateDefaultConstructor(className: string, fields: { name: string; fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean'; tsType?: string }[]): string {
    const structType = `%${className}_struct*`;
    let ir = `define ${structType} @${className}_constructor() {\n`;
    ir += 'entry:\n';

    this.ctx.output.length = 0;
    this.ctx.setCurrentLabel('entry');

    let objPtr: string;

    if (fields.length > 0) {
      const sizeofReg = this.nextTemp();
      this.emit(`${sizeofReg} = getelementptr %${className}_struct, %${className}_struct* null, i32 1`);
      const sizeReg = this.nextTemp();
      this.emit(`${sizeReg} = ptrtoint %${className}_struct* ${sizeofReg} to i64`);

      const objMem = this.nextTemp();
      this.emit(`${objMem} = call i8* @GC_malloc(i64 ${sizeReg})`);
      objPtr = this.nextTemp();
      this.emit(`${objPtr} = bitcast i8* ${objMem} to %${className}_struct*`);

      for (let i = 0; i < fields.length; i++) {
        const fieldPtr = this.nextTemp();
        const classField = fields[i];
        const llvmType = this.fieldToLlvmType(classField);
        this.emit(`${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${objPtr}, i32 0, i32 ${i}`);
        this.emitFieldInit(fieldPtr, llvmType);
      }
    } else {
      // Empty struct (no fields) - allocate minimal memory for the struct type
      const sizeofReg = this.nextTemp();
      this.emit(`${sizeofReg} = getelementptr %${className}_struct, %${className}_struct* null, i32 1`);
      const sizeReg = this.nextTemp();
      this.emit(`${sizeReg} = ptrtoint %${className}_struct* ${sizeofReg} to i64`);
      const objMem = this.nextTemp();
      this.emit(`${objMem} = call i8* @GC_malloc(i64 ${sizeReg})`);
      objPtr = this.nextTemp();
      this.emit(`${objPtr} = bitcast i8* ${objMem} to %${className}_struct*`);
    }

    if (this.ctx.output.length > 0) {
      ir += this.ctx.output.map(line => '  ' + line).join('\n') + '\n';
    }
    ir += `  ret ${structType} ${objPtr}\n`;
    ir += '}\n';

    return ir;
  }

  private generateMethod(className: string, method: ClassMethod, fields: { name: string; fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean' }[]): string {
    let returnLLVMType = 'double';
    if (method.returnType) {
      returnLLVMType = this.tsTypeToLlvm(method.returnType);
    }

    const thisType = `%${className}_struct*`;
    let ir = `define ${returnLLVMType} @${className}_${method.name}(${thisType} %this`;

    const paramLLVMTypes: string[] = [];
    const paramTsTypes: string[] = method.paramTypes || [];
    if (method.paramTypes && method.paramTypes.length > 0) {
      for (const pType of method.paramTypes) {
        paramLLVMTypes.push(this.tsTypeToLlvm(pType));
      }
    } else {
      for (let i = 0; i < method.params.length; i++) {
        paramLLVMTypes.push('double');
      }
    }

    if (method.params.length > 0) {
      ir += ', ';
      ir += paramLLVMTypes.map((t, i) => `${t} %arg${i}`).join(', ');
    }
    ir += ') {\n';
    ir += 'entry:\n';
    this.ctx.setCurrentLabel('entry');

    const thisAlloca = this.nextTemp();
    this.emit(`${thisAlloca} = alloca ${thisType}`);
    this.emit(`store ${thisType} %this, ${thisType}* ${thisAlloca}`);
    const thisLoaded = this.nextTemp();
    this.emit(`${thisLoaded} = load ${thisType}, ${thisType}* ${thisAlloca}`);
    this.ctx.thisPointer = thisLoaded;
    this.ctx.currentClassName = className;
    this.ctx.currentFunction = method.name;
    this.ctx.currentFunctionReturnType = returnLLVMType;
    this.ctx.currentFunctionTsReturnType = method.returnType;

    for (let i = 0; i < method.params.length; i++) {
      const paramName = method.params[i];
      const allocaReg = this.nextTemp();
      const llvmType = paramLLVMTypes[i];
      const tsType = paramTsTypes[i];

      this.defineParameterWithType(paramName, allocaReg, llvmType, tsType);
      this.emit(`${allocaReg} = alloca ${llvmType}`);
      this.emit(`store ${llvmType} %arg${i}, ${llvmType}* ${allocaReg}`);
    }

    // Generate body
    const result = this.ctx.generateBlock(method.body, method.params);

    const deferredAllocas = this.ctx.allocaInstructions;
    if (deferredAllocas.length > 0) {
      const newOutput: string[] = [];
      for (let i = 0; i < deferredAllocas.length; i++) {
        newOutput.push(deferredAllocas[i]);
      }
      for (let i = 0; i < this.ctx.output.length; i++) {
        newOutput.push(this.ctx.output[i]);
      }
      this.ctx.output.length = 0;
      for (let i = 0; i < newOutput.length; i++) {
        this.ctx.output.push(newOutput[i]);
      }
      deferredAllocas.length = 0;
    }

    // Check for and fix incomplete return statements
    for (let i = 0; i < this.ctx.output.length; i++) {
      const line = this.ctx.output[i].trim();
      const retMatch = line.match(/^ret (i8\*|double|%\w+\*?)$/);
      if (retMatch) {
        const retType = retMatch[1];
        let defaultValue: string;
        if (retType === 'double') {
          defaultValue = '0.0';
        } else if (retType === 'i8*') {
          defaultValue = 'null';
        } else {
          defaultValue = 'null';
        }
        this.ctx.output[i] = `ret ${retType} ${defaultValue}`;
      }
    }

    // Add generated instructions
    if (this.ctx.output.length > 0) {
      ir += this.ctx.output.map(line => '  ' + line).join('\n') + '\n';
    }

    // Return value based on declared return type
    const lastInstruction = this.ctx.output.length > 0 ? this.ctx.output[this.ctx.output.length - 1].trim() : '';
    const hasTerminator = lastInstruction.startsWith('ret ') || lastInstruction.startsWith('br ') || lastInstruction === 'unreachable';

    if (!hasTerminator) {
      if (returnLLVMType === 'void') {
        ir += '  ret void\n';
      } else if (result !== null && result !== '' && result !== '0') {
        ir += `  ret ${returnLLVMType} ${result}\n`;
      } else {
        if (returnLLVMType && returnLLVMType.indexOf('*') !== -1) {
          ir += `  ret ${returnLLVMType} null\n`;
        } else {
          ir += `  ret ${returnLLVMType} 0.0\n`;
        }
      }
    }
    ir += '}\n';

    return ir;
  }

  generateNewExpression(className: string, args: Expression[], params: string[]): string {
    let classNodeResult: ClassNode | null = null;
    if (this.ctx.ast && this.ctx.ast.classes) {
      for (let ci = 0; ci < this.ctx.ast.classes.length; ci++) {
        const c = this.ctx.ast.classes[ci] as { name: string };
        if (c.name === className) {
          classNodeResult = this.ctx.ast.classes[ci] as ClassNode;
          break;
        }
      }
    }
    const classNode = classNodeResult as ClassNode;
    if (!classNodeResult) {
      throw new Error(`Class ${className} not found`);
    }
    let constructorResult2: ClassMethod | null = null;
    for (let mi = 0; mi < classNode.methods.length; mi++) {
      const m = classNode.methods[mi] as { name: string; isConstructor: boolean };
      if (m.isConstructor) {
        constructorResult2 = classNode.methods[mi] as ClassMethod;
        break;
      }
    }
    const constructor2 = constructorResult2 as ClassMethod;
    const paramTypes = constructor2 ? (constructor2 as { paramTypes: string[] }).paramTypes || [] : [];
    const paramLLVMTypes: string[] = [];
    for (let pi = 0; pi < paramTypes.length; pi++) {
      const pType = paramTypes[pi];
      paramLLVMTypes.push(this.tsTypeToLlvm(pType));
    }

    // Call the constructor with correct parameter types
    const argParts: string[] = [];
    for (let ai = 0; ai < args.length; ai++) {
      const arg = args[ai];
      const val = this.ctx.generateExpression(arg, params);
      const argType = ai < paramLLVMTypes.length ? paramLLVMTypes[ai] : 'double';
      argParts.push(argType + ' ' + val);
    }
    const argValues = argParts.join(', ');

    const fields = this.classFields.get(className) || [];
    const returnType = `%${className}_struct*`;

    const instance = this.nextTemp();
    this.emit(`${instance} = call ${returnType} @${className}_constructor(${argValues})`);

    return instance;
  }

  generateMethodCall(instancePtr: string, className: string, methodName: string, args: Expression[], params: string[]): string {
    const methodInfoResult = this.getMethodInfo(className, methodName);
    if (!methodInfoResult) {
      throw new Error(`Method ${methodName} not found in class ${className}`);
    }
    const methodInfo = methodInfoResult as { method: ClassMethod; ownerClass: string };
    const method = methodInfo.method;
    const methodOwnerClass = methodInfo.ownerClass;

    // Determine parameter types
    const paramTypes = (method as { paramTypes: string[] }).paramTypes || [];
    const paramLLVMTypes: string[] = [];
    for (let pi = 0; pi < paramTypes.length; pi++) {
      const pType = paramTypes[pi];
      paramLLVMTypes.push(this.tsTypeToLlvm(pType));
    }

    // Generate arguments with correct types based on paramTypes
    const argParts: string[] = [];
    for (let ai = 0; ai < args.length; ai++) {
      const arg = args[ai];
      const argTyped = arg as { type: string };
      const val = this.ctx.generateExpression(arg, params);

      // Use the declared paramType if available, otherwise infer
      let argType = 'double'; // default for JavaScript semantics
      if (ai < paramLLVMTypes.length) {
        argType = paramLLVMTypes[ai];
      } else {
        // Fallback inference for variadic or untyped params
        if (this.ctx.variableTypes.has(val)) {
          argType = this.ctx.getVariableType(val)!;
        } else if (val.startsWith('@.str')) {
          argType = 'i8*';
        } else if (argTyped.type === 'variable') {
          const varName = (arg as VariableNode).name;
          if (this.ctx.variableTypes.has(`%${varName}`)) {
            argType = this.ctx.getVariableType(`%${varName}`)!;
          }
        }
      }

      argParts.push(argType + ' ' + val);
    }
    const argValues = argParts.join(', ');

    // Determine return type
    let returnLLVMType = 'double'; // default for JavaScript semantics
    const methodTyped = method as { returnType: string };
    if (methodTyped.returnType) {
      returnLLVMType = this.methodReturnTypeToLlvm(methodTyped.returnType);
    }

    const fields = this.classFields.get(className) || [];
    const thisType = `%${className}_struct*`;

    let actualInstancePtr = instancePtr;
    const instancePtrType = this.ctx.getVariableType(instancePtr);
    if (instancePtrType && instancePtrType !== thisType) {
      const castPtr = this.nextTemp();
      this.emit(`${castPtr} = bitcast ${instancePtrType} ${instancePtr} to ${thisType}`);
      this.ctx.setVariableType(castPtr, thisType);
      actualInstancePtr = castPtr;
    }

    // Call the method with instance as first argument
    const argList = argValues ? `, ${argValues}` : '';

    if (returnLLVMType === 'void') {
      // Void methods don't return a value
      this.emit(`call void @${methodOwnerClass}_${methodName}(${thisType} ${actualInstancePtr}${argList})`);
      return '0'; // Return dummy value for void calls
    } else {
      const result = this.nextTemp();
      this.emit(`${result} = call ${returnLLVMType} @${methodOwnerClass}_${methodName}(${thisType} ${actualInstancePtr}${argList})`);
      this.ctx.setVariableType(result, returnLLVMType);
      return result;
    }
  }

  private tsTypeToLlvm(tsType: string): string {
    if (this.isEnumType(tsType)) {
      return 'double';
    }
    return tsTypeToLlvmUtil(tsType);
  }

  private isEnumType(typeName: string): boolean {
    if (!this.ctx.ast) return false;
    const enums = this.ctx.ast.enums;
    if (!enums) return false;
    for (let i = 0; i < enums.length; i++) {
      const enumDecl = enums[i];
      if (enumDecl.name === typeName) {
        return true;
      }
    }
    return false;
  }

  private methodReturnTypeToLlvm(returnType: string): string {
    if (returnType === 'string') return 'i8*';
    if (returnType === 'string[]') return '%StringArray*';
    if (returnType === 'number[]' || returnType === 'boolean[]') return '%Array*';
    if (returnType.endsWith('[]') && returnType !== 'string[]' && returnType !== 'number[]' && returnType !== 'boolean[]') {
      return '%ObjectArray*';
    }
    if (returnType === 'void') return 'void';
    if (returnType === 'number' || returnType === 'boolean') return 'double';
    if (this.isEnumType(returnType)) return 'double';
    if (returnType.indexOf(' | ') !== -1) {
      const parts = returnType.split(' | ');
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (part === 'string') return 'i8*';
        if (part === 'string[]') return '%StringArray*';
        if (part === 'number[]' || part === 'boolean[]') return '%Array*';
        if (part.endsWith('[]') && part !== 'string[]' && part !== 'number[]' && part !== 'boolean[]') {
          return '%ObjectArray*';
        }
      }
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (part !== 'null' && part !== 'undefined') {
          return 'i8*';
        }
      }
    }
    return 'i8*';
  }

  private defineParameterWithType(paramName: string, allocaReg: string, llvmType: string, tsType: string | undefined): void {
    if (!tsType || tsType === 'string') {
      const kind = llvmType === 'i8*' ? SymbolKind.String :
                   llvmType === '%StringArray*' ? SymbolKind.StringArray :
                   llvmType === '%Array*' ? SymbolKind.Array :
                   llvmType === 'double' ? SymbolKind.Number : SymbolKind.Object;
      this.ctx.defineVariable(paramName, allocaReg, llvmType, kind, 'local');
      return;
    }

    if (tsType === 'number' || tsType === 'boolean') {
      this.ctx.defineVariable(paramName, allocaReg, 'double', SymbolKind.Number, 'local');
      return;
    }

    if (tsType === 'string[]') {
      this.ctx.defineVariable(paramName, allocaReg, '%StringArray*', SymbolKind.StringArray, 'local');
      return;
    }

    if (tsType === 'number[]' || tsType === 'boolean[]') {
      this.ctx.defineVariable(paramName, allocaReg, '%Array*', SymbolKind.Array, 'local');
      return;
    }

    let interfaceDefResult: InterfaceDeclaration | null = null;
    if (this.ctx.ast?.interfaces) {
      for (let ii = 0; ii < this.ctx.ast.interfaces.length; ii++) {
        const iface = this.ctx.ast.interfaces[ii] as InterfaceDeclaration;
        if (iface.name === tsType) {
          interfaceDefResult = iface;
          break;
        }
      }
    }
    if (interfaceDefResult) {
      const interfaceDef = interfaceDefResult as InterfaceDeclaration;
      const keys: string[] = [];
      const types: string[] = [];
      const tsTypes: string[] = [];
      for (let fi = 0; fi < interfaceDef.fields.length; fi++) {
        const f = interfaceDef.fields[fi] as { name: string; type: string };
        keys.push(stripOptional(f.name));
        types.push(this.fieldTypeToLlvm(f.type));
        tsTypes.push(f.type);
      }
      this.ctx.defineVariable(paramName, allocaReg, 'i8*', SymbolKind.Object, 'local', {
        objectMetadata: { keys, types, tsTypes },
        interfaceType: tsType
      });
      return;
    }

    let typeAlias: { name: string; unionMembers: string[] } | null = null;
    const typeAliases = this.ctx.ast?.typeAliases || [];
    for (let i = 0; i < typeAliases.length; i++) {
      const ta = typeAliases[i] as { name: string; unionMembers: string[] };
      if (ta.name === tsType) {
        typeAlias = ta;
        break;
      }
    }
    if (typeAlias) {
      const typeAliasTyped = typeAlias as { name: string; unionMembers: string[] };
      if (typeAliasTyped.unionMembers) {
        const commonFields = this.getUnionCommonFields(typeAliasTyped.unionMembers);
        this.ctx.defineVariable(paramName, allocaReg, 'i8*', SymbolKind.Object, 'local', {
          objectMetadata: commonFields
        });
        return;
      }
    }

    let classDef: { name: string } | null = null;
    const classes = this.ctx.ast?.classes || [];
    for (let i = 0; i < classes.length; i++) {
      const cls = classes[i] as { name: string };
      if (cls.name === tsType) {
        classDef = cls;
        break;
      }
    }
    if (classDef) {
      this.ctx.defineVariable(paramName, allocaReg, 'i8*', SymbolKind.Class, 'local', {
        classMetadata: { className: classDef.name }
      });
      return;
    }

    this.ctx.defineVariable(paramName, allocaReg, llvmType, SymbolKind.Object, 'local');
  }

  private fieldTypeToLlvm(fieldType: string): string {
    if (fieldType === 'string') return 'i8*';
    if (fieldType === 'number') return 'double';
    if (fieldType === 'boolean') return 'double';
    if (fieldType.startsWith("'") || fieldType.startsWith('"')) return 'i8*';
    return 'i8*';
  }

  private getUnionCommonFields(memberNames: string[]): { keys: string[]; types: string[] } {
    const interfaces: { name: string; fields: { name: string; type: string }[] }[] = [];
    const astInterfaces = this.ctx.ast?.interfaces || [];
    for (let i = 0; i < memberNames.length; i++) {
      const memberName = memberNames[i];
      for (let j = 0; j < astInterfaces.length; j++) {
        const iface = astInterfaces[j] as { name: string; fields: { name: string; type: string }[] };
        if (iface.name === memberName) {
          interfaces.push(iface);
          break;
        }
      }
    }

    if (interfaces.length === 0) {
      return { keys: [], types: [] };
    }

    const firstInterface = interfaces[0] as { name: string; fields: { name: string; type: string }[] };
    const firstFields = firstInterface.fields;
    const commonFields: CommonField[] = [];

    for (let fi = 0; fi < firstFields.length; fi++) {
      const field = firstFields[fi] as { name: string; type: string };
      let isCommon = true;
      for (let ii = 0; ii < interfaces.length; ii++) {
        const ifaceTyped = interfaces[ii] as { fields: { name: string; type: string }[] };
        let found = false;
        for (let fj = 0; fj < ifaceTyped.fields.length; fj++) {
          const f = ifaceTyped.fields[fj] as { name: string; type: string };
          if (f.name === field.name && this.areTypesCompatible(f.type, field.type)) {
            found = true;
            break;
          }
        }
        if (!found) {
          isCommon = false;
          break;
        }
      }
      if (isCommon) {
        commonFields.push({ name: field.name, type: this.normalizeType(field.type) });
      }
    }

    const keys: string[] = [];
    const types: string[] = [];
    for (let fi = 0; fi < commonFields.length; fi++) {
      const f = commonFields[fi] as CommonField;
      keys.push(stripOptional(f.name));
      types.push(this.fieldTypeToLlvm(f.type));
    }

    return {
      keys: keys,
      types: types
    };
  }

  private areTypesCompatible(type1: string, type2: string): boolean {
    if (type1 === type2) return true;
    const norm1 = this.normalizeType(type1);
    const norm2 = this.normalizeType(type2);
    return norm1 === norm2;
  }

  private normalizeType(type: string): string {
    if (type.startsWith("'") && type.endsWith("'")) return 'string';
    if (type.startsWith('"') && type.endsWith('"')) return 'string';
    return type;
  }

  private structTypesEmitted: boolean = false;

  generateStructTypeDefinitions(classCount: number): string {
    if (classCount === 0) {
      return '';
    }
    if (!this.ctx.ast || !this.ctx.ast.classes) {
      return '';
    }

    let ir = '; Class struct type definitions\n';
    let hasDefinitions = false;
    const classes = this.ctx.ast.classes;

    for (let ci = 0; ci < classCount; ci++) {
      const classNode = classes[ci] as ClassNode;
      const className = classNode.name;
      const allFields = this.getAllFieldsIncludingInherited(classNode);
      this.classFields.set(className, allFields);
      hasDefinitions = true;
      if (allFields.length > 0) {
        const fieldTypes: string[] = [];
        for (let fi = 0; fi < allFields.length; fi++) {
          const f = allFields[fi] as ClassField;
          fieldTypes.push(this.fieldToLlvmType(f));
        }
        ir += `%${className}_struct = type { ${fieldTypes.join(', ')} }\n`;
      } else {
        ir += `%${className}_struct = type { }\n`;
      }
    }

    if (!hasDefinitions) return '';

    this.structTypesEmitted = true;
    ir += '\n';
    return ir;
  }

  hasEmittedStructTypes(): boolean {
    return this.structTypesEmitted;
  }
}

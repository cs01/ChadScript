import { Expression, ClassNode, ClassMethod, ClassField, BlockStatement, VariableNode, InterfaceDeclaration, InterfaceField, TypeAliasDeclaration, CommonField } from '../../../ast/types.js';
import { IGeneratorContext } from '../../infrastructure/generator-context.js';
import { SymbolKind } from '../../infrastructure/symbol-table.js';

// ============================================
// CLASS GENERATOR - Class and instance operations
// ============================================

export class ClassGenerator {
  // Track class structures: className -> field info
  private classFields: Map<string, { name: string; fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean'; tsType?: string }[]> = new Map();
  // Track instance variables: varName -> className
  private instanceVariables: Map<string, string> = new Map();

  constructor(private ctx: IGeneratorContext) {}

  // Helper methods delegate to context
  private nextTemp() { return this.ctx.nextTemp(); }
  private nextLabel(prefix: string) { return this.ctx.nextLabel(prefix); }
  private emit(instruction: string) { this.ctx.emit(instruction); }
  private get output() { return this.ctx.output; }
  private get variableTypes() { return this.ctx.variableTypes; }
  private get thisPointer() { return this.ctx.thisPointer; }
  private set thisPointer(ptr: string | null) { this.ctx.thisPointer = ptr; }
  private get currentClassName() { return this.ctx.currentClassName; }
  private set currentClassName(name: string | null) { this.ctx.currentClassName = name; }
  private get ast() { return this.ctx.ast; }

  // Helper to get field info
  getFieldInfo(className: string, fieldName: string): { index: number; type: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean'; tsType?: string } | null {
    let fields = this.classFields.get(className);

    if (!fields) {
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
      const classNodeInner = classNodeResult as ClassNode;
      if (classNodeResult) {
        fields = classNodeInner.fields;
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

    let classNodeResult2: ClassNode | null = null;
    if (this.ctx.ast && this.ctx.ast.classes) {
      for (let ci = 0; ci < this.ctx.ast.classes.length; ci++) {
        const c = this.ctx.ast.classes[ci] as { name: string };
        if (c.name === className) {
          classNodeResult2 = this.ctx.ast.classes[ci] as ClassNode;
          break;
        }
      }
    }
    const classNodeOuter = classNodeResult2 as ClassNode;
    if (classNodeResult2 && classNodeOuter.extends) {
      return this.getFieldInfo(classNodeOuter.extends as string, fieldName);
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

    // Store field info for later lookups
    this.classFields.set(className, classNode.fields);

    // Define LLVM struct type for this class
    // Example: %Parser_struct = type { i8*, i32, %StringArray*, %Array* } for fields [code: string, pos: number, items: string[], nums: number[]]
    if (classNode.fields.length > 0) {
      const fieldTypes: string[] = [];
      for (let fi = 0; fi < classNode.fields.length; fi++) {
        const f = classNode.fields[fi] as { name: string; fieldType: string; tsType: string };
        if (f.fieldType === 'string') {
          fieldTypes.push('i8*');
        } else if (f.fieldType === 'string[]') {
          fieldTypes.push('%StringArray*');
        } else if (f.fieldType.endsWith('[]')) {
          fieldTypes.push('%Array*');
        } else if (f.fieldType === 'boolean') {
          fieldTypes.push('i1');
        } else if (f.tsType && f.tsType.startsWith('Map<string,')) {
          fieldTypes.push('%StringMap*');
        } else if (f.tsType && f.tsType.startsWith('Map<')) {
          fieldTypes.push('%Map*');
        } else if (f.tsType && f.tsType.startsWith('Set<string>')) {
          fieldTypes.push('%StringSet*');
        } else if (f.tsType && f.tsType.startsWith('Set<')) {
          fieldTypes.push('%Set*');
        } else {
          fieldTypes.push('double');
        }
      }
      ir += `%${className}_struct = type { ${fieldTypes.join(', ')} }\n\n`;
    }

    const constructorResult = classNode.methods.find(m => m.isConstructor);
    const constructor = constructorResult as ClassMethod;
    const regularMethods = classNode.methods.filter(m => !m.isConstructor);

    // Generate constructor function (returns pointer to struct)
    if (constructorResult) {
      // Clear output by removing all elements (preserving reference)
      this.output.length = 0;
      ir += this.generateConstructor(className, constructor, classNode.fields);
      ir += '\n';
    }

    // Generate regular methods
    for (const method of regularMethods) {
      // Clear output by removing all elements (preserving reference)
      this.output.length = 0;
      ir += this.generateMethod(className, method, classNode.fields);
      ir += '\n';
    }

    return ir;
  }

  private generateConstructor(className: string, constructor: ClassMethod, fields: { name: string; fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean'; tsType?: string }[]): string {
    const structType = fields.length > 0 ? `%${className}_struct*` : 'double*';
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
        const fieldType = classField.fieldType;
        const tsType = classField.tsType;
        this.emit(`${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${objPtr}, i32 0, i32 ${i}`);

        if (fieldType === 'string') {
          this.emit(`store i8* null, i8** ${fieldPtr}`);
        } else if (fieldType === 'string[]') {
          this.emit(`store %StringArray* null, %StringArray** ${fieldPtr}`);
        } else if (fieldType.endsWith('[]')) {
          this.emit(`store %Array* null, %Array** ${fieldPtr}`);
        } else if (fieldType === 'boolean') {
          this.emit(`store i1 false, i1* ${fieldPtr}`);
        } else if (tsType?.startsWith('Map<string,')) {
          this.emit(`store %StringMap* null, %StringMap** ${fieldPtr}`);
        } else if (tsType?.startsWith('Map<')) {
          this.emit(`store %Map* null, %Map** ${fieldPtr}`);
        } else if (tsType === 'Set<string>') {
          this.emit(`store %StringSet* null, %StringSet** ${fieldPtr}`);
        } else if (tsType?.startsWith('Set<')) {
          this.emit(`store %Set* null, %Set** ${fieldPtr}`);
        } else {
          this.emit(`store double 0.0, double* ${fieldPtr}`);
        }
      }
    } else {
      // Backward compatibility: no fields, use old array approach with double*
      const numFields = 10;
      // Compute size of double dynamically
      const doubleSizePtr = this.nextTemp();
      this.emit(`${doubleSizePtr} = getelementptr double, double* null, i32 1`);
      const doubleSize = this.nextTemp();
      this.emit(`${doubleSize} = ptrtoint double* ${doubleSizePtr} to i64`);
      const objSize = this.nextTemp();
      this.emit(`${objSize} = mul i64 ${numFields}, ${doubleSize}`);
      const objMem = this.nextTemp();
      this.emit(`${objMem} = call i8* @GC_malloc_atomic(i64 ${objSize})`);
      objPtr = this.nextTemp();
      this.emit(`${objPtr} = bitcast i8* ${objMem} to double*`);

      for (let i = 0; i < numFields; i++) {
        const fieldPtr = this.nextTemp();
        this.emit(`${fieldPtr} = getelementptr inbounds double, double* ${objPtr}, i32 ${i}`);
        this.emit(`store double 0.0, double* ${fieldPtr}`);
      }
    }

    // Set 'this' pointer so constructor body can use it
    this.thisPointer = objPtr;
    // Set current class name for super resolution
    this.currentClassName = className;
    // Set current function name for TypeChecker lookups
    this.ctx.currentFunction = 'constructor';
    // Set return type for return statements in constructor body (update main generator)
    this.ctx.currentFunctionReturnType = structType;

    // Execute constructor body
    const bodyResult = this.ctx.generateBlock(constructor.body, constructor.params);

    // Return the instance pointer
    if (this.output.length > 0) {
      ir += this.output.map(line => '  ' + line).join('\n') + '\n';
    }
    ir += `  ret ${structType} ${objPtr}\n`;
    ir += '}\n';

    return ir;
  }

  private generateMethod(className: string, method: ClassMethod, fields: { name: string; fieldType: 'double' | 'string' | 'string[]' | 'number[]' | 'boolean[]' | 'boolean' }[]): string {
    let returnLLVMType = 'double';
    if (method.returnType) {
      if (method.returnType === 'string') {
        returnLLVMType = 'i8*';
      } else if (method.returnType === 'string[]') {
        returnLLVMType = '%StringArray*';
      } else if (method.returnType === 'number[]' || method.returnType === 'boolean[]') {
        returnLLVMType = '%Array*';
      } else if (method.returnType === 'void') {
        returnLLVMType = 'void';
      }
    }

    const thisType = fields.length > 0 ? `%${className}_struct*` : 'double*';
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

    const thisAlloca = this.nextTemp();
    this.emit(`${thisAlloca} = alloca ${thisType}`);
    this.emit(`store ${thisType} %this, ${thisType}* ${thisAlloca}`);
    const thisLoaded = this.nextTemp();
    this.emit(`${thisLoaded} = load ${thisType}, ${thisType}* ${thisAlloca}`);
    this.thisPointer = thisLoaded;
    this.currentClassName = className;
    this.ctx.currentFunction = method.name;
    this.ctx.currentFunctionReturnType = returnLLVMType;

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

    // Add generated instructions
    if (this.output.length > 0) {
      ir += this.output.map(line => '  ' + line).join('\n') + '\n';
    }

    // Return value based on declared return type
    if (returnLLVMType === 'void') {
      ir += '  ret void\n';
    } else if (result !== null) {
      ir += `  ret ${returnLLVMType} ${result}\n`;
    } else {
      // Default return value for non-void functions with no explicit return
      if (returnLLVMType === 'i8*') {
        ir += '  ret i8* null\n';
      } else if (returnLLVMType === '%StringArray*' || returnLLVMType === '%Array*') {
        ir += `  ret ${returnLLVMType} null\n`;
      } else {
        ir += '  ret i32 0\n';
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
      if (pType === 'string') {
        paramLLVMTypes.push('i8*');
      } else if (pType === 'string[]') {
        paramLLVMTypes.push('%StringArray*');
      } else if (pType === 'number[]' || pType === 'boolean[]') {
        paramLLVMTypes.push('%Array*');
      } else {
        paramLLVMTypes.push('double');
      }
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
    const returnType = fields.length > 0 ? `%${className}_struct*` : 'double*';

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
      if (pType === 'string') {
        paramLLVMTypes.push('i8*');
      } else if (pType === 'string[]') {
        paramLLVMTypes.push('%StringArray*');
      } else if (pType === 'number[]' || pType === 'boolean[]') {
        paramLLVMTypes.push('%Array*');
      } else {
        paramLLVMTypes.push('double');
      }
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
      if (methodTyped.returnType === 'string') {
        returnLLVMType = 'i8*';
      } else if (methodTyped.returnType === 'string[]') {
        returnLLVMType = '%StringArray*';
      } else if (methodTyped.returnType === 'number[]' || methodTyped.returnType === 'boolean[]') {
        returnLLVMType = '%Array*';
      } else if (methodTyped.returnType === 'void') {
        returnLLVMType = 'void';
      }
      // else: number, boolean -> double
    }

    const fields = this.classFields.get(className) || [];
    const thisType = fields.length > 0 ? `%${className}_struct*` : 'double*';

    // Call the method with instance as first argument
    const argList = argValues ? `, ${argValues}` : '';

    if (returnLLVMType === 'void') {
      // Void methods don't return a value
      this.emit(`call void @${methodOwnerClass}_${methodName}(${thisType} ${instancePtr}${argList})`);
      return '0'; // Return dummy value for void calls
    } else {
      const result = this.nextTemp();
      this.emit(`${result} = call ${returnLLVMType} @${methodOwnerClass}_${methodName}(${thisType} ${instancePtr}${argList})`);
      return result;
    }
  }

  private tsTypeToLlvm(tsType: string): string {
    if (tsType === 'string') return 'i8*';
    if (tsType === 'number') return 'double';
    if (tsType === 'boolean') return 'double';
    if (tsType === 'string[]') return '%StringArray*';
    if (tsType === 'number[]' || tsType === 'boolean[]') return '%Array*';
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

    const interfaceDefResult = this.ctx.ast?.interfaces?.find((iface: InterfaceDeclaration) => iface.name === tsType);
    if (interfaceDefResult) {
      const interfaceDef = interfaceDefResult as InterfaceDeclaration;
      const keys: string[] = [];
      const types: string[] = [];
      const tsTypes: string[] = [];
      for (let fi = 0; fi < interfaceDef.fields.length; fi++) {
        const f = interfaceDef.fields[fi] as { name: string; type: string };
        keys.push(f.name);
        types.push(this.fieldTypeToLlvm(f.type));
        tsTypes.push(f.type);
      }
      this.ctx.defineVariable(paramName, allocaReg, 'i8*', SymbolKind.Object, 'local', {
        objectMetadata: { keys, types, tsTypes }
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

    this.ctx.defineVariable(paramName, allocaReg, llvmType, SymbolKind.Object, 'local');
  }

  private fieldTypeToLlvm(fieldType: string): string {
    if (fieldType === 'string') return 'i8*';
    if (fieldType === 'number') return 'double';
    if (fieldType === 'boolean') return 'i8*';
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
      keys.push(f.name);
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
}

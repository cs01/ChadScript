import { Expression, ClassNode, ClassMethod, BlockStatement } from '../../ast/types.js';
import { BaseGenerator } from './base-generator.js';
import { logger } from '../../utils/logger.js';

// ============================================
// CLASS GENERATOR - Class and instance operations
// ============================================

export class ClassGenerator extends BaseGenerator {
  // Generate delegates (set by LLVMGenerator)
  generateExpression!: (expr: Expression, params: string[]) => string;
  generateBlock!: (block: BlockStatement, params: string[]) => string | null;

  // AST reference (set by LLVMGenerator for method lookups)
  ast: any;

  // Track class structures: className -> field info
  private classFields: Map<string, { name: string; fieldType: 'i32' | 'string' | 'string[]' | 'number[]' | 'boolean[]' }[]> = new Map();
  // Track instance variables: varName -> className
  private instanceVariables: Map<string, string> = new Map();

  constructor() {
    super();
  }

  // Helper to get field info
  getFieldInfo(className: string, fieldName: string): { index: number; type: 'i32' | 'string' | 'string[]' | 'number[]' | 'boolean[]' } | null {
    const fields = this.classFields.get(className);
    if (!fields) return null;

    const index = fields.findIndex(f => f.name === fieldName);
    if (index === -1) return null;

    return { index, type: fields[index].fieldType };
  }

  // Helper to get class fields
  getClassFields(className: string): { name: string; fieldType: 'i32' | 'string' | 'string[]' | 'number[]' | 'boolean[]' }[] {
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
      const fieldTypes = classNode.fields.map(f => {
        if (f.fieldType === 'string') return 'i8*';
        if (f.fieldType === 'string[]') return '%StringArray*';  // String arrays
        if (f.fieldType.endsWith('[]')) return '%Array*';  // Number/boolean arrays
        return 'i32';
      });
      ir += `%${className}_struct = type { ${fieldTypes.join(', ')} }\n\n`;
    }

    const constructor = classNode.methods.find(m => m.isConstructor);
    const regularMethods = classNode.methods.filter(m => !m.isConstructor);

    // Generate constructor function (returns pointer to struct)
    if (constructor) {
      // Reset tempCounter before constructor
      if ((this as any).resetTempCounter) {
        (this as any).resetTempCounter();
      }
      // Clear output by removing all elements (preserving reference)
      this.output.length = 0;
      ir += this.generateConstructor(className, constructor, classNode.fields);
      ir += '\n';
    }

    // Generate regular methods
    for (const method of regularMethods) {
      // Reset tempCounter before each method
      if ((this as any).resetTempCounter) {
        (this as any).resetTempCounter();
      }
      // Clear output by removing all elements (preserving reference)
      this.output.length = 0;
      ir += this.generateMethod(className, method, classNode.fields);
      ir += '\n';
    }

    return ir;
  }

  private generateConstructor(className: string, constructor: ClassMethod, fields: { name: string; fieldType: 'i32' | 'string' | 'string[]' | 'number[]' | 'boolean[]' }[]): string {
    this.labelCounter = 0;

    // Constructor returns struct pointer (either %ClassName_struct* or i32* for backward compat)
    const structType = fields.length > 0 ? `%${className}_struct*` : 'i32*';
    let ir = `define ${structType} @${className}_constructor(`;

    // Generate parameter list with proper types
    const paramLLVMTypes: string[] = [];
    if (constructor.paramTypes && constructor.paramTypes.length > 0) {
      for (const pType of constructor.paramTypes) {
        if (pType === 'string') {
          paramLLVMTypes.push('i8*');
        } else if (pType === 'string[]') {
          paramLLVMTypes.push('%StringArray*');
        } else if (pType === 'number[]' || pType === 'boolean[]') {
          paramLLVMTypes.push('%Array*');
        } else {
          paramLLVMTypes.push('i32'); // number, boolean
        }
      }
    } else {
      // Fallback: all i32 (backward compat)
      for (let i = 0; i < constructor.params.length; i++) {
        paramLLVMTypes.push('i32');
      }
    }

    ir += paramLLVMTypes.map((t, i) => `${t} %arg${i}`).join(', ');
    ir += ') {\n';
    ir += 'entry:\n';

    // Allocate stack space for parameters with proper types
    for (let i = 0; i < constructor.params.length; i++) {
      const paramName = constructor.params[i];
      const allocaReg = this.nextTemp();
      const llvmType = paramLLVMTypes[i];
      this.variables.set(paramName, allocaReg);
      this.variableTypes.set(paramName, llvmType);  // Track the type!
      this.emit(`${allocaReg} = alloca ${llvmType}`);
      this.emit(`store ${llvmType} %arg${i}, ${llvmType}* ${allocaReg}`);

      // Track string parameters (backward compat)
      if (llvmType === 'i8*') {
        this.stringVariables.set(allocaReg, allocaReg);
      }
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
      this.emit(`${objMem} = call i8* @malloc(i64 ${sizeReg})`);
      objPtr = this.nextTemp();
      this.emit(`${objPtr} = bitcast i8* ${objMem} to %${className}_struct*`);

      // Initialize all fields to 0/null
      for (let i = 0; i < fields.length; i++) {
        const fieldPtr = this.nextTemp();
        const fieldType = fields[i].fieldType;
        this.emit(`${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${objPtr}, i32 0, i32 ${i}`);

        if (fieldType === 'string') {
          this.emit(`store i8* null, i8** ${fieldPtr}`);
        } else if (fieldType === 'string[]') {
          // String array fields - initialize to null
          this.emit(`store %StringArray* null, %StringArray** ${fieldPtr}`);
        } else if (fieldType.endsWith('[]')) {
          // Number/boolean array fields - initialize to null
          this.emit(`store %Array* null, %Array** ${fieldPtr}`);
        } else {
          // i32 fields
          this.emit(`store i32 0, i32* ${fieldPtr}`);
        }
      }
    } else {
      // Backward compatibility: no fields, use old array-of-i32 approach
      const numFields = 10;
      const objSize = this.nextTemp();
      this.emit(`${objSize} = mul i64 ${numFields}, 4`);
      const objMem = this.nextTemp();
      this.emit(`${objMem} = call i8* @malloc(i64 ${objSize})`);
      objPtr = this.nextTemp();
      this.emit(`${objPtr} = bitcast i8* ${objMem} to i32*`);

      for (let i = 0; i < numFields; i++) {
        const fieldPtr = this.nextTemp();
        this.emit(`${fieldPtr} = getelementptr inbounds i32, i32* ${objPtr}, i32 ${i}`);
        this.emit(`store i32 0, i32* ${fieldPtr}`);
      }
    }

    // Set 'this' pointer so constructor body can use it
    this.thisPointer = objPtr;
    // Set current class name for super resolution
    this.currentClassName = className;
    // Set return type for return statements in constructor body
    this.currentFunctionReturnType = structType;

    // Execute constructor body
    const bodyResult = this.generateBlock(constructor.body, constructor.params);

    // Return the instance pointer
    if (this.output.length > 0) {
      ir += this.output.map(line => '  ' + line).join('\n') + '\n';
    }
    ir += `  ret ${structType} ${objPtr}\n`;
    ir += '}\n';

    return ir;
  }

  private generateMethod(className: string, method: ClassMethod, fields: { name: string; fieldType: 'i32' | 'string' | 'string[]' | 'number[]' | 'boolean[]' }[]): string {
    this.labelCounter = 0;

    // Determine return type from method's returnType annotation
    let returnLLVMType = 'i32'; // default
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
      // else: number, boolean -> i32
    }

    // Method signature: first param is 'this' (struct pointer or i32* for compat)
    const thisType = fields.length > 0 ? `%${className}_struct*` : 'i32*';
    let ir = `define ${returnLLVMType} @${className}_${method.name}(${thisType} %this`;

    // Generate parameter list with proper types
    const paramLLVMTypes: string[] = [];
    if (method.paramTypes && method.paramTypes.length > 0) {
      for (const pType of method.paramTypes) {
        if (pType === 'string') {
          paramLLVMTypes.push('i8*');
        } else if (pType === 'string[]') {
          paramLLVMTypes.push('%StringArray*');
        } else if (pType === 'number[]' || pType === 'boolean[]') {
          paramLLVMTypes.push('%Array*');
        } else {
          paramLLVMTypes.push('i32'); // number, boolean
        }
      }
    } else {
      // Fallback: all i32 (backward compat)
      for (let i = 0; i < method.params.length; i++) {
        paramLLVMTypes.push('i32');
      }
    }

    if (method.params.length > 0) {
      ir += ', ';
      ir += paramLLVMTypes.map((t, i) => `${t} %arg${i}`).join(', ');
    }
    ir += ') {\n';
    ir += 'entry:\n';

    // Allocate stack space for 'this' pointer and load it
    const thisAlloca = this.nextTemp();
    this.emit(`${thisAlloca} = alloca ${thisType}`);
    this.emit(`store ${thisType} %this, ${thisType}* ${thisAlloca}`);
    const thisLoaded = this.nextTemp();
    this.emit(`${thisLoaded} = load ${thisType}, ${thisType}* ${thisAlloca}`);
    // Set 'this' pointer so method body can use it
    this.thisPointer = thisLoaded;
    // Set current class name for super resolution
    this.currentClassName = className;
    // Set return type for return statements in method body
    this.currentFunctionReturnType = returnLLVMType;

    // Allocate stack space for parameters with proper types
    for (let i = 0; i < method.params.length; i++) {
      const paramName = method.params[i];
      const allocaReg = this.nextTemp();
      const llvmType = paramLLVMTypes[i];
      this.variables.set(paramName, allocaReg);
      this.variableTypes.set(paramName, llvmType);  // Track the type!
      this.emit(`${allocaReg} = alloca ${llvmType}`);
      this.emit(`store ${llvmType} %arg${i}, ${llvmType}* ${allocaReg}`);

      // Track string parameters (backward compat)
      if (llvmType === 'i8*') {
        this.stringVariables.set(allocaReg, allocaReg);
      }
    }

    // Generate body
    const result = this.generateBlock(method.body, method.params);

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
    // Call the constructor
    const argValues = args.map(arg => {
      const val = this.generateExpression(arg, params);

      // If the argument is a string literal, we need to convert i8* to i32
      if (arg.type === 'string') {
        const asInt = this.nextTemp();
        this.emit(`${asInt} = ptrtoint i8* ${val} to i32`);
        return `i32 ${asInt}`;
      }

      return `i32 ${val}`;
    }).join(', ');

    const fields = this.classFields.get(className) || [];
    const returnType = fields.length > 0 ? `%${className}_struct*` : 'i32*';

    const instance = this.nextTemp();
    this.emit(`${instance} = call ${returnType} @${className}_constructor(${argValues})`);

    return instance;
  }

  generateMethodCall(instancePtr: string, className: string, methodName: string, args: Expression[], params: string[]): string {
    // Look up the method to get its parameter and return types
    const classNode = (this.ast as any).classes.find((c: any) => c.name === className);
    if (!classNode) {
      throw new Error(`Class ${className} not found`);
    }
    const method = classNode.methods.find((m: any) => m.name === methodName && !m.isConstructor);
    if (!method) {
      throw new Error(`Method ${methodName} not found in class ${className}`);
    }

    // Determine parameter types
    const paramTypes = method.paramTypes || [];
    const paramLLVMTypes: string[] = paramTypes.map((pType: string) => {
      if (pType === 'string') return 'i8*';
      if (pType === 'string[]') return '%StringArray*';
      if (pType === 'number[]' || pType === 'boolean[]') return '%Array*';
      return 'i32'; // number, boolean
    });

    // Generate arguments with correct types based on paramTypes
    const argValues = args.map((arg, i) => {
      const val = this.generateExpression(arg, params);

      // Use the declared paramType if available, otherwise infer
      let argType = 'i32'; // default
      if (i < paramLLVMTypes.length) {
        argType = paramLLVMTypes[i];
      } else {
        // Fallback inference for variadic or untyped params
        if (this.variableTypes.has(val)) {
          argType = this.variableTypes.get(val)!;
        } else if (val.startsWith('@.str')) {
          argType = 'i8*';
        } else if (arg.type === 'variable') {
          const varName = (arg as any).name;
          if (this.variableTypes.has(`%${varName}`)) {
            argType = this.variableTypes.get(`%${varName}`)!;
          }
        }
      }

      return `${argType} ${val}`;
    }).join(', ');

    // Determine return type
    let returnLLVMType = 'i32'; // default
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
      // else: number, boolean -> i32
    }

    const fields = this.classFields.get(className) || [];
    const thisType = fields.length > 0 ? `%${className}_struct*` : 'i32*';

    // Call the method with instance as first argument
    const argList = argValues ? `, ${argValues}` : '';

    if (returnLLVMType === 'void') {
      // Void methods don't return a value
      this.emit(`call void @${className}_${methodName}(${thisType} ${instancePtr}${argList})`);
      return '0'; // Return dummy value for void calls
    } else {
      const result = this.nextTemp();
      this.emit(`${result} = call ${returnLLVMType} @${className}_${methodName}(${thisType} ${instancePtr}${argList})`);
      return result;
    }
  }
}

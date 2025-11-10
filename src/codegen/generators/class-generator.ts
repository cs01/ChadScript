import { Expression, ClassNode, ClassMethod, BlockStatement } from '../../ast/types.js';
import { BaseGenerator } from './base-generator.js';

// ============================================
// CLASS GENERATOR - Class and instance operations
// ============================================

export class ClassGenerator extends BaseGenerator {
  // Generate delegates (set by LLVMGenerator)
  generateExpression!: (expr: Expression, params: string[]) => string;
  generateBlock!: (block: BlockStatement, params: string[]) => string | null;

  // Track class structures: className -> field info
  private classFields: Map<string, { name: string; fieldType: 'i32' | 'string' }[]> = new Map();
  // Track instance variables: varName -> className
  private instanceVariables: Map<string, string> = new Map();

  constructor() {
    super();
  }

  // Helper to get field info
  getFieldInfo(className: string, fieldName: string): { index: number; type: 'i32' | 'string' } | null {
    const fields = this.classFields.get(className);
    if (!fields) return null;

    const index = fields.findIndex(f => f.name === fieldName);
    if (index === -1) return null;

    return { index, type: fields[index].fieldType };
  }

  // Helper to get class fields
  getClassFields(className: string): { name: string; fieldType: 'i32' | 'string' }[] {
    return this.classFields.get(className) || [];
  }

  generateClass(classNode: ClassNode): string {
    let ir = '';
    const className = classNode.name;

    // Store field info for later lookups
    this.classFields.set(className, classNode.fields);

    // Define LLVM struct type for this class
    // Example: %Parser_struct = type { i8*, i32 } for fields [code: string, pos: number]
    if (classNode.fields.length > 0) {
      const fieldTypes = classNode.fields.map(f => f.fieldType === 'string' ? 'i8*' : 'i32');
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

  private generateConstructor(className: string, constructor: ClassMethod, fields: { name: string; fieldType: 'i32' | 'string' }[]): string {
    this.labelCounter = 0;

    // Constructor returns struct pointer (either %ClassName_struct* or i32* for backward compat)
    const structType = fields.length > 0 ? `%${className}_struct*` : 'i32*';
    let ir = `define ${structType} @${className}_constructor(`;
    ir += constructor.params.map((_, i) => `i32 %arg${i}`).join(', ');
    ir += ') {\n';
    ir += 'entry:\n';

    // Allocate stack space for parameters
    for (let i = 0; i < constructor.params.length; i++) {
      const paramName = constructor.params[i];
      const allocaReg = this.nextTemp();
      this.variables.set(paramName, allocaReg);
      this.emit(`${allocaReg} = alloca i32`);
      this.emit(`store i32 %arg${i}, i32* ${allocaReg}`);
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
        const llvmType = fields[i].fieldType === 'string' ? 'i8*' : 'i32';
        this.emit(`${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${objPtr}, i32 0, i32 ${i}`);

        if (fields[i].fieldType === 'string') {
          this.emit(`store i8* null, i8** ${fieldPtr}`);
        } else {
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

  private generateMethod(className: string, method: ClassMethod, fields: { name: string; fieldType: 'i32' | 'string' }[]): string {
    this.labelCounter = 0;

    // Method signature: first param is 'this' (struct pointer or i32* for compat)
    const thisType = fields.length > 0 ? `%${className}_struct*` : 'i32*';
    let ir = `define i32 @${className}_${method.name}(${thisType} %this`;
    if (method.params.length > 0) {
      ir += ', ';
      ir += method.params.map((_, i) => `i32 %arg${i}`).join(', ');
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

    // Allocate stack space for parameters
    for (let i = 0; i < method.params.length; i++) {
      const paramName = method.params[i];
      const allocaReg = this.nextTemp();
      this.variables.set(paramName, allocaReg);
      this.emit(`${allocaReg} = alloca i32`);
      this.emit(`store i32 %arg${i}, i32* ${allocaReg}`);
    }

    // Generate body
    const result = this.generateBlock(method.body, method.params);

    // Add generated instructions
    if (this.output.length > 0) {
      ir += this.output.map(line => '  ' + line).join('\n') + '\n';
    }

    // Return value
    if (result !== null) {
      ir += `  ret i32 ${result}\n`;
    } else {
      ir += '  ret i32 0\n';
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
    // Generate arguments
    const argValues = args.map(arg => {
      const val = this.generateExpression(arg, params);
      return `i32 ${val}`;
    }).join(', ');

    const fields = this.classFields.get(className) || [];
    const thisType = fields.length > 0 ? `%${className}_struct*` : 'i32*';

    // Call the method with instance as first argument
    const result = this.nextTemp();
    const argList = argValues ? `, ${argValues}` : '';
    this.emit(`${result} = call i32 @${className}_${methodName}(${thisType} ${instancePtr}${argList})`);

    return result;
  }
}

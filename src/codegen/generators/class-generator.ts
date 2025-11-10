import { Expression, ClassNode, ClassMethod, BlockStatement } from '../../ast/types.js';
import { BaseGenerator } from './base-generator.js';

// ============================================
// CLASS GENERATOR - Class and instance operations
// ============================================

export class ClassGenerator extends BaseGenerator {
  // Generate delegates (set by LLVMGenerator)
  generateExpression!: (expr: Expression, params: string[]) => string;
  generateBlock!: (block: BlockStatement, params: string[]) => string | null;

  // Track class structures: className -> field names
  private classFields: Map<string, string[]> = new Map();
  // Track instance variables: varName -> className
  private instanceVariables: Map<string, string> = new Map();

  generateClass(classNode: ClassNode): string {
    let ir = '';
    const className = classNode.name;

    // For simplicity, we'll use a fixed-size object representation
    // Each instance is a pointer to an array of i32 values
    // The first method (constructor) determines the number of fields

    const constructor = classNode.methods.find(m => m.isConstructor);
    const regularMethods = classNode.methods.filter(m => !m.isConstructor);

    // Generate constructor function (returns i32* - pointer to instance)
    if (constructor) {
      // Reset tempCounter before constructor
      (this as any).resetTempCounter?.();
      // Clear output by removing all elements (preserving reference)
      this.output.length = 0;
      ir += this.generateConstructor(className, constructor);
      ir += '\n';
    }

    // Generate regular methods (take i32* as first param for 'this')
    for (const method of regularMethods) {
      // Reset tempCounter before each method
      (this as any).resetTempCounter?.();
      // Clear output by removing all elements (preserving reference)
      this.output.length = 0;
      ir += this.generateMethod(className, method);
      ir += '\n';
    }

    return ir;
  }

  private generateConstructor(className: string, constructor: ClassMethod): string {
    // Don't reset tempCounter here - it's managed by the bound nextTemp method
    // which uses LLVMGenerator's tempCounter. We'll reset it in the parent.
    this.labelCounter = 0;
    // Output is synced by reference with LLVMGenerator, so we don't need to reset it here
    // The parent will reset it before generating each class

    let ir = `define i32* @${className}_constructor(`;
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

    // For now, allocate a fixed-size object (we'll improve this later)
    // Let's assume max 10 fields for simplicity
    const numFields = 10;
    const objSize = this.nextTemp();
    this.emit(`${objSize} = mul i64 ${numFields}, 4`); // 4 bytes per i32
    const objMem = this.nextTemp();
    this.emit(`${objMem} = call i8* @malloc(i64 ${objSize})`);
    const objPtr = this.nextTemp();
    this.emit(`${objPtr} = bitcast i8* ${objMem} to i32*`);

    // Initialize all fields to 0
    for (let i = 0; i < numFields; i++) {
      const fieldPtr = this.nextTemp();
      this.emit(`${fieldPtr} = getelementptr inbounds i32, i32* ${objPtr}, i32 ${i}`);
      this.emit(`store i32 0, i32* ${fieldPtr}`);
    }

    // Set 'this' pointer so constructor body can use it
    this.thisPointer = objPtr;
    
    // Execute constructor body
    // Note: generateBlock is a delegate that calls back to LLVMGenerator.generateBlock
    // We need to ensure LLVMGenerator's thisPointer is set before calling generateBlock
    // Since generateBlock checks LLVMGenerator's thisPointer, we sync it here
    // The sync happens via the shared reference - but we need to ensure it's set
    const bodyResult = this.generateBlock(constructor.body, constructor.params);
    // Constructor body result is ignored - we return the instance pointer

    // Return the instance pointer
    if (this.output.length > 0) {
      ir += this.output.map(line => '  ' + line).join('\n') + '\n';
    }
    ir += `  ret i32* ${objPtr}\n`;
    ir += '}\n';

    return ir;
  }

  private generateMethod(className: string, method: ClassMethod): string {
    // Don't reset tempCounter here - it's managed by the bound nextTemp method
    // which uses LLVMGenerator's tempCounter. We'll reset it in the parent.
    this.labelCounter = 0;
    // Output is synced by reference with LLVMGenerator, so we don't need to reset it here
    // The parent will reset it before generating each class

    // Method signature: first param is 'this' (i32*), then regular params
    let ir = `define i32 @${className}_${method.name}(i32* %this`;
    if (method.params.length > 0) {
      ir += ', ';
      ir += method.params.map((_, i) => `i32 %arg${i}`).join(', ');
    }
    ir += ') {\n';
    ir += 'entry:\n';

    // Allocate stack space for 'this' pointer and load it
    const thisAlloca = this.nextTemp();
    this.emit(`${thisAlloca} = alloca i32*`);
    this.emit(`store i32* %this, i32** ${thisAlloca}`);
    const thisLoaded = this.nextTemp();
    this.emit(`${thisLoaded} = load i32*, i32** ${thisAlloca}`);
    // Set 'this' pointer so method body can use it
    this.thisPointer = thisLoaded;

    // Allocate stack space for parameters
    for (let i = 0; i < method.params.length; i++) {
      const paramName = method.params[i];
      const allocaReg = this.nextTemp();
      this.variables.set(paramName, allocaReg);
      this.emit(`${allocaReg} = alloca i32`);
      this.emit(`store i32 %arg${i}, i32* ${allocaReg}`);
    }

    // Generate body
    // Note: generateBlock is a delegate to LLVMGenerator.generateBlock
    // It will add instructions to LLVMGenerator's output, which is synced to this.output
    const result = this.generateBlock(method.body, method.params);
    
    // Sync output back from parent (LLVMGenerator) in case it was updated
    // Since output is shared by reference via syncStateToGenerators, this should already be synced
    // But let's make sure by checking if we need to sync

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
      return `i32 ${val}`;
    }).join(', ');

    const instance = this.nextTemp();
    this.emit(`${instance} = call i32* @${className}_constructor(${argValues})`);

    return instance;
  }

  generateMethodCall(instancePtr: string, className: string, methodName: string, args: Expression[], params: string[]): string {
    // Generate arguments
    const argValues = args.map(arg => {
      const val = this.generateExpression(arg, params);
      return `i32 ${val}`;
    }).join(', ');

    // Call the method with instance as first argument
    const result = this.nextTemp();
    const argList = argValues ? `, ${argValues}` : '';
    this.emit(`${result} = call i32 @${className}_${methodName}(i32* ${instancePtr}${argList})`);

    return result;
  }
}

import { AST, Expression, FunctionNode, BlockStatement, MethodCallNode } from '../ast/types.js';
import { BaseGenerator } from './generators/base-generator.js';
import { ArrayGenerator } from './generators/array-generator.js';
import { StringGenerator } from './generators/string-generator.js';
import { ObjectGenerator } from './generators/object-generator.js';
import { ControlFlowGenerator } from './generators/control-flow-generator.js';

// ============================================
// LLVM IR CODE GENERATOR - Main Orchestrator
// ============================================

export class LLVMGenerator extends BaseGenerator {
  private ast: AST;
  private externalFunctions: Set<string> = new Set();

  // Specialized generators
  private arrayGen: ArrayGenerator;
  private stringGen: StringGenerator;
  private objectGen: ObjectGenerator;
  private controlFlowGen: ControlFlowGenerator;

  constructor(ast: AST) {
    super();
    this.ast = ast;

    // Initialize specialized generators
    this.arrayGen = new ArrayGenerator();
    this.stringGen = new StringGenerator();
    this.objectGen = new ObjectGenerator();
    this.controlFlowGen = new ControlFlowGenerator();

    // Wire up delegates so sub-generators can call back
    this.arrayGen.generateExpression = this.generateExpression.bind(this);
    this.stringGen.generateExpression = this.generateExpression.bind(this);
    this.objectGen.generateExpression = this.generateExpression.bind(this);
    this.controlFlowGen.generateExpression = this.generateExpression.bind(this);
    this.controlFlowGen.generateBlock = this.generateBlock.bind(this);

    // Override counter methods to use parent's counters
    for (const gen of [this.arrayGen, this.stringGen, this.objectGen, this.controlFlowGen]) {
      gen.nextTemp = this.nextTemp.bind(this);
      gen.nextLabel = this.nextLabel.bind(this);
      gen.nextString = this.nextString.bind(this);
    }

    // Collect all imported function names
    for (const imp of ast.imports) {
      for (const spec of imp.specifiers) {
        this.externalFunctions.add(spec);
      }
    }
  }

  generate(): string {
    let ir = '';

    // Define array struct type: { i32* data, i32 length, i32 capacity }
    ir += '%Array = type { i32*, i32, i32 }\n\n';

    // Declare external C functions for string operations
    ir += 'declare i8* @malloc(i64)\n';
    ir += 'declare void @free(i8*)\n';
    ir += 'declare i8* @strcpy(i8*, i8*)\n';
    ir += 'declare i8* @strcat(i8*, i8*)\n';
    ir += 'declare i64 @strlen(i8*)\n';
    ir += 'declare void @llvm.memcpy.p0i8.p0i8.i64(i8*, i8*, i64, i1)\n';
    ir += '\n';

    // Generate external function declarations for imports
    for (const funcName of this.externalFunctions) {
      ir += `declare i32 @${funcName}(...)\n`;
    }
    if (this.externalFunctions.size > 0) {
      ir += '\n';
    }

    // Generate function definitions
    for (const func of this.ast.functions) {
      ir += this.generateFunction(func);
      ir += '\n';
    }

    // Generate main function
    ir += this.generateMain();

    // Add global string constants at the beginning
    if (this.globalStrings.length > 0) {
      ir = this.globalStrings.join('\n') + '\n\n' + ir;
    }

    return ir;
  }

  private generateFunction(func: FunctionNode): string {
    this.reset();
    this.syncStateToGenerators();

    let ir = `define i32 @${func.name}(`;
    ir += func.params.map((_, i) => `i32 %arg${i}`).join(', ');
    ir += ') {\n';
    ir += 'entry:\n';

    // Allocate stack space for parameters so they can be treated like variables
    for (let i = 0; i < func.params.length; i++) {
      const paramName = func.params[i];
      const allocaReg = this.nextTemp();
      this.variables.set(paramName, allocaReg);
      this.emit(`${allocaReg} = alloca i32`);
      this.emit(`store i32 %arg${i}, i32* ${allocaReg}`);
    }

    // Generate body
    const result = this.generateBlock(func.body, func.params);

    // Add any instructions that were generated
    if (this.output.length > 0) {
      ir += this.output.map(line => '  ' + line).join('\n') + '\n';
    }

    // If block returned a value, use it; otherwise return 0
    if (result !== null) {
      ir += `  ret i32 ${result}\n`;
    } else {
      ir += '  ret i32 0\n';
    }
    ir += '}\n';

    return ir;
  }

  private generateBlock(block: BlockStatement, params: string[]): string | null {
    let lastValue: string | null = null;

    for (const stmt of block.statements) {
      if (stmt.type === 'variable_declaration') {
        // Determine if this is a string, array, object, or numeric value
        const isString = this.isStringExpression(stmt.value);
        const isArray = this.isArrayExpression(stmt.value);
        const isObject = this.isObjectExpression(stmt.value);

        if (isObject) {
          // Allocate stack space for object pointer (i32*) BEFORE generating the expression
          const allocaReg = this.nextTemp();
          const keys = (stmt.value as any).type === 'object' ? (stmt.value as any).properties.map((p: any) => p.key) : [];
          this.objectVariables.set(stmt.name, { ptr: allocaReg, keys });
          this.emit(`${allocaReg} = alloca i32*`);

          // Now generate the expression
          const objExpr = this.generateExpression(stmt.value, params);
          this.emit(`store i32* ${objExpr}, i32** ${allocaReg}`);
        } else if (isArray) {
          // Allocate stack space for array struct (%Array*)
          const allocaReg = this.nextTemp();
          this.arrayVariables.set(stmt.name, allocaReg);
          this.emit(`${allocaReg} = alloca %Array`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          // value is a %Array*, copy the struct
          const loadedArray = this.nextTemp();
          this.emit(`${loadedArray} = load %Array, %Array* ${value}`);
          this.emit(`store %Array ${loadedArray}, %Array* ${allocaReg}`);
        } else if (isString) {
          // Allocate stack space for string pointer (i8*)
          const allocaReg = this.nextTemp();
          this.stringVariables.set(stmt.name, allocaReg);
          this.emit(`${allocaReg} = alloca i8*`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          this.emit(`store i8* ${value}, i8** ${allocaReg}`);
        } else {
          // Allocate stack space for i32
          const allocaReg = this.nextTemp();
          this.variables.set(stmt.name, allocaReg);
          this.emit(`${allocaReg} = alloca i32`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          this.emit(`store i32 ${value}, i32* ${allocaReg}`);
        }
      } else if (stmt.type === 'assignment') {
        // Update existing variable
        const allocaReg = this.variables.get(stmt.name);
        if (!allocaReg) {
          throw new Error(`Unknown variable: ${stmt.name}`);
        }
        const value = this.generateExpression(stmt.value, params);
        this.emit(`store i32 ${value}, i32* ${allocaReg}`);
      } else if (stmt.type === 'return') {
        lastValue = this.generateExpression(stmt.value, params);
      } else if (stmt.type === 'if') {
        this.syncStateToGenerators();
        lastValue = this.controlFlowGen.generateIfStatement(stmt, params);
        // Don't need to sync back - counters are already shared via bound methods
      } else {
        // Expression statement
        lastValue = this.generateExpression(stmt, params);
      }
    }

    return lastValue;
  }

  private generateExpression(expr: Expression, params: string[]): string {
    if (expr.type === 'number') {
      return expr.value.toString();
    }

    if (expr.type === 'string') {
      this.syncStateToGenerators();
      return this.stringGen.createStringConstant(expr.value);
    }

    if (expr.type === 'array') {
      this.syncStateToGenerators();
      return this.arrayGen.generateArrayLiteral(expr, params);
    }

    if ((expr as any).type === 'object') {
      this.syncStateToGenerators();
      return this.objectGen.generateObjectLiteral(expr, params);
    }

    if (expr.type === 'variable') {
      // Check if it's an array variable
      const arrayAllocaReg = this.arrayVariables.get(expr.name);
      if (arrayAllocaReg) {
        return arrayAllocaReg;
      }

      // Check if it's a string variable
      const stringAllocaReg = this.stringVariables.get(expr.name);
      if (stringAllocaReg) {
        const temp = this.nextTemp();
        this.emit(`${temp} = load i8*, i8** ${stringAllocaReg}`);
        return temp;
      }

      // Check if it's a numeric variable
      const allocaReg = this.variables.get(expr.name);
      if (allocaReg) {
        const temp = this.nextTemp();
        this.emit(`${temp} = load i32, i32* ${allocaReg}`);
        return temp;
      }

      throw new Error(`Unknown variable: ${expr.name}`);
    }

    if (expr.type === 'member_access') {
      // Check if accessing an object property
      if (expr.object.type === 'variable' && this.objectVariables.has(expr.object.name)) {
        const objMeta = this.objectVariables.get(expr.object.name)!;
        const propIndex = objMeta.keys.indexOf(expr.property);
        if (propIndex === -1) {
          throw new Error(`Unknown property: ${expr.property} on object ${expr.object.name}`);
        }

        // Load object pointer
        const objPtrPtr = objMeta.ptr;
        const objPtr = this.nextTemp();
        this.emit(`${objPtr} = load i32*, i32** ${objPtrPtr}`);

        // Get pointer to property field
        const fieldPtr = this.nextTemp();
        this.emit(`${fieldPtr} = getelementptr inbounds i32, i32* ${objPtr}, i32 ${propIndex}`);

        // Load property value
        const value = this.nextTemp();
        this.emit(`${value} = load i32, i32* ${fieldPtr}`);
        return value;
      }

      // Handle .length property
      if (expr.property === 'length') {
        // Check if it's an array
        if (expr.object.type === 'variable' && this.arrayVariables.has(expr.object.name)) {
          const arrayPtr = this.generateExpression(expr.object, params);
          const lenPtr = this.nextTemp();
          this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
          const len = this.nextTemp();
          this.emit(`${len} = load i32, i32* ${lenPtr}`);
          return len;
        } else {
          // String length
          const objPtr = this.generateExpression(expr.object, params);
          const lenI64 = this.nextTemp();
          this.emit(`${lenI64} = call i64 @strlen(i8* ${objPtr})`);
          const lenI32 = this.nextTemp();
          this.emit(`${lenI32} = trunc i64 ${lenI64} to i32`);
          return lenI32;
        }
      }
      throw new Error(`Unknown property: ${expr.property}`);
    }

    if (expr.type === 'index_access') {
      // Check if it's an array
      if (expr.object.type === 'variable' && this.arrayVariables.has(expr.object.name)) {
        const arrayPtr = this.generateExpression(expr.object, params);
        const index = this.generateExpression(expr.index, params);

        const dataPtr = this.nextTemp();
        this.emit(`${dataPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);

        const data = this.nextTemp();
        this.emit(`${data} = load i32*, i32** ${dataPtr}`);

        const elemPtr = this.nextTemp();
        this.emit(`${elemPtr} = getelementptr inbounds i32, i32* ${data}, i32 ${index}`);

        const elem = this.nextTemp();
        this.emit(`${elem} = load i32, i32* ${elemPtr}`);
        return elem;
      } else {
        // Handle string[index] - returns character code as i32
        const objPtr = this.generateExpression(expr.object, params);
        const index = this.generateExpression(expr.index, params);

        const indexI64 = this.nextTemp();
        this.emit(`${indexI64} = sext i32 ${index} to i64`);

        const charPtr = this.nextTemp();
        this.emit(`${charPtr} = getelementptr inbounds i8, i8* ${objPtr}, i64 ${indexI64}`);

        const charI8 = this.nextTemp();
        this.emit(`${charI8} = load i8, i8* ${charPtr}`);

        const charI32 = this.nextTemp();
        this.emit(`${charI32} = zext i8 ${charI8} to i32`);

        return charI32;
      }
    }

    if (expr.type === 'unary') {
      const operand = this.generateExpression(expr.operand, params);

      if (expr.op === '!') {
        const cmpResult = this.nextTemp();
        this.emit(`${cmpResult} = icmp eq i32 ${operand}, 0`);
        const result = this.nextTemp();
        this.emit(`${result} = zext i1 ${cmpResult} to i32`);
        return result;
      }

      throw new Error(`Unknown unary operator: ${expr.op}`);
    }

    if (expr.type === 'binary') {
      // Logical operators need short-circuit evaluation
      if (expr.op === '&&' || expr.op === '||') {
        this.syncStateToGenerators();
        return this.controlFlowGen.generateLogicalOp(expr.op, expr.left, expr.right, params);
      }

      // Check for string concatenation (+ with at least one string operand)
      if (expr.op === '+' && (this.isStringExpression(expr.left) || this.isStringExpression(expr.right))) {
        this.syncStateToGenerators();
        return this.stringGen.generateStringConcat(expr.left, expr.right, params);
      }

      // Arithmetic operators
      const arithMap: { [key: string]: string } = {
        '+': 'add',
        '-': 'sub',
        '*': 'mul',
        '/': 'sdiv'
      };

      // Comparison operators (icmp returns i1, need to extend to i32)
      const cmpMap: { [key: string]: string } = {
        '<': 'slt',
        '>': 'sgt',
        '<=': 'sle',
        '>=': 'sge',
        '==': 'eq',
        '!=': 'ne'
      };

      const left = this.generateExpression(expr.left, params);
      const right = this.generateExpression(expr.right, params);

      if (arithMap[expr.op]) {
        const temp = this.nextTemp();
        const op = arithMap[expr.op];
        this.emit(`${temp} = ${op} i32 ${left}, ${right}`);
        return temp;
      } else if (cmpMap[expr.op]) {
        const cond = cmpMap[expr.op];
        const cmpResult = this.nextTemp();
        this.emit(`${cmpResult} = icmp ${cond} i32 ${left}, ${right}`);
        const extResult = this.nextTemp();
        this.emit(`${extResult} = zext i1 ${cmpResult} to i32`);
        return extResult;
      } else {
        throw new Error(`Unknown operator: ${expr.op}`);
      }
    }

    if (expr.type === 'call') {
      const args = expr.args.map(arg => {
        const result = this.generateExpression(arg, params);
        return `i32 ${result}`;
      }).join(', ');

      const temp = this.nextTemp();
      this.emit(`${temp} = call i32 @${expr.name}(${args})`);

      return temp;
    }

    if (expr.type === 'method_call') {
      return this.generateMethodCall(expr, params);
    }

    throw new Error(`Unknown expression type: ${(expr as any).type}`);
  }

  private generateMethodCall(expr: MethodCallNode, params: string[]): string {
    const method = expr.method;

    // Handle array methods
    if (method === 'push') {
      this.syncStateToGenerators();
      return this.arrayGen.generateArrayPush(expr, params);
    } else if (method === 'map') {
      this.syncStateToGenerators();
      return this.arrayGen.generateArrayMap(expr, params);
    } else if (method === 'join') {
      this.syncStateToGenerators();
      return this.arrayGen.generateArrayJoin(expr, params);
    }

    throw new Error(`Unknown method: ${method}`);
  }

  private isArrayExpression(expr: Expression): boolean {
    if (expr.type === 'array') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.arrayVariables.has(expr.name);
    }
    return false;
  }

  private isObjectExpression(expr: Expression): boolean {
    if ((expr as any).type === 'object') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.objectVariables.has(expr.name);
    }
    return false;
  }

  private isStringExpression(expr: Expression): boolean {
    if (expr.type === 'string') {
      return true;
    }
    if (expr.type === 'variable') {
      return this.stringVariables.has(expr.name);
    }
    if (expr.type === 'binary' && expr.op === '+') {
      return this.isStringExpression(expr.left) || this.isStringExpression(expr.right);
    }
    return false;
  }

  private generateMain(): string {
    let ir = 'define i32 @main() {\n';
    ir += 'entry:\n';

    if (this.ast.entryPoint) {
      this.tempCounter = 0;
      this.output = [];

      const result = this.generateExpression(this.ast.entryPoint, []);

      if (this.output.length > 0) {
        ir += this.output.map(line => '  ' + line).join('\n') + '\n';
      }

      ir += `  ret i32 ${result}\n`;
    } else {
      ir += '  ret i32 0\n';
    }

    ir += '}\n';

    return ir;
  }

  // Sync state to sub-generators - share Maps/arrays by reference
  // Note: Counters are already shared via bound methods (nextTemp, nextLabel, nextString)
  private syncStateToGenerators() {
    for (const gen of [this.arrayGen, this.stringGen, this.objectGen, this.controlFlowGen]) {
      gen.output = this.output;
      gen.globalStrings = this.globalStrings;
      gen.variables = this.variables;
      gen.stringVariables = this.stringVariables;
      gen.arrayVariables = this.arrayVariables;
      gen.objectVariables = this.objectVariables;
    }
  }
}

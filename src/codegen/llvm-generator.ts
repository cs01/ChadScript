import { AST, Expression, FunctionNode, BlockStatement, Statement, MethodCallNode } from '../ast/types.js';

// ============================================
// LLVM IR CODE GENERATOR
// ============================================

export class LLVMGenerator {
  private ast: AST;
  private tempCounter: number = 0;
  private labelCounter: number = 0;
  private stringCounter: number = 0;
  private output: string[] = [];
  private globalStrings: string[] = [];
  private variables: Map<string, string> = new Map(); // variable name -> LLVM register for i32 variables
  private stringVariables: Map<string, string> = new Map(); // variable name -> LLVM register for i8* variables
  private arrayVariables: Map<string, string> = new Map(); // variable name -> LLVM register for array structs
  private externalFunctions: Set<string> = new Set(); // Track imported functions

  constructor(ast: AST) {
    this.ast = ast;
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
    this.tempCounter = 0;
    this.labelCounter = 0;
    this.output = [];
    this.variables = new Map();
    this.stringVariables = new Map();
    this.arrayVariables = new Map();

    let ir = `define i32 @${func.name}(`;
    ir += func.params.map((_, i) => `i32 %arg${i}`).join(', ');
    ir += ') {\n';
    ir += 'entry:\n';

    // Allocate stack space for parameters so they can be treated like variables
    for (let i = 0; i < func.params.length; i++) {
      const paramName = func.params[i];
      const allocaReg = `%${this.tempCounter++}`;
      this.variables.set(paramName, allocaReg);
      this.output.push(`${allocaReg} = alloca i32`);
      this.output.push(`store i32 %arg${i}, i32* ${allocaReg}`);
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
        // Determine if this is a string, array, or numeric value
        const isString = this.isStringExpression(stmt.value);
        const isArray = this.isArrayExpression(stmt.value);

        if (isArray) {
          // Allocate stack space for array struct (%Array*)
          const allocaReg = `%${this.tempCounter++}`;
          this.arrayVariables.set(stmt.name, allocaReg);
          this.output.push(`${allocaReg} = alloca %Array`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          // value is a %Array*, copy the struct
          const loadedArray = `%${this.tempCounter++}`;
          this.output.push(`${loadedArray} = load %Array, %Array* ${value}`);
          this.output.push(`store %Array ${loadedArray}, %Array* ${allocaReg}`);
        } else if (isString) {
          // Allocate stack space for string pointer (i8*)
          const allocaReg = `%${this.tempCounter++}`;
          this.stringVariables.set(stmt.name, allocaReg);
          this.output.push(`${allocaReg} = alloca i8*`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          this.output.push(`store i8* ${value}, i8** ${allocaReg}`);
        } else {
          // Allocate stack space for i32
          const allocaReg = `%${this.tempCounter++}`;
          this.variables.set(stmt.name, allocaReg);
          this.output.push(`${allocaReg} = alloca i32`);

          // Compute initial value and store it
          const value = this.generateExpression(stmt.value, params);
          this.output.push(`store i32 ${value}, i32* ${allocaReg}`);
        }
      } else if (stmt.type === 'assignment') {
        // Update existing variable
        const allocaReg = this.variables.get(stmt.name);
        if (!allocaReg) {
          throw new Error(`Unknown variable: ${stmt.name}`);
        }
        const value = this.generateExpression(stmt.value, params);
        this.output.push(`store i32 ${value}, i32* ${allocaReg}`);
      } else if (stmt.type === 'return') {
        lastValue = this.generateExpression(stmt.value, params);
      } else if (stmt.type === 'if') {
        lastValue = this.generateIfStatement(stmt, params);
      } else {
        // Expression statement
        lastValue = this.generateExpression(stmt, params);
      }
    }

    return lastValue;
  }

  private generateLogicalOp(op: string, left: Expression, right: Expression, params: string[]): string {
    // For && and ||, we need short-circuit evaluation
    // We'll use a simpler non-short-circuit version for now (like C's & and |)
    const leftValue = this.generateExpression(left, params);
    const rightValue = this.generateExpression(right, params);

    // Convert both to booleans (0 or 1)
    const leftBool = `%${this.tempCounter++}`;
    this.output.push(`${leftBool} = icmp ne i32 ${leftValue}, 0`);
    const leftInt = `%${this.tempCounter++}`;
    this.output.push(`${leftInt} = zext i1 ${leftBool} to i32`);

    const rightBool = `%${this.tempCounter++}`;
    this.output.push(`${rightBool} = icmp ne i32 ${rightValue}, 0`);
    const rightInt = `%${this.tempCounter++}`;
    this.output.push(`${rightInt} = zext i1 ${rightBool} to i32`);

    if (op === '&&') {
      // Both must be non-zero
      const result = `%${this.tempCounter++}`;
      this.output.push(`${result} = mul i32 ${leftInt}, ${rightInt}`);
      return result;
    } else {
      // At least one must be non-zero (add and clamp to 1)
      const sum = `%${this.tempCounter++}`;
      this.output.push(`${sum} = add i32 ${leftInt}, ${rightInt}`);
      const cmp = `%${this.tempCounter++}`;
      this.output.push(`${cmp} = icmp ne i32 ${sum}, 0`);
      const result = `%${this.tempCounter++}`;
      this.output.push(`${result} = zext i1 ${cmp} to i32`);
      return result;
    }
  }

  private generateIfStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== 'if') {
      throw new Error('Expected if statement');
    }

    // Generate unique labels
    const thenLabel = `then${this.labelCounter}`;
    const elseLabel = `else${this.labelCounter}`;
    const mergeLabel = `merge${this.labelCounter}`;
    this.labelCounter++;

    // Evaluate condition
    const condValue = this.generateExpression(stmt.condition, params);

    // Convert i32 to i1 for branch (non-zero is true)
    const condBool = `%${this.tempCounter++}`;
    this.output.push(`${condBool} = icmp ne i32 ${condValue}, 0`);

    // Branch based on condition
    if (stmt.elseBlock) {
      this.output.push(`br i1 ${condBool}, label %${thenLabel}, label %${elseLabel}`);
    } else {
      this.output.push(`br i1 ${condBool}, label %${thenLabel}, label %${mergeLabel}`);
    }

    // Generate then block
    this.output.push(`${thenLabel}:`);
    const savedOutputLen = this.output.length;
    const thenValue = this.generateBlock(stmt.thenBlock, params);
    const thenHasTerminator = this.output.slice(savedOutputLen).some(line =>
      line.trim().startsWith('ret ') || line.trim().startsWith('br ')
    );
    if (!thenHasTerminator) {
      this.output.push(`br label %${mergeLabel}`);
    }

    // Generate else block if it exists
    let elseValue: string | null = null;
    if (stmt.elseBlock) {
      this.output.push(`${elseLabel}:`);
      const savedOutputLen2 = this.output.length;
      elseValue = this.generateBlock(stmt.elseBlock, params);
      const elseHasTerminator = this.output.slice(savedOutputLen2).some(line =>
        line.trim().startsWith('ret ') || line.trim().startsWith('br ')
      );
      if (!elseHasTerminator) {
        this.output.push(`br label %${mergeLabel}`);
      }
    }

    // Merge point
    this.output.push(`${mergeLabel}:`);

    // If both branches produce values, we need a phi node
    if (thenValue && elseValue) {
      const result = `%${this.tempCounter++}`;
      this.output.push(`${result} = phi i32 [ ${thenValue}, %${thenLabel} ], [ ${elseValue}, %${elseLabel} ]`);
      return result;
    }

    return '0';
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

  private isStringExpression(expr: Expression): boolean {
    // Check if expression will result in a string (i8*)
    if (expr.type === 'string') {
      return true;
    }
    if (expr.type === 'variable') {
      // Check if variable is a string variable
      return this.stringVariables.has(expr.name);
    }
    if (expr.type === 'binary' && expr.op === '+') {
      // If either operand is a string, treat as string concatenation
      return this.isStringExpression(expr.left) || this.isStringExpression(expr.right);
    }
    // member_access and index_access on strings return numbers
    // Other types return numbers
    return false;
  }

  private createStringConstant(value: string): string {
    // Escape special characters for LLVM
    const escaped = value
      .replace(/\\/g, '\\5C')
      .replace(/\n/g, '\\0A')
      .replace(/\t/g, '\\09')
      .replace(/\r/g, '\\0D')
      .replace(/"/g, '\\"');

    const length = value.length + 1; // +1 for null terminator
    const globalName = `@.str.${this.stringCounter++}`;

    // Create global constant string
    this.globalStrings.push(
      `${globalName} = private unnamed_addr constant [${length} x i8] c"${escaped}\\00", align 1`
    );

    // Return a pointer to the string
    const ptrReg = `%${this.tempCounter++}`;
    this.output.push(
      `${ptrReg} = getelementptr inbounds [${length} x i8], [${length} x i8]* ${globalName}, i64 0, i64 0`
    );
    return ptrReg;
  }

  private generateExpression(expr: Expression, params: string[]): string {
    if (expr.type === 'number') {
      return expr.value.toString();
    }

    if (expr.type === 'string') {
      return this.createStringConstant(expr.value);
    }

    if (expr.type === 'array') {
      return this.generateArrayLiteral(expr, params);
    }

    if (expr.type === 'variable') {
      // Check if it's an array variable
      const arrayAllocaReg = this.arrayVariables.get(expr.name);
      if (arrayAllocaReg) {
        // Return pointer to array struct
        return arrayAllocaReg;
      }

      // Check if it's a string variable
      const stringAllocaReg = this.stringVariables.get(expr.name);
      if (stringAllocaReg) {
        // Load string pointer from stack
        const temp = `%${this.tempCounter++}`;
        this.output.push(`${temp} = load i8*, i8** ${stringAllocaReg}`);
        return temp;
      }

      // Check if it's a numeric variable
      const allocaReg = this.variables.get(expr.name);
      if (allocaReg) {
        // Load from stack
        const temp = `%${this.tempCounter++}`;
        this.output.push(`${temp} = load i32, i32* ${allocaReg}`);
        return temp;
      }

      throw new Error(`Unknown variable: ${expr.name}`);
    }

    if (expr.type === 'member_access') {
      // Handle .length property
      if (expr.property === 'length') {
        // Check if it's an array
        if (expr.object.type === 'variable' && this.arrayVariables.has(expr.object.name)) {
          const arrayPtr = this.generateExpression(expr.object, params);
          // Get pointer to length field (index 1)
          const lenPtr = `%${this.tempCounter++}`;
          this.output.push(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
          // Load length
          const len = `%${this.tempCounter++}`;
          this.output.push(`${len} = load i32, i32* ${lenPtr}`);
          return len;
        } else {
          // String length
          const objPtr = this.generateExpression(expr.object, params);
          // Call strlen and convert i64 to i32
          const lenI64 = `%${this.tempCounter++}`;
          this.output.push(`${lenI64} = call i64 @strlen(i8* ${objPtr})`);
          const lenI32 = `%${this.tempCounter++}`;
          this.output.push(`${lenI32} = trunc i64 ${lenI64} to i32`);
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

        // Get pointer to data field (index 0)
        const dataPtr = `%${this.tempCounter++}`;
        this.output.push(`${dataPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);

        // Load the data pointer
        const data = `%${this.tempCounter++}`;
        this.output.push(`${data} = load i32*, i32** ${dataPtr}`);

        // Get pointer to element
        const elemPtr = `%${this.tempCounter++}`;
        this.output.push(`${elemPtr} = getelementptr inbounds i32, i32* ${data}, i32 ${index}`);

        // Load element
        const elem = `%${this.tempCounter++}`;
        this.output.push(`${elem} = load i32, i32* ${elemPtr}`);
        return elem;
      } else {
        // Handle string[index] - returns character code as i32
        const objPtr = this.generateExpression(expr.object, params);
        const index = this.generateExpression(expr.index, params);

        // Convert index to i64 for GEP
        const indexI64 = `%${this.tempCounter++}`;
        this.output.push(`${indexI64} = sext i32 ${index} to i64`);

        // Get pointer to character
        const charPtr = `%${this.tempCounter++}`;
        this.output.push(`${charPtr} = getelementptr inbounds i8, i8* ${objPtr}, i64 ${indexI64}`);

        // Load the character
        const charI8 = `%${this.tempCounter++}`;
        this.output.push(`${charI8} = load i8, i8* ${charPtr}`);

        // Extend to i32
        const charI32 = `%${this.tempCounter++}`;
        this.output.push(`${charI32} = zext i8 ${charI8} to i32`);

        return charI32;
      }
    }

    if (expr.type === 'unary') {
      const operand = this.generateExpression(expr.operand, params);

      if (expr.op === '!') {
        // Convert to boolean (non-zero is true)
        const cmpResult = `%${this.tempCounter++}`;
        this.output.push(`${cmpResult} = icmp eq i32 ${operand}, 0`);
        // Extend back to i32 (0 or 1)
        const result = `%${this.tempCounter++}`;
        this.output.push(`${result} = zext i1 ${cmpResult} to i32`);
        return result;
      }

      throw new Error(`Unknown unary operator: ${expr.op}`);
    }

    if (expr.type === 'binary') {
      // Logical operators need short-circuit evaluation
      if (expr.op === '&&' || expr.op === '||') {
        return this.generateLogicalOp(expr.op, expr.left, expr.right, params);
      }

      // Check for string concatenation (+ with at least one string operand)
      if (expr.op === '+' && (this.isStringExpression(expr.left) || this.isStringExpression(expr.right))) {
        return this.generateStringConcat(expr.left, expr.right, params);
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
        const temp = `%${this.tempCounter++}`;
        const op = arithMap[expr.op];
        this.output.push(`${temp} = ${op} i32 ${left}, ${right}`);
        return temp;
      } else if (cmpMap[expr.op]) {
        const cond = cmpMap[expr.op];
        const cmpResult = `%${this.tempCounter++}`;
        this.output.push(`${cmpResult} = icmp ${cond} i32 ${left}, ${right}`);
        // Extend i1 to i32 (0 or 1)
        const extResult = `%${this.tempCounter++}`;
        this.output.push(`${extResult} = zext i1 ${cmpResult} to i32`);
        return extResult;
      } else {
        throw new Error(`Unknown operator: ${expr.op}`);
      }
    }

    if (expr.type === 'call') {
      // Generate arguments
      const args = expr.args.map(arg => {
        const result = this.generateExpression(arg, params);
        return `i32 ${result}`;
      }).join(', ');

      const temp = `%${this.tempCounter++}`;
      this.output.push(`${temp} = call i32 @${expr.name}(${args})`);

      return temp;
    }

    if (expr.type === 'method_call') {
      return this.generateMethodCall(expr, params);
    }

    throw new Error(`Unknown expression type: ${(expr as any).type}`);
  }

  private generateArrayLiteral(expr: Expression, params: string[]): string {
    if (expr.type !== 'array') {
      throw new Error('Expected array literal');
    }

    const length = expr.elements.length;

    // Allocate array struct on stack
    const arrayPtr = `%${this.tempCounter++}`;
    this.output.push(`${arrayPtr} = alloca %Array`);

    // Allocate data array on heap (i32* with length elements)
    const dataSize = `%${this.tempCounter++}`;
    this.output.push(`${dataSize} = mul i64 ${length}, 4`); // 4 bytes per i32
    const dataMem = `%${this.tempCounter++}`;
    this.output.push(`${dataMem} = call i8* @malloc(i64 ${dataSize})`);
    const dataPtr = `%${this.tempCounter++}`;
    this.output.push(`${dataPtr} = bitcast i8* ${dataMem} to i32*`);

    // Store each element
    for (let i = 0; i < expr.elements.length; i++) {
      const elemValue = this.generateExpression(expr.elements[i], params);
      const elemPtr = `%${this.tempCounter++}`;
      this.output.push(`${elemPtr} = getelementptr inbounds i32, i32* ${dataPtr}, i32 ${i}`);
      this.output.push(`store i32 ${elemValue}, i32* ${elemPtr}`);
    }

    // Store data pointer in array struct (field 0)
    const dataPtrField = `%${this.tempCounter++}`;
    this.output.push(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    this.output.push(`store i32* ${dataPtr}, i32** ${dataPtrField}`);

    // Store length in array struct (field 1)
    const lenField = `%${this.tempCounter++}`;
    this.output.push(`${lenField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    this.output.push(`store i32 ${length}, i32* ${lenField}`);

    // Store capacity in array struct (field 2)
    const capField = `%${this.tempCounter++}`;
    this.output.push(`${capField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
    this.output.push(`store i32 ${length}, i32* ${capField}`);

    return arrayPtr;
  }

  private generateStringConcat(left: Expression, right: Expression, params: string[]): string {
    // Generate both operands as strings
    const leftStr = this.generateExpression(left, params);
    const rightStr = this.generateExpression(right, params);

    // Get lengths of both strings
    const leftLen = `%${this.tempCounter++}`;
    this.output.push(`${leftLen} = call i64 @strlen(i8* ${leftStr})`);
    const rightLen = `%${this.tempCounter++}`;
    this.output.push(`${rightLen} = call i64 @strlen(i8* ${rightStr})`);

    // Calculate total length (left + right + 1 for null terminator)
    const totalLen = `%${this.tempCounter++}`;
    this.output.push(`${totalLen} = add i64 ${leftLen}, ${rightLen}`);
    const totalLenPlus1 = `%${this.tempCounter++}`;
    this.output.push(`${totalLenPlus1} = add i64 ${totalLen}, 1`);

    // Allocate memory for result
    const resultPtr = `%${this.tempCounter++}`;
    this.output.push(`${resultPtr} = call i8* @malloc(i64 ${totalLenPlus1})`);

    // Copy left string to result
    const copyResult1 = `%${this.tempCounter++}`;
    this.output.push(`${copyResult1} = call i8* @strcpy(i8* ${resultPtr}, i8* ${leftStr})`);

    // Concatenate right string to result
    const concatResult = `%${this.tempCounter++}`;
    this.output.push(`${concatResult} = call i8* @strcat(i8* ${resultPtr}, i8* ${rightStr})`);

    return resultPtr;
  }

  private generateMethodCall(expr: MethodCallNode, params: string[]): string {
    const method = expr.method;

    // Handle array methods
    if (method === 'push') {
      return this.generateArrayPush(expr, params);
    } else if (method === 'map') {
      return this.generateArrayMap(expr, params);
    } else if (method === 'join') {
      return this.generateArrayJoin(expr, params);
    }

    throw new Error(`Unknown method: ${method}`);
  }

  private generateArrayPush(expr: MethodCallNode, params: string[]): string {
    // arr.push(value) - adds value to array and returns new length
    if (expr.args.length !== 1) {
      throw new Error('push() requires exactly 1 argument');
    }

    const arrayPtr = this.generateExpression(expr.object, params);
    const value = this.generateExpression(expr.args[0], params);

    // Load current length
    const lenPtr = `%${this.tempCounter++}`;
    this.output.push(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const currentLen = `%${this.tempCounter++}`;
    this.output.push(`${currentLen} = load i32, i32* ${lenPtr}`);

    // Load current capacity
    const capPtr = `%${this.tempCounter++}`;
    this.output.push(`${capPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
    const currentCap = `%${this.tempCounter++}`;
    this.output.push(`${currentCap} = load i32, i32* ${capPtr}`);

    // Check if we need to resize (length == capacity)
    const needResize = `%${this.tempCounter++}`;
    this.output.push(`${needResize} = icmp eq i32 ${currentLen}, ${currentCap}`);

    // Create labels for resize and continue paths
    const resizeLabel = `resize${this.labelCounter}`;
    const continueLabel = `continue${this.labelCounter}`;
    this.labelCounter++;

    this.output.push(`br i1 ${needResize}, label %${resizeLabel}, label %${continueLabel}`);

    // Resize block
    this.output.push(`${resizeLabel}:`);
    const newCap = `%${this.tempCounter++}`;
    this.output.push(`${newCap} = mul i32 ${currentCap}, 2`);

    // Allocate new data array
    const newSize = `%${this.tempCounter++}`;
    this.output.push(`${newSize} = mul i32 ${newCap}, 4`);
    const newSizeI64 = `%${this.tempCounter++}`;
    this.output.push(`${newSizeI64} = zext i32 ${newSize} to i64`);
    const newMem = `%${this.tempCounter++}`;
    this.output.push(`${newMem} = call i8* @malloc(i64 ${newSizeI64})`);
    const newDataPtr = `%${this.tempCounter++}`;
    this.output.push(`${newDataPtr} = bitcast i8* ${newMem} to i32*`);

    // Copy old data to new array
    const dataPtrField = `%${this.tempCounter++}`;
    this.output.push(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const oldDataPtr = `%${this.tempCounter++}`;
    this.output.push(`${oldDataPtr} = load i32*, i32** ${dataPtrField}`);

    const oldDataI8 = `%${this.tempCounter++}`;
    this.output.push(`${oldDataI8} = bitcast i32* ${oldDataPtr} to i8*`);
    const newDataI8 = `%${this.tempCounter++}`;
    this.output.push(`${newDataI8} = bitcast i32* ${newDataPtr} to i8*`);
    const copySize = `%${this.tempCounter++}`;
    this.output.push(`${copySize} = mul i32 ${currentLen}, 4`);
    const copySizeI64 = `%${this.tempCounter++}`;
    this.output.push(`${copySizeI64} = zext i32 ${copySize} to i64`);
    this.output.push(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySizeI64}, i1 false)`);

    // Free old data and update pointer
    this.output.push(`call void @free(i8* ${oldDataI8})`);
    this.output.push(`store i32* ${newDataPtr}, i32** ${dataPtrField}`);

    // Update capacity
    this.output.push(`store i32 ${newCap}, i32* ${capPtr}`);

    this.output.push(`br label %${continueLabel}`);

    // Continue block
    this.output.push(`${continueLabel}:`);

    // Get current data pointer (may have been updated)
    const dataPtrField2 = `%${this.tempCounter++}`;
    this.output.push(`${dataPtrField2} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = `%${this.tempCounter++}`;
    this.output.push(`${dataPtr} = load i32*, i32** ${dataPtrField2}`);

    // Store value at current length index
    const elemPtr = `%${this.tempCounter++}`;
    this.output.push(`${elemPtr} = getelementptr inbounds i32, i32* ${dataPtr}, i32 ${currentLen}`);
    this.output.push(`store i32 ${value}, i32* ${elemPtr}`);

    // Increment length
    const newLen = `%${this.tempCounter++}`;
    this.output.push(`${newLen} = add i32 ${currentLen}, 1`);
    this.output.push(`store i32 ${newLen}, i32* ${lenPtr}`);

    // Return new length
    return newLen;
  }

  private generateArrayMap(expr: MethodCallNode, params: string[]): string {
    // For now, we'll implement a simple version that doesn't support callback functions
    // This is a placeholder that will need proper function pointer support
    throw new Error('map() method requires function pointer support (not yet implemented)');
  }

  private generateArrayJoin(expr: MethodCallNode, params: string[]): string {
    // arr.join(separator) - returns a string (i8*)
    // For simplicity, we'll implement join with a string separator
    if (expr.args.length !== 1) {
      throw new Error('join() requires exactly 1 argument (separator)');
    }

    const arrayPtr = this.generateExpression(expr.object, params);
    const separator = this.generateExpression(expr.args[0], params);

    // Get array length
    const lenPtr = `%${this.tempCounter++}`;
    this.output.push(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const length = `%${this.tempCounter++}`;
    this.output.push(`${length} = load i32, i32* ${lenPtr}`);

    // Get data pointer
    const dataPtrField = `%${this.tempCounter++}`;
    this.output.push(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = `%${this.tempCounter++}`;
    this.output.push(`${dataPtr} = load i32*, i32** ${dataPtrField}`);

    // For simplicity, we'll allocate a fixed-size buffer for the result
    // In a real implementation, we'd calculate the exact size needed
    const bufferSize = 1024; // Fixed size for demo
    const resultBuffer = `%${this.tempCounter++}`;
    this.output.push(`${resultBuffer} = call i8* @malloc(i64 ${bufferSize})`);

    // Initialize buffer with empty string
    const nullByte = `%${this.tempCounter++}`;
    this.output.push(`${nullByte} = getelementptr inbounds i8, i8* ${resultBuffer}, i64 0`);
    this.output.push(`store i8 0, i8* ${nullByte}`);

    // For now, return a simple implementation that concatenates numbers
    // A complete implementation would need sprintf or similar to convert i32 to string
    // This is a simplified placeholder
    return resultBuffer;
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
}

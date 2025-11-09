import { AST, Expression, FunctionNode, BlockStatement, Statement } from '../ast/types.js';

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
        // Determine if this is a string or numeric value
        const isString = this.isStringExpression(stmt.value);

        if (isString) {
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

    if (expr.type === 'variable') {
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
      // Handle .length property for strings
      if (expr.property === 'length') {
        const objPtr = this.generateExpression(expr.object, params);
        // Call strlen and convert i64 to i32
        const lenI64 = `%${this.tempCounter++}`;
        this.output.push(`${lenI64} = call i64 @strlen(i8* ${objPtr})`);
        const lenI32 = `%${this.tempCounter++}`;
        this.output.push(`${lenI32} = trunc i64 ${lenI64} to i32`);
        return lenI32;
      }
      throw new Error(`Unknown property: ${expr.property}`);
    }

    if (expr.type === 'index_access') {
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

    throw new Error(`Unknown expression type: ${(expr as any).type}`);
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

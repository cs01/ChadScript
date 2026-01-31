import { Expression, Statement, BlockStatement } from '../../ast/types.js';
import { IGeneratorContext } from '../infrastructure/generator-context.js';
import { SymbolKind } from '../infrastructure/symbol-table.js';

// ============================================
// CONTROL FLOW GENERATOR - If/while/loops
// ============================================

export class ControlFlowGenerator {
  // Loop context stack for break/continue
  private loopStack: Array<{ continueLabel: string; breakLabel: string }> = [];

  constructor(private ctx: IGeneratorContext) {}

  // Helper methods delegate to context
  private nextTemp() { return this.ctx.nextTemp(); }
  private nextLabel(prefix: string) { return this.ctx.nextLabel(prefix); }
  private emit(instruction: string) { this.ctx.emit(instruction); }
  private get output() { return this.ctx.output; }
  private get variableTypes() { return this.ctx.variableTypes; }
  private get currentLabel() { return this.ctx.currentLabel; }
  private set currentLabel(label: string) { this.ctx.currentLabel = label; }

  // Helper to convert a value to boolean (i1) for branching
  private convertToBool(value: string): string {
    // Check if value is a double or i32 based on variable types
    const valueType = this.ctx.getVariableType(value);

    if (valueType === 'double' || (value.includes('.') && !value.startsWith('%'))) {
      // Value is a double, use fcmp
      const condBool = this.nextTemp();
      this.emit(`${condBool} = fcmp one double ${value}, 0.0`);
      return condBool;
    } else {
      // Value is i32 or unknown (assume i32), convert to double then use fcmp
      const condDouble = this.nextTemp();
      this.emit(`${condDouble} = sitofp i32 ${value} to double`);
      const condBool = this.nextTemp();
      this.emit(`${condBool} = fcmp one double ${condDouble}, 0.0`);
      return condBool;
    }
  }

  generateIfStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== 'if') {
      throw new Error('Expected if statement');
    }

    // Generate unique labels
    const thenLabel = this.nextLabel('then');
    const elseLabel = this.nextLabel('else');
    const mergeLabel = this.nextLabel('merge');

    // Evaluate condition
    const condValue = this.ctx.generateExpression(stmt.condition, params);

    // Convert to boolean for branching
    const condBool = this.convertToBool(condValue);

    // Branch based on condition
    if (stmt.elseBlock) {
      this.emit(`br i1 ${condBool}, label %${thenLabel}, label %${elseLabel}`);
    } else {
      this.emit(`br i1 ${condBool}, label %${thenLabel}, label %${mergeLabel}`);
    }

    // Generate then block
    this.emit(`${thenLabel}:`);
    this.currentLabel = thenLabel;
    const thenValue = this.ctx.generateBlock(stmt.thenBlock, params);
    // Check if the LAST instruction is a terminator
    const lastInstruction = this.output[this.output.length - 1]?.trim() || '';
    const thenHasTerminator = lastInstruction.startsWith('ret ') ||
                              lastInstruction.startsWith('br ') ||
                              lastInstruction.startsWith('unreachable') ||
                              lastInstruction.startsWith('switch ');
    // Find the actual last label by scanning backwards in the output
    let thenEndLabel = thenLabel;
    for (let i = this.output.length - 1; i >= 0; i--) {
      const line = this.output[i].trim();
      if (line.match(/^[a-z_]+[0-9]+:$/)) {
        thenEndLabel = line.slice(0, -1); // Remove the trailing ':'
        break;
      }
    }
    if (!thenHasTerminator) {
      this.emit(`br label %${mergeLabel}`);
    }

    // Generate else block if it exists
    let elseValue: string | null = null;
    let elseEndLabel = elseLabel;
    let elseHasTerminator = false;
    if (stmt.elseBlock) {
      this.emit(`${elseLabel}:`);
      this.currentLabel = elseLabel;
      elseValue = this.ctx.generateBlock(stmt.elseBlock, params);
      // Check if the LAST instruction is a terminator
      const lastInstruction = this.output[this.output.length - 1]?.trim() || '';
      elseHasTerminator = lastInstruction.startsWith('ret ') ||
                                lastInstruction.startsWith('br ') ||
                                lastInstruction.startsWith('unreachable') ||
                                lastInstruction.startsWith('switch ');
      // Find the actual last label by scanning backwards in the output
      for (let i = this.output.length - 1; i >= 0; i--) {
        const line = this.output[i].trim();
        if (line.match(/^[a-z_]+[0-9]+:$/)) {
          elseEndLabel = line.slice(0, -1); // Remove the trailing ':'
          break;
        }
      }
      if (!elseHasTerminator) {
        this.emit(`br label %${mergeLabel}`);
      }
    }

    // Skip merge point if both branches have terminators (unreachable code)
    if (stmt.elseBlock && thenHasTerminator && elseHasTerminator) {
      // Both branches return/terminate, no merge point needed
      // Return a default value (we won't use it anyway)
      return '0';
    }

    // Merge point
    this.emit(`${mergeLabel}:`);
    this.currentLabel = mergeLabel;

    // If both branches produce values, we need a phi node
    if (thenValue && elseValue) {
      const result = this.nextTemp();
      const thenType = this.ctx.getVariableType(thenValue);
      const elseType = this.ctx.getVariableType(elseValue);
      const phiType = (thenType === 'double' || elseType === 'double') ? 'double' : 'i32';

      let finalThenValue = thenValue;
      let finalElseValue = elseValue;

      if (phiType === 'double') {
        if (thenType === 'i32') {
          const thenPos = this.findBranchPosition(thenEndLabel);
          if (thenPos >= 0) {
            finalThenValue = this.nextTemp();
            this.output.splice(thenPos, 0, `  ${finalThenValue} = sitofp i32 ${thenValue} to double`);
            this.variableTypes.set(finalThenValue, 'double');
          }
        } else if (!thenType && /^-?\d+$/.test(thenValue)) {
          finalThenValue = thenValue + '.0';
        }
        if (elseType === 'i32') {
          const elsePos = this.findBranchPosition(elseEndLabel);
          if (elsePos >= 0) {
            const insertPos = (thenType === 'i32') ? elsePos + 1 : elsePos;
            finalElseValue = this.nextTemp();
            this.output.splice(insertPos, 0, `  ${finalElseValue} = sitofp i32 ${elseValue} to double`);
            this.variableTypes.set(finalElseValue, 'double');
          }
        } else if (!elseType && /^-?\d+$/.test(elseValue)) {
          finalElseValue = elseValue + '.0';
        }
      }

      this.emit(`${result} = phi ${phiType} [ ${finalThenValue}, %${thenEndLabel} ], [ ${finalElseValue}, %${elseEndLabel} ]`);
      this.variableTypes.set(result, phiType);
      return result;
    }

    return '0';
  }

  private findBranchPosition(label: string): number {
    for (let i = this.output.length - 1; i >= 0; i--) {
      const line = this.output[i].trim();
      if (line.startsWith('br label %') && this.output.slice(0, i).some(l => l.trim() === `${label}:`)) {
        let foundLabel = false;
        for (let j = i - 1; j >= 0; j--) {
          if (this.output[j].trim() === `${label}:`) {
            foundLabel = true;
            break;
          }
          if (this.output[j].trim().match(/^[a-z_]+[0-9]*:$/)) {
            break;
          }
        }
        if (foundLabel) {
          return i;
        }
      }
    }
    return -1;
  }

  generateWhileStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== 'while') {
      throw new Error('Expected while statement');
    }

    // Generate unique labels
    const condLabel = this.nextLabel('while_cond');
    const bodyLabel = this.nextLabel('while_body');
    const endLabel = this.nextLabel('while_end');

    // Jump to condition check
    this.emit(`br label %${condLabel}`);

    // Condition block
    this.emit(`${condLabel}:`);
    const condValue = this.ctx.generateExpression(stmt.condition, params);
    const condBool = this.convertToBool(condValue);
    this.emit(`br i1 ${condBool}, label %${bodyLabel}, label %${endLabel}`);

    // Body block - push loop context for break/continue
    this.emit(`${bodyLabel}:`);
    this.currentLabel = bodyLabel;
    this.loopStack.push({ continueLabel: condLabel, breakLabel: endLabel });
    this.ctx.generateBlock(stmt.body, params);
    this.loopStack.pop();
    // Check if the LAST instruction is a terminator
    const lastInstruction = this.output[this.output.length - 1]?.trim() || '';
    const bodyHasTerminator = lastInstruction.startsWith('ret ') ||
                              lastInstruction.startsWith('br ') ||
                              lastInstruction.startsWith('unreachable') ||
                              lastInstruction.startsWith('switch ');
    if (!bodyHasTerminator) {
      this.emit(`br label %${condLabel}`);
    }

    // End block
    this.emit(`${endLabel}:`);

    return '0';
  }

  generateForStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== 'for') {
      throw new Error('Expected for statement');
    }

    // Generate init if present
    if (stmt.init) {
      if (stmt.init.type === 'variable_declaration') {
        // Handle variable declaration - allocate and store
        if (!stmt.init.value) {
          throw new Error('Variable declaration in for loop must have an initializer');
        }
        const value = this.ctx.generateExpression(stmt.init.value, params);
        const allocaReg = this.nextTemp();
        // Register the variable in the variables map
        this.ctx.defineVariable(stmt.init.name, allocaReg, 'double', SymbolKind.Number, 'local');
        this.emit(`${allocaReg} = alloca double`);
        this.emit(`store double ${value}, double* ${allocaReg}`);
      } else if (stmt.init.type === 'assignment') {
        const value = this.ctx.generateExpression(stmt.init.value, params);
        const allocaReg = this.ctx.getVariableAlloca(stmt.init.name);
        if (!allocaReg) {
          throw new Error(`Variable ${stmt.init.name} not found`);
        }
        const varType = this.ctx.getVariableType(stmt.init.name) || 'double';
        this.emit(`store ${varType} ${value}, ${varType}* ${allocaReg}`);
      }
    }

    // Generate unique labels
    const condLabel = this.nextLabel('for_cond');
    const bodyLabel = this.nextLabel('for_body');
    const updateLabel = this.nextLabel('for_update');
    const endLabel = this.nextLabel('for_end');

    // Jump to condition check
    this.emit(`br label %${condLabel}`);

    // Condition block
    this.emit(`${condLabel}:`);
    if (stmt.condition) {
      const condValue = this.ctx.generateExpression(stmt.condition, params);
      const condBool = this.convertToBool(condValue);
      this.emit(`br i1 ${condBool}, label %${bodyLabel}, label %${endLabel}`);
    } else {
      // No condition means infinite loop
      this.emit(`br label %${bodyLabel}`);
    }

    // Body block - push loop context for break/continue
    this.emit(`${bodyLabel}:`);
    this.currentLabel = bodyLabel;
    this.loopStack.push({ continueLabel: updateLabel, breakLabel: endLabel });
    this.ctx.generateBlock(stmt.body, params);
    this.loopStack.pop();
    // Check if the LAST instruction is a terminator
    const lastInstruction = this.output[this.output.length - 1]?.trim() || '';
    const bodyHasTerminator = lastInstruction.startsWith('ret ') ||
                              lastInstruction.startsWith('br ') ||
                              lastInstruction.startsWith('unreachable') ||
                              lastInstruction.startsWith('switch ');
    if (!bodyHasTerminator) {
      this.emit(`br label %${updateLabel}`);
    }

    // Update block
    this.emit(`${updateLabel}:`);
    if (stmt.update) {
      if (stmt.update.type === 'assignment') {
        const value = this.ctx.generateExpression(stmt.update.value, params);
        const allocaReg = this.ctx.getVariableAlloca(stmt.update.name);
        if (!allocaReg) {
          throw new Error(`Variable ${stmt.update.name} not found in update`);
        }
        const varType = this.ctx.getVariableType(stmt.update.name) || 'double';
        this.emit(`store ${varType} ${value}, ${varType}* ${allocaReg}`);
      } else {
        // It's an expression (like i++)
        this.ctx.generateExpression(stmt.update, params);
      }
    }
    this.emit(`br label %${condLabel}`);

    // End block
    this.emit(`${endLabel}:`);

    return '0';
  }

  generateForOfStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== 'for_of') {
      throw new Error('Expected for...of statement');
    }

    // Evaluate the iterable expression
    const iterableValue = this.ctx.generateExpression(stmt.iterable, params);

    // Determine if it's a string array or numeric array
    const isStringArray = this.ctx.isStringArrayExpression(stmt.iterable);
    const arrayType = isStringArray ? '%StringArray' : '%Array';
    const elementType = isStringArray ? 'i8*' : 'double';
    const elementKind = isStringArray ? SymbolKind.String : SymbolKind.Number;

    // Get the array length
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds ${arrayType}, ${arrayType}* ${iterableValue}, i32 0, i32 1`);
    const lengthI32 = this.nextTemp();
    this.emit(`${lengthI32} = load i32, i32* ${lenPtr}`);

    // Create index variable (i32)
    const indexAlloca = this.nextTemp();
    this.emit(`${indexAlloca} = alloca i32`);
    this.emit(`store i32 0, i32* ${indexAlloca}`);

    // Create loop variable for the current element
    const elemAlloca = this.nextTemp();
    this.emit(`${elemAlloca} = alloca ${elementType}`);

    // Register the loop variable
    this.ctx.defineVariable(stmt.variableName, elemAlloca, elementType, elementKind, 'local');

    // Generate unique labels
    const condLabel = this.nextLabel('forof_cond');
    const bodyLabel = this.nextLabel('forof_body');
    const updateLabel = this.nextLabel('forof_update');
    const endLabel = this.nextLabel('forof_end');

    // Jump to condition check
    this.emit(`br label %${condLabel}`);

    // Condition block: check if index < length
    this.emit(`${condLabel}:`);
    const currentIndex = this.nextTemp();
    this.emit(`${currentIndex} = load i32, i32* ${indexAlloca}`);
    const condBool = this.nextTemp();
    this.emit(`${condBool} = icmp slt i32 ${currentIndex}, ${lengthI32}`);
    this.emit(`br i1 ${condBool}, label %${bodyLabel}, label %${endLabel}`);

    // Body block
    this.emit(`${bodyLabel}:`);
    this.currentLabel = bodyLabel;

    // Load current element from array
    // Get pointer to the data array
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = getelementptr inbounds ${arrayType}, ${arrayType}* ${iterableValue}, i32 0, i32 0`);
    const dataArray = this.nextTemp();
    if (isStringArray) {
      this.emit(`${dataArray} = load i8**, i8*** ${dataPtr}`);
    } else {
      this.emit(`${dataArray} = load double*, double** ${dataPtr}`);
    }

    // Load the element at current index
    const indexI64 = this.nextTemp();
    this.emit(`${indexI64} = sext i32 ${currentIndex} to i64`);
    const elemPtr = this.nextTemp();
    if (isStringArray) {
      this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataArray}, i64 ${indexI64}`);
    } else {
      this.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataArray}, i64 ${indexI64}`);
    }
    const elemValue = this.nextTemp();
    this.emit(`${elemValue} = load ${elementType}, ${elementType}* ${elemPtr}`);

    // Store in loop variable
    this.emit(`store ${elementType} ${elemValue}, ${elementType}* ${elemAlloca}`);

    // Execute the loop body
    this.loopStack.push({ continueLabel: updateLabel, breakLabel: endLabel });
    this.ctx.generateBlock(stmt.body, params);
    this.loopStack.pop();

    // Check if body has terminator
    const lastInstruction = this.output[this.output.length - 1]?.trim() || '';
    const bodyHasTerminator = lastInstruction.startsWith('ret ') ||
                              lastInstruction.startsWith('br ') ||
                              lastInstruction.startsWith('unreachable') ||
                              lastInstruction.startsWith('switch ');
    if (!bodyHasTerminator) {
      this.emit(`br label %${updateLabel}`);
    }

    // Update block: increment index
    this.emit(`${updateLabel}:`);
    const loadedIndex = this.nextTemp();
    this.emit(`${loadedIndex} = load i32, i32* ${indexAlloca}`);
    const nextIndex = this.nextTemp();
    this.emit(`${nextIndex} = add i32 ${loadedIndex}, 1`);
    this.emit(`store i32 ${nextIndex}, i32* ${indexAlloca}`);
    this.emit(`br label %${condLabel}`);

    // End block
    this.emit(`${endLabel}:`);

    return '0';
  }

  generateBreakStatement(): string {
    if (this.loopStack.length === 0) {
      throw new Error('break statement outside of loop');
    }
    const loop = this.loopStack[this.loopStack.length - 1];
    this.emit(`br label %${loop.breakLabel}`);
    return '0';
  }

  generateContinueStatement(): string {
    if (this.loopStack.length === 0) {
      throw new Error('continue statement outside of loop');
    }
    const loop = this.loopStack[this.loopStack.length - 1];
    this.emit(`br label %${loop.continueLabel}`);
    return '0';
  }

  generateThrowStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== 'throw') {
      throw new Error('Expected throw statement');
    }

    // For now, we'll implement throw by calling exit(1)
    // In a full implementation, we'd need exception handling support
    this.emit(`call void @exit(i32 1)`);
    this.emit(`unreachable`);
    return '0';
  }

  generateTryStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== 'try') {
      throw new Error('Expected try statement');
    }

    // For now, we'll just execute the try block and ignore catch/finally
    // Full exception handling would require LLVM's invoke/landingpad support
    this.ctx.generateBlock(stmt.tryBlock, params);

    // If there's a finally block, execute it unconditionally
    if (stmt.finallyBlock) {
      this.ctx.generateBlock(stmt.finallyBlock, params);
    }

    return '0';
  }

  generateLogicalOp(op: string, left: Expression, right: Expression, params: string[]): string {
    // For && and ||, we need short-circuit evaluation
    // We'll use a simpler non-short-circuit version for now (like C's & and |)
    const leftValue = this.ctx.generateExpression(left, params);
    const rightValue = this.ctx.generateExpression(right, params);

    // Convert both to booleans (0 or 1)
    const leftBool = this.convertToBool(leftValue);
    const leftInt = this.nextTemp();
    this.emit(`${leftInt} = zext i1 ${leftBool} to i32`);

    const rightBool = this.convertToBool(rightValue);
    const rightInt = this.nextTemp();
    this.emit(`${rightInt} = zext i1 ${rightBool} to i32`);

    if (op === '&&') {
      // Both must be non-zero (use integer multiply)
      const i32Result = this.nextTemp();
      this.emit(`${i32Result} = mul i32 ${leftInt}, ${rightInt}`);
      // Convert to double for JavaScript semantics
      const result = this.nextTemp();
      this.emit(`${result} = sitofp i32 ${i32Result} to double`);
      this.variableTypes.set(result, 'double');
      return result;
    } else {
      // At least one must be non-zero (add and clamp to 1)
      const sum = this.nextTemp();
      this.emit(`${sum} = add i32 ${leftInt}, ${rightInt}`);
      const cmp = this.nextTemp();
      this.emit(`${cmp} = icmp ne i32 ${sum}, 0`);
      const i32Result = this.nextTemp();
      this.emit(`${i32Result} = zext i1 ${cmp} to i32`);
      // Convert to double for JavaScript semantics
      const result = this.nextTemp();
      this.emit(`${result} = sitofp i32 ${i32Result} to double`);
      this.variableTypes.set(result, 'double');
      return result;
    }
  }
}

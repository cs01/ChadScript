import { Expression, Statement, BlockStatement } from '../../ast/types.js';
import { IGeneratorContext } from '../infrastructure/generator-context.js';

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
  private get variables() { return this.ctx.variables; }
  private get currentLabel() { return this.ctx.currentLabel; }
  private set currentLabel(label: string) { this.ctx.currentLabel = label; }

  // Helper to convert a value to boolean (i1) for branching
  private convertToBool(value: string): string {
    // Check if value is a double or i32 based on variable types
    const valueType = this.variableTypes.get(value);

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
    if (stmt.elseBlock) {
      this.emit(`${elseLabel}:`);
      this.currentLabel = elseLabel;
      elseValue = this.ctx.generateBlock(stmt.elseBlock, params);
      // Check if the LAST instruction is a terminator
      const lastInstruction = this.output[this.output.length - 1]?.trim() || '';
      const elseHasTerminator = lastInstruction.startsWith('ret ') ||
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

    // Merge point
    this.emit(`${mergeLabel}:`);
    this.currentLabel = mergeLabel;

    // If both branches produce values, we need a phi node
    if (thenValue && elseValue) {
      const result = this.nextTemp();
      // Use the actual end labels of each block, not the initial labels
      this.emit(`${result} = phi i32 [ ${thenValue}, %${thenEndLabel} ], [ ${elseValue}, %${elseEndLabel} ]`);
      return result;
    }

    return '0';
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
        this.variables.set(stmt.init.name, allocaReg);
        this.variableTypes.set(stmt.init.name, 'double');
        this.emit(`${allocaReg} = alloca double`);
        this.emit(`store double ${value}, double* ${allocaReg}`);
      } else if (stmt.init.type === 'assignment') {
        const value = this.ctx.generateExpression(stmt.init.value, params);
        const allocaReg = this.variables.get(stmt.init.name);
        if (!allocaReg) {
          throw new Error(`Variable ${stmt.init.name} not found`);
        }
        const varType = this.variableTypes.get(stmt.init.name) || 'double';
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
        const allocaReg = this.variables.get(stmt.update.name);
        if (!allocaReg) {
          throw new Error(`Variable ${stmt.update.name} not found in update`);
        }
        const varType = this.variableTypes.get(stmt.update.name) || 'double';
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

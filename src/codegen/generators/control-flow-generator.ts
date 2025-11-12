import { Expression, Statement, BlockStatement } from '../../ast/types.js';
import { BaseGenerator } from './base-generator.js';

// ============================================
// CONTROL FLOW GENERATOR - If/while/loops
// ============================================

export class ControlFlowGenerator extends BaseGenerator {
  // Generate delegates (set by LLVMGenerator)
  generateExpression!: (expr: Expression, params: string[]) => string;
  generateBlock!: (block: BlockStatement, params: string[]) => string | null;

  // Loop context stack for break/continue
  private loopStack: Array<{ continueLabel: string; breakLabel: string }> = [];

  constructor() {
    super();
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
    const condValue = this.generateExpression(stmt.condition, params);

    // Convert i32 to i1 for branch (non-zero is true)
    const condBool = this.nextTemp();
    this.emit(`${condBool} = fcmp one double ${condValue}, 0.0`);

    // Branch based on condition
    if (stmt.elseBlock) {
      this.emit(`br i1 ${condBool}, label %${thenLabel}, label %${elseLabel}`);
    } else {
      this.emit(`br i1 ${condBool}, label %${thenLabel}, label %${mergeLabel}`);
    }

    // Generate then block
    this.emit(`${thenLabel}:`);
    this.currentLabel = thenLabel;
    const thenValue = this.generateBlock(stmt.thenBlock, params);
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
      elseValue = this.generateBlock(stmt.elseBlock, params);
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
    const condValue = this.generateExpression(stmt.condition, params);
    const condBool = this.nextTemp();
    this.emit(`${condBool} = fcmp one double ${condValue}, 0.0`);
    this.emit(`br i1 ${condBool}, label %${bodyLabel}, label %${endLabel}`);

    // Body block - push loop context for break/continue
    this.emit(`${bodyLabel}:`);
    this.currentLabel = bodyLabel;
    this.loopStack.push({ continueLabel: condLabel, breakLabel: endLabel });
    this.generateBlock(stmt.body, params);
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
        const value = this.generateExpression(stmt.init.value, params);
        const allocaReg = this.nextTemp();
        // Register the variable in the variables map
        this.variables.set(stmt.init.name, allocaReg);
        this.emit(`${allocaReg} = alloca i32`);
        this.emit(`store i32 ${value}, i32* ${allocaReg}`);
      } else if (stmt.init.type === 'assignment') {
        const value = this.generateExpression(stmt.init.value, params);
        const allocaReg = this.variables.get(stmt.init.name);
        if (!allocaReg) {
          throw new Error(`Variable ${stmt.init.name} not found`);
        }
        this.emit(`store i32 ${value}, i32* ${allocaReg}`);
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
      const condValue = this.generateExpression(stmt.condition, params);
      const condBool = this.nextTemp();
      this.emit(`${condBool} = fcmp one double ${condValue}, 0.0`);
      this.emit(`br i1 ${condBool}, label %${bodyLabel}, label %${endLabel}`);
    } else {
      // No condition means infinite loop
      this.emit(`br label %${bodyLabel}`);
    }

    // Body block - push loop context for break/continue
    this.emit(`${bodyLabel}:`);
    this.currentLabel = bodyLabel;
    this.loopStack.push({ continueLabel: updateLabel, breakLabel: endLabel });
    this.generateBlock(stmt.body, params);
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
        const value = this.generateExpression(stmt.update.value, params);
        const allocaReg = this.variables.get(stmt.update.name);
        if (!allocaReg) {
          throw new Error(`Variable ${stmt.update.name} not found in update`);
        }
        this.emit(`store i32 ${value}, i32* ${allocaReg}`);
      } else {
        // It's an expression (like i++)
        this.generateExpression(stmt.update, params);
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
    this.generateBlock(stmt.tryBlock, params);

    // If there's a finally block, execute it unconditionally
    if (stmt.finallyBlock) {
      this.generateBlock(stmt.finallyBlock, params);
    }

    return '0';
  }

  generateLogicalOp(op: string, left: Expression, right: Expression, params: string[]): string {
    // For && and ||, we need short-circuit evaluation
    // We'll use a simpler non-short-circuit version for now (like C's & and |)
    const leftValue = this.generateExpression(left, params);
    const rightValue = this.generateExpression(right, params);

    // Convert both to booleans (0 or 1)
    const leftBool = this.nextTemp();
    this.emit(`${leftBool} = fcmp one double ${leftValue}, 0.0`);
    const leftInt = this.nextTemp();
    this.emit(`${leftInt} = zext i1 ${leftBool} to i32`);

    const rightBool = this.nextTemp();
    this.emit(`${rightBool} = fcmp one double ${rightValue}, 0.0`);
    const rightInt = this.nextTemp();
    this.emit(`${rightInt} = zext i1 ${rightBool} to i32`);

    if (op === '&&') {
      // Both must be non-zero
      const result = this.nextTemp();
      this.emit(`${result} = fmul double ${leftInt}, ${rightInt}`);
      return result;
    } else {
      // At least one must be non-zero (add and clamp to 1)
      const sum = this.nextTemp();
      this.emit(`${sum} = fadd double ${leftInt}, ${rightInt}`);
      const cmp = this.nextTemp();
      this.emit(`${cmp} = fcmp one double ${sum}, 0.0`);
      const result = this.nextTemp();
      this.emit(`${result} = zext i1 ${cmp} to i32`);
      return result;
    }
  }
}

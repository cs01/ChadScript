import { Expression, Statement, BlockStatement } from '../../ast/types.js';
import { BaseGenerator } from './base-generator.js';

// ============================================
// CONTROL FLOW GENERATOR - If/while/loops
// ============================================

export class ControlFlowGenerator extends BaseGenerator {
  // Generate delegates (set by LLVMGenerator)
  generateExpression!: (expr: Expression, params: string[]) => string;
  generateBlock!: (block: BlockStatement, params: string[]) => string | null;

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
    this.emit(`${condBool} = icmp ne i32 ${condValue}, 0`);

    // Branch based on condition
    if (stmt.elseBlock) {
      this.emit(`br i1 ${condBool}, label %${thenLabel}, label %${elseLabel}`);
    } else {
      this.emit(`br i1 ${condBool}, label %${thenLabel}, label %${mergeLabel}`);
    }

    // Generate then block
    this.emit(`${thenLabel}:`);
    const savedOutputLen = this.output.length;
    const thenValue = this.generateBlock(stmt.thenBlock, params);
    const thenHasTerminator = this.output.slice(savedOutputLen).some(line =>
      line.trim().startsWith('ret ') || line.trim().startsWith('br ')
    );
    if (!thenHasTerminator) {
      this.emit(`br label %${mergeLabel}`);
    }

    // Generate else block if it exists
    let elseValue: string | null = null;
    if (stmt.elseBlock) {
      this.emit(`${elseLabel}:`);
      const savedOutputLen2 = this.output.length;
      elseValue = this.generateBlock(stmt.elseBlock, params);
      const elseHasTerminator = this.output.slice(savedOutputLen2).some(line =>
        line.trim().startsWith('ret ') || line.trim().startsWith('br ')
      );
      if (!elseHasTerminator) {
        this.emit(`br label %${mergeLabel}`);
      }
    }

    // Merge point
    this.emit(`${mergeLabel}:`);

    // If both branches produce values, we need a phi node
    if (thenValue && elseValue) {
      const result = this.nextTemp();
      this.emit(`${result} = phi i32 [ ${thenValue}, %${thenLabel} ], [ ${elseValue}, %${elseLabel} ]`);
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
    this.emit(`${condBool} = icmp ne i32 ${condValue}, 0`);
    this.emit(`br i1 ${condBool}, label %${bodyLabel}, label %${endLabel}`);

    // Body block
    this.emit(`${bodyLabel}:`);
    this.generateBlock(stmt.body, params);
    this.emit(`br label %${condLabel}`);

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
      this.emit(`${condBool} = icmp ne i32 ${condValue}, 0`);
      this.emit(`br i1 ${condBool}, label %${bodyLabel}, label %${endLabel}`);
    } else {
      // No condition means infinite loop
      this.emit(`br label %${bodyLabel}`);
    }

    // Body block
    this.emit(`${bodyLabel}:`);
    this.generateBlock(stmt.body, params);
    this.emit(`br label %${updateLabel}`);

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

  generateLogicalOp(op: string, left: Expression, right: Expression, params: string[]): string {
    // For && and ||, we need short-circuit evaluation
    // We'll use a simpler non-short-circuit version for now (like C's & and |)
    const leftValue = this.generateExpression(left, params);
    const rightValue = this.generateExpression(right, params);

    // Convert both to booleans (0 or 1)
    const leftBool = this.nextTemp();
    this.emit(`${leftBool} = icmp ne i32 ${leftValue}, 0`);
    const leftInt = this.nextTemp();
    this.emit(`${leftInt} = zext i1 ${leftBool} to i32`);

    const rightBool = this.nextTemp();
    this.emit(`${rightBool} = icmp ne i32 ${rightValue}, 0`);
    const rightInt = this.nextTemp();
    this.emit(`${rightInt} = zext i1 ${rightBool} to i32`);

    if (op === '&&') {
      // Both must be non-zero
      const result = this.nextTemp();
      this.emit(`${result} = mul i32 ${leftInt}, ${rightInt}`);
      return result;
    } else {
      // At least one must be non-zero (add and clamp to 1)
      const sum = this.nextTemp();
      this.emit(`${sum} = add i32 ${leftInt}, ${rightInt}`);
      const cmp = this.nextTemp();
      this.emit(`${cmp} = icmp ne i32 ${sum}, 0`);
      const result = this.nextTemp();
      this.emit(`${result} = zext i1 ${cmp} to i32`);
      return result;
    }
  }
}

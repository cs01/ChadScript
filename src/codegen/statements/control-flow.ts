// NOTE: This file uses raw ctx.emit() extensively. Prefer structured IR builders
// (emitStore, emitLoad, emitCall, etc.) when modifying — see .claude/rules.md.

import {
  Expression,
  Statement,
  BlockStatement,
  MemberAccessNode,
  VariableNode,
  BinaryNode,
  InterfaceDeclaration,
  MethodCallNode,
  InterfaceField,
  CommonField,
  FunctionParameter,
  SwitchStatement,
  SwitchCase,
  StringNode,
  TryStatement,
  WhileStatement,
  DoWhileStatement,
  AssignmentStatement,
  ThrowStatement,
  ArrayNode,
  ForStatement,
  CallNode,
} from "../../ast/types.js";
import { ForOfGenerator } from "./for-of.js";
import { IGeneratorContext } from "../infrastructure/generator-context.js";
import { SymbolKind_Number, SymbolKind_String } from "../infrastructure/symbol-table.js";
import type { FieldInfo } from "../infrastructure/type-resolver/types.js";
import { stripOptional } from "../infrastructure/type-system.js";
import { setWantsI1 } from "../expressions/condition-generator.js";

interface ExprBase {
  type: string;
}

// ============================================
// CONTROL FLOW GENERATOR - If/while/loops
// ============================================

export class ControlFlowGenerator {
  private loopContinueLabels: string[];
  private loopBreakLabels: string[];
  private forOfGen: ForOfGenerator;

  constructor(private ctx: IGeneratorContext) {
    this.loopContinueLabels = [];
    this.loopBreakLabels = [];
    this.forOfGen = new ForOfGenerator(ctx, this.loopContinueLabels, this.loopBreakLabels);
  }

  // Helper methods delegate to context
  private nextTemp(): string {
    return this.ctx.nextTemp();
  }
  private nextLabel(prefix: string): string {
    return this.ctx.nextLabel(prefix);
  }
  private emit(instruction: string): void {
    this.ctx.emit(instruction);
  }

  // Helper to convert a value to boolean (i1) for branching
  private convertToBool(value: string): string {
    // Check if value is a double or i32 based on variable types
    const valueType = this.ctx.getVariableType(value);

    if (valueType === "i1") {
      // Value is already a boolean (i1), use it directly
      return value;
    } else if (valueType === "double" || (value.indexOf(".") !== -1 && !value.startsWith("%"))) {
      // Value is a double, use fcmp
      const condBool = this.nextTemp();
      this.emit(`${condBool} = fcmp one double ${value}, 0.0`);
      return condBool;
    } else if (valueType && valueType.indexOf("*") !== -1) {
      // Value is a pointer type, check if non-null
      // Use i8* for complex types that aren't valid LLVM types
      const isValidLlvmType =
        !valueType.startsWith("%{") && !valueType.includes("|") && !valueType.includes(":");
      const llvmType = isValidLlvmType ? valueType : "i8*";
      const condBool = this.ctx.emitIcmp("ne", llvmType, value, "null");
      return condBool;
    } else if (valueType === "i32") {
      // Value is i32, use icmp ne for integer comparison
      const condBool = this.ctx.emitIcmp("ne", "i32", value, "0");
      return condBool;
    } else if (valueType === "i64") {
      const condBool = this.ctx.emitIcmp("ne", "i64", value, "0");
      return condBool;
    } else {
      // Unknown type - assume double for temp registers
      if (value.startsWith("%")) {
        const condBool = this.nextTemp();
        this.emit(`${condBool} = fcmp one double ${value}, 0.0`);
        return condBool;
      }
      // Literal i32 value - convert to double then compare
      const condDouble = this.nextTemp();
      this.emit(`${condDouble} = sitofp i32 ${value} to double`);
      const condBool = this.nextTemp();
      this.emit(`${condBool} = fcmp one double ${condDouble}, 0.0`);
      return condBool;
    }
  }

  private isSimpleComparisonForBranch(expr: Expression): boolean {
    if (expr.type !== "binary") return false;
    const bin = expr as BinaryNode;
    const op = bin.op;
    if (
      op !== "<" &&
      op !== ">" &&
      op !== "<=" &&
      op !== ">=" &&
      op !== "==" &&
      op !== "!=" &&
      op !== "===" &&
      op !== "!=="
    ) {
      return false;
    }
    const lt = bin.left.type;
    const rt = bin.right.type;
    if (lt === "binary" || rt === "binary") return false;
    if (lt === "call" || rt === "call") return false;
    if (lt === "method_call" || rt === "method_call") return false;
    if (lt === "conditional" || rt === "conditional") return false;
    return true;
  }

  private generateBranchCondition(expr: Expression, params: string[]): string {
    if (this.isSimpleComparisonForBranch(expr)) {
      setWantsI1(true);
      const condValue = this.ctx.generateExpression(expr, params);
      setWantsI1(false);
      return this.convertToBool(condValue);
    }
    const condValue = this.ctx.generateExpression(expr, params);
    return this.convertToBool(condValue);
  }

  private convertToNonNullish(value: string, valueType: string): string {
    if (
      valueType === "i1" ||
      valueType === "double" ||
      valueType === "i32" ||
      valueType === "i64"
    ) {
      const condBool = this.ctx.emitIcmp("eq", "i32", "1", "1");
      return condBool;
    }
    if (valueType && valueType.indexOf("*") !== -1) {
      const isValidLlvmType =
        !valueType.startsWith("%{") && !valueType.includes("|") && !valueType.includes(":");
      const llvmType = isValidLlvmType ? valueType : "i8*";
      const condBool = this.ctx.emitIcmp("ne", llvmType, value, "null");
      return condBool;
    }
    const condBool = this.ctx.emitIcmp("eq", "i32", "1", "1");
    return condBool;
  }

  generateIfStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== "if") {
      return this.ctx.emitError("Expected if statement", stmt.loc);
    }

    const ifStmt = stmt as {
      type: string;
      condition: Expression;
      thenBlock: BlockStatement;
      elseBlock: BlockStatement | null;
    };

    const thenLabel = this.nextLabel("then");
    const elseLabel = this.nextLabel("else");
    const mergeLabel = this.nextLabel("merge");

    const typeGuard = this.detectTypeGuard(ifStmt.condition);

    const condBool = this.generateBranchCondition(ifStmt.condition, params);

    if (ifStmt.elseBlock) {
      this.ctx.emitBrCond(condBool, thenLabel, elseLabel);
    } else {
      this.ctx.emitBrCond(condBool, thenLabel, mergeLabel);
    }

    this.ctx.emitLabel(thenLabel);
    this.ctx.setCurrentLabel(thenLabel);

    if (typeGuard) {
      const tg = typeGuard as {
        varName: string;
        narrowedMetadata: { keys: string[]; types: string[]; tsTypes?: string[] };
      };
      this.ctx.symbolTable.narrowType(tg.varName, tg.narrowedMetadata);
    }

    this.ctx.symbolTable.pushScope("if-then");
    this.ctx.generateBlock(ifStmt.thenBlock, params);
    this.ctx.symbolTable.popScope();

    if (typeGuard) {
      const tg = typeGuard as {
        varName: string;
        narrowedMetadata: { keys: string[]; types: string[]; tsTypes?: string[] };
      };
      this.ctx.symbolTable.restoreType(tg.varName);
    }

    const thenHasTerminator = this.ctx.lastInstructionIsTerminator();
    if (!thenHasTerminator) {
      this.ctx.emitBr(mergeLabel);
    }

    let elseHasTerminator = false;
    if (ifStmt.elseBlock) {
      this.ctx.emitLabel(elseLabel);
      this.ctx.setCurrentLabel(elseLabel);
      this.ctx.symbolTable.pushScope("if-else");
      this.ctx.generateBlock(ifStmt.elseBlock, params);
      this.ctx.symbolTable.popScope();
      elseHasTerminator = this.ctx.lastInstructionIsTerminator();
      if (!elseHasTerminator) {
        this.ctx.emitBr(mergeLabel);
      }
    }

    if (ifStmt.elseBlock && thenHasTerminator && elseHasTerminator) {
      return "0";
    }

    // Merge point
    this.ctx.emitLabel(mergeLabel);
    this.ctx.setCurrentLabel(mergeLabel);

    return "0";
  }

  generateWhileStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== "while") {
      return this.ctx.emitError("Expected while statement", stmt.loc);
    }

    const whileStmt = stmt as WhileStatement;

    // Generate unique labels
    const condLabel = this.nextLabel("while_cond");
    const bodyLabel = this.nextLabel("while_body");
    const endLabel = this.nextLabel("while_end");

    // Jump to condition check
    this.ctx.emitBr(condLabel);

    // Condition block
    this.ctx.emitLabel(condLabel);
    const condBool = this.generateBranchCondition(whileStmt.condition, params);
    this.ctx.emitBrCond(condBool, bodyLabel, endLabel);

    // Body block - push loop context for break/continue
    this.ctx.emitLabel(bodyLabel);
    this.ctx.setCurrentLabel(bodyLabel);
    this.loopContinueLabels.push(condLabel);
    this.loopBreakLabels.push(endLabel);
    this.ctx.generateBlock(whileStmt.body, params);
    this.loopContinueLabels.pop();
    this.loopBreakLabels.pop();
    const bodyHasTerminator = this.ctx.lastInstructionIsTerminator();
    if (!bodyHasTerminator) {
      this.ctx.emitBr(condLabel);
    }

    // End block
    this.ctx.emitLabel(endLabel);

    return "0";
  }

  // do { body } while (condition) — body executes first, then condition is checked.
  // continue jumps to cond (matching JS semantics), break jumps to end.
  generateDoWhileStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== "do_while") {
      return this.ctx.emitError("Expected do_while statement", stmt.loc);
    }

    const doWhileStmt = stmt as DoWhileStatement;

    const bodyLabel = this.nextLabel("dowhile_body");
    const condLabel = this.nextLabel("dowhile_cond");
    const endLabel = this.nextLabel("dowhile_end");

    // Jump directly to body (body always executes at least once)
    this.ctx.emitBr(bodyLabel);

    // Body block
    this.ctx.emitLabel(bodyLabel);
    this.ctx.setCurrentLabel(bodyLabel);
    this.loopContinueLabels.push(condLabel);
    this.loopBreakLabels.push(endLabel);
    this.ctx.generateBlock(doWhileStmt.body, params);
    this.loopContinueLabels.pop();
    this.loopBreakLabels.pop();
    const bodyHasTerminator2 = this.ctx.lastInstructionIsTerminator();
    if (!bodyHasTerminator2) {
      this.ctx.emitBr(condLabel);
    }

    // Condition block — evaluated after body
    this.ctx.emitLabel(condLabel);
    this.ctx.setCurrentLabel(condLabel);
    const condBool2 = this.generateBranchCondition(doWhileStmt.condition, params);
    this.ctx.emitBrCond(condBool2, bodyLabel, endLabel);

    // End block
    this.ctx.emitLabel(endLabel);

    return "0";
  }

  generateForStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== "for") {
      return this.ctx.emitError("Expected for statement", stmt.loc);
    }

    const forStmt = stmt as {
      type: string;
      init: Statement | null;
      condition: Expression | null;
      update: Statement | null;
      body: BlockStatement;
    };

    // Generate init if present
    if (forStmt.init) {
      const initBase = forStmt.init as { type: string };
      if (initBase.type === "variable_declaration") {
        const initVarDecl = forStmt.init as {
          type: string;
          kind: string;
          name: string;
          value: Expression | null;
          declaredType?: string;
        };
        if (!initVarDecl.value) {
          return this.ctx.emitError("Variable declaration in for loop must have an initializer");
        }
        const value = this.ctx.generateExpression(initVarDecl.value, params);
        const valueType = this.ctx.getVariableType(value) || "double";
        const eligible = this.ctx.getI64EligibleVars();
        let useI64 = false;
        for (let ei = 0; ei < eligible.length; ei++) {
          if (eligible[ei] === initVarDecl.name) {
            useI64 = true;
            break;
          }
        }
        const allocaReg = this.ctx.nextAllocaReg(initVarDecl.name);
        if (useI64 && (valueType === "i64" || valueType === "double")) {
          const i64Val = valueType === "double" ? this.ctx.ensureI64(value) : value;
          this.ctx.defineVariable(initVarDecl.name, allocaReg, "i64", SymbolKind_Number, "local");
          this.emit(`${allocaReg} = alloca i64`);
          this.ctx.emitStore("i64", i64Val, allocaReg);
        } else {
          const dblValue = this.ctx.ensureDouble(value);
          this.ctx.defineVariable(
            initVarDecl.name,
            allocaReg,
            "double",
            SymbolKind_Number,
            "local",
          );
          this.emit(`${allocaReg} = alloca double`);
          this.ctx.emitStore("double", dblValue, allocaReg);
        }
      } else if (initBase.type === "assignment") {
        const initAssign = forStmt.init as AssignmentStatement;
        let value = this.ctx.generateExpression(initAssign.value, params);
        const allocaReg = this.ctx.getVariableAlloca(initAssign.name);
        if (!allocaReg) {
          return this.ctx.emitError(`Variable ${initAssign.name} not found`, stmt.loc);
        }
        const varType = this.ctx.getVariableType(initAssign.name) || "double";
        const valType = this.ctx.getVariableType(value);
        if (varType === "double" && valType === "i64") {
          value = this.ctx.ensureDouble(value);
        } else if (varType === "i64" && valType === "double") {
          value = this.ctx.ensureI64(value);
        }
        this.ctx.emitStore(varType, value, allocaReg);
      }
    }

    // Generate unique labels
    const condLabel = this.nextLabel("for_cond");
    const bodyLabel = this.nextLabel("for_body");
    const updateLabel = this.nextLabel("for_update");
    const endLabel = this.nextLabel("for_end");

    // Jump to condition check
    this.ctx.emitBr(condLabel);

    // Condition block
    this.ctx.emitLabel(condLabel);
    if (forStmt.condition) {
      const condBool3 = this.generateBranchCondition(forStmt.condition, params);
      this.ctx.emitBrCond(condBool3, bodyLabel, endLabel);
    } else {
      // No condition means infinite loop
      this.ctx.emitBr(bodyLabel);
    }

    // Body block - push loop context for break/continue
    this.ctx.emitLabel(bodyLabel);
    this.ctx.setCurrentLabel(bodyLabel);
    this.loopContinueLabels.push(updateLabel);
    this.loopBreakLabels.push(endLabel);
    this.ctx.generateBlock(forStmt.body, params);
    this.loopContinueLabels.pop();
    this.loopBreakLabels.pop();
    const bodyHasTerminator3 = this.ctx.lastInstructionIsTerminator();
    if (!bodyHasTerminator3) {
      this.ctx.emitBr(updateLabel);
    }

    // Update block
    this.ctx.emitLabel(updateLabel);
    if (forStmt.update) {
      const updateTyped = forStmt.update as AssignmentStatement;
      const updateType = updateTyped.type;
      if (updateType === "assignment") {
        const updateName = updateTyped.name;
        if (!updateName) {
          return this.ctx.emitError("Assignment update has no name", stmt.loc);
        }
        let value = this.ctx.generateExpression(updateTyped.value, params);
        const allocaReg = this.ctx.getVariableAlloca(updateName);
        if (!allocaReg) {
          return this.ctx.emitError(`Variable ${updateName} not found in update`, stmt.loc);
        }
        const varType = this.ctx.getVariableType(updateName) || "double";
        const valType = this.ctx.getVariableType(value);
        if (varType === "double" && valType === "i64") {
          value = this.ctx.ensureDouble(value);
        } else if (varType === "i64" && valType === "double") {
          value = this.ctx.ensureI64(value);
        }
        this.ctx.emitStore(varType, value, allocaReg);
      } else {
        // It's an expression (like i++)
        this.ctx.generateExpression(forStmt.update as Expression, params);
      }
    }
    this.ctx.emitBr(condLabel);

    // End block
    this.ctx.emitLabel(endLabel);

    return "0";
  }

  generateForOfStatement(stmt: Statement, params: string[]): string {
    return this.forOfGen.generateForOfStatement(stmt, params);
  }

  private getInterfaceDecl(name: string): InterfaceDeclaration | null {
    return this.ctx.getInterfaceDeclByName(name);
  }

  generateBreakStatement(): string {
    if (this.loopBreakLabels.length === 0) {
      return this.ctx.emitError("break statement outside of loop");
    }
    const breakLabel = this.loopBreakLabels[this.loopBreakLabels.length - 1];
    this.ctx.emitBr(breakLabel);
    return "0";
  }

  generateContinueStatement(): string {
    if (this.loopContinueLabels.length === 0) {
      return this.ctx.emitError("continue statement outside of loop");
    }
    const continueLabel = this.loopContinueLabels[this.loopContinueLabels.length - 1];
    this.ctx.emitBr(continueLabel);
    return "0";
  }

  generateThrowStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== "throw") {
      return this.ctx.emitError("Expected throw statement", stmt.loc);
    }

    const throwStmt = stmt as ThrowStatement;
    let msgVal: string = "null";

    if (throwStmt.argument) {
      const argTyped = throwStmt.argument as {
        type: string;
        className?: string;
        args?: Expression[];
      };
      if (
        argTyped.type === "new" &&
        argTyped.className === "Error" &&
        argTyped.args &&
        argTyped.args.length > 0
      ) {
        const msgArg = argTyped.args[0];
        msgVal = this.ctx.generateExpression(msgArg, params);
      } else {
        msgVal = this.ctx.generateExpression(throwStmt.argument, params);
        const msgType = this.ctx.getVariableType(msgVal);
        if (msgType === "double") {
          msgVal = this.ctx.emitCall("i8*", "@__double_to_string", `double ${msgVal}`);
        }
      }
    }

    this.ctx.emitStore("i8*", msgVal, "@__exception_message");

    const framePtr = this.ctx.emitLoad("i8*", "@__exception_stack");
    const hasHandler = this.ctx.emitIcmp("ne", "i8*", framePtr, "null");
    const doLongjmpLabel = this.nextLabel("do_longjmp");
    const noHandlerLabel = this.nextLabel("no_handler");
    this.ctx.emitBrCond(hasHandler, doLongjmpLabel, noHandlerLabel);

    this.ctx.emitLabel(doLongjmpLabel);
    this.ctx.setCurrentLabel(doLongjmpLabel);
    const frameTyped = this.ctx.emitBitcast(framePtr, "i8*", "%ExceptionFrame*");
    const bufPtr = this.ctx.emitGep("%ExceptionFrame", frameTyped, "i32 0, i32 0, i32 0");
    this.emit(`call void @longjmp(i8* ${bufPtr}, i32 1)`);
    this.emit(`unreachable`);

    this.ctx.emitLabel(noHandlerLabel);
    this.ctx.setCurrentLabel(noHandlerLabel);
    const stderrPtr = this.ctx.emitLoad("i8*", "@stderr");
    const fprintfResult = this.ctx.nextTemp();
    this.emit(
      `${fprintfResult} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* getelementptr([11 x i8], [11 x i8]* @.str.throw_fmt, i32 0, i32 0), i8* ${msgVal})`,
    );
    this.emit(`call void @exit(i32 1)`);
    this.emit(`unreachable`);
    return "0";
  }

  generateTryStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== "try") {
      return this.ctx.emitError("Expected try statement", stmt.loc);
    }
    const tryStmt = stmt as {
      type: string;
      tryBlock: BlockStatement;
      catchParam: string | null;
      catchBody: BlockStatement | null;
      finallyBlock: BlockStatement | null;
    };

    const frameRaw = this.ctx.emitCall("i8*", "@GC_malloc", "i64 216");
    const frame = this.ctx.emitBitcast(frameRaw, "i8*", "%ExceptionFrame*");

    const prevFrame = this.ctx.emitLoad("i8*", "@__exception_stack");
    const prevField = this.ctx.emitGep("%ExceptionFrame", frame, "i32 0, i32 1");
    this.ctx.emitStore("i8*", prevFrame, prevField);
    this.ctx.emitStore("i8*", frameRaw, "@__exception_stack");

    const bufPtr = this.ctx.emitGep("%ExceptionFrame", frame, "i32 0, i32 0, i32 0");
    const sjVal = this.ctx.emitCall("i32", "@setjmp", `i8* ${bufPtr}`);
    const isException = this.ctx.emitIcmp("ne", "i32", sjVal, "0");

    const tryBodyLabel = this.nextLabel("try_body");
    const catchEntryLabel = this.nextLabel("catch_entry");
    const finallyLabel = this.nextLabel("finally_block");

    const paramName = tryStmt.catchParam;
    let paramAlloca = "";
    if (paramName) {
      paramAlloca = this.ctx.nextAllocaReg(paramName);
      this.emit(`${paramAlloca} = alloca i8*`);
    }

    this.ctx.emitBrCond(isException, catchEntryLabel, tryBodyLabel);

    this.ctx.emitLabel(tryBodyLabel);
    this.ctx.setCurrentLabel(tryBodyLabel);
    this.ctx.generateBlock(tryStmt.tryBlock, params);
    const tryHasTerminator = this.ctx.lastInstructionIsTerminator();
    if (!tryHasTerminator) {
      this.ctx.emitStore("i8*", prevFrame, "@__exception_stack");
      this.ctx.emitBr(finallyLabel);
    }

    this.ctx.emitLabel(catchEntryLabel);
    this.ctx.setCurrentLabel(catchEntryLabel);
    this.ctx.emitStore("i8*", prevFrame, "@__exception_stack");

    if (tryStmt.catchBody) {
      if (paramName) {
        const excMsg = this.ctx.emitLoad("i8*", "@__exception_message");
        this.ctx.emitStore("i8*", excMsg, paramAlloca);
        this.ctx.defineVariable(paramName, paramAlloca, "i8*", SymbolKind_String, "local");
      }
      this.ctx.generateBlock(tryStmt.catchBody, params);
    }

    const catchHasTerminator = this.ctx.lastInstructionIsTerminator();
    if (!catchHasTerminator) {
      this.ctx.emitBr(finallyLabel);
    }

    if (tryHasTerminator && catchHasTerminator && !tryStmt.finallyBlock) {
      return "0";
    }

    this.ctx.emitLabel(finallyLabel);
    this.ctx.setCurrentLabel(finallyLabel);

    if (tryStmt.finallyBlock) {
      this.ctx.generateBlock(tryStmt.finallyBlock, params);
    }

    return "0";
  }

  generateLogicalOp(op: string, left: Expression, right: Expression, params: string[]): string {
    const leftValue = this.ctx.generateExpression(left, params);
    const leftType = this.ctx.getVariableType(leftValue) || "double";
    let leftBool: string;
    if (op === "??") {
      leftBool = this.convertToNonNullish(leftValue, leftType);
    } else {
      leftBool = this.convertToBool(leftValue);
    }

    const evalRightLabel = this.nextLabel("logop_eval_right");
    const endLabel = this.nextLabel("logop_end");
    const leftCoerceLabel = this.nextLabel("logop_left_coerce");

    if (op === "||" || op === "??") {
      this.ctx.emitBrCond(leftBool, leftCoerceLabel, evalRightLabel);
    } else {
      this.ctx.emitBrCond(leftBool, evalRightLabel, leftCoerceLabel);
    }

    this.ctx.emitLabel(evalRightLabel);
    const savedExpectedType = this.ctx.getExpectedArrayElementType();
    const rightTyped = right as ArrayNode;
    if (rightTyped.type === "array" && (!rightTyped.elements || rightTyped.elements.length === 0)) {
      if (savedExpectedType === null) {
        if (leftType === "%StringArray*") {
          this.ctx.setExpectedArrayElementType("string");
        } else if (leftType === "%ObjectArray*") {
          this.ctx.setExpectedArrayElementType("pointer");
        }
      }
    }
    const rightValue = this.ctx.generateExpression(right, params);
    this.ctx.setExpectedArrayElementType(savedExpectedType);
    const rightType = this.ctx.getVariableType(rightValue) || "double";
    const resultType = this.getPhiType(leftType, rightType);
    const rightForPhi = this.coerceToTypeNoPhi(rightValue, rightType, resultType);
    const rightCoerceEndLabel = this.ctx.getCurrentLabel();
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(leftCoerceLabel);
    const leftForPhi = this.coerceToTypeNoPhi(leftValue, leftType, resultType);
    const leftCoerceEndLabel = this.ctx.getCurrentLabel();
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(endLabel);
    const result = this.nextTemp();
    this.emit(
      `${result} = phi ${resultType} [ ${leftForPhi}, %${leftCoerceEndLabel} ], [ ${rightForPhi}, %${rightCoerceEndLabel} ]`,
    );
    this.ctx.setVariableType(result, resultType);
    return result;
  }

  private getPhiType(type1: string, type2: string): string {
    if (type1 === type2) return type1;
    if (type1.indexOf("*") !== -1) return type1;
    if (type2.indexOf("*") !== -1) return type2;
    return "double";
  }

  private coerceToTypeNoPhi(value: string, fromType: string, toType: string): string {
    if (fromType === toType) return value;
    if (toType === "double" && fromType === "i64") {
      const coerced = this.nextTemp();
      this.emit(`${coerced} = sitofp i64 ${value} to double`);
      return coerced;
    }
    if (toType === "i64" && fromType === "double") {
      const coerced = this.nextTemp();
      this.emit(`${coerced} = fptosi double ${value} to i64`);
      return coerced;
    }
    if (toType.indexOf("*") !== -1 && fromType === "i64") {
      const coerced = this.nextTemp();
      this.emit(`${coerced} = inttoptr i64 ${value} to ${toType}`);
      return coerced;
    }
    if (toType.indexOf("*") !== -1 && fromType === "double") {
      const cmp = this.nextTemp();
      this.emit(`${cmp} = fcmp one double ${value}, 0.0`);
      const zext = this.nextTemp();
      this.emit(`${zext} = zext i1 ${cmp} to i64`);
      const coerced = this.nextTemp();
      this.emit(`${coerced} = inttoptr i64 ${zext} to ${toType}`);
      return coerced;
    }
    if (toType.indexOf("*") !== -1 && fromType === "i32") {
      const extended = this.nextTemp();
      this.emit(`${extended} = sext i32 ${value} to i64`);
      const coerced = this.nextTemp();
      this.emit(`${coerced} = inttoptr i64 ${extended} to ${toType}`);
      return coerced;
    }
    return value;
  }

  private getUnionCommonFields(memberNames: string[]): {
    keys: string[];
    types: string[];
    tsTypes: string[];
  } {
    const result = this.ctx.typeResolver?.getUnionCommonFields(memberNames);
    if (result && result.keys.length > 0) {
      return { keys: result.keys, types: result.types, tsTypes: result.types };
    }

    const foundInterfaces: InterfaceDeclaration[] = [];
    for (let i = 0; i < memberNames.length; i++) {
      const name = memberNames[i];
      const ifaceResult = this.getInterfaceDecl(name);
      const iface = ifaceResult as InterfaceDeclaration;
      if (ifaceResult) {
        foundInterfaces.push(iface);
      }
    }
    const interfaces = foundInterfaces;

    if (interfaces.length === 0) {
      return { keys: [], types: [], tsTypes: [] };
    }

    const firstInterface = interfaces[0] as InterfaceDeclaration;
    const firstAllFields = this.ctx.getAllInterfaceFields(firstInterface);
    const commonFields: CommonField[] = [];

    for (let fi = 0; fi < firstAllFields.length; fi++) {
      const field = firstAllFields[fi] as { name: string; type: string };
      let isCommon = true;
      for (let ii = 0; ii < interfaces.length; ii++) {
        const ifaceTyped = interfaces[ii] as InterfaceDeclaration;
        const ifaceAllFields = this.ctx.getAllInterfaceFields(ifaceTyped);
        let found = false;
        for (let fj = 0; fj < ifaceAllFields.length; fj++) {
          const f = ifaceAllFields[fj] as { name: string; type: string };
          if (f.name === field.name && this.areTypesCompatible(f.type, field.type)) {
            found = true;
            break;
          }
        }
        if (!found) {
          isCommon = false;
          break;
        }
      }
      if (isCommon) {
        commonFields.push({ name: field.name, type: this.normalizeType(field.type) });
      }
    }

    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];
    for (let i = 0; i < commonFields.length; i++) {
      const f = commonFields[i] as CommonField;
      keys.push(stripOptional(f.name));
      types.push(this.fieldTypeToLlvm(f.type));
      tsTypes.push(f.type);
    }

    return { keys, types, tsTypes };
  }

  private areTypesCompatible(type1: string, type2: string): boolean {
    const result = this.ctx.typeResolverAreTypesCompatible(type1, type2);
    if (result) {
      return result;
    }

    if (type1 === type2) return true;
    const norm1 = this.normalizeType(type1);
    const norm2 = this.normalizeType(type2);
    return norm1 === norm2;
  }

  private normalizeType(type: string): string {
    const result = this.ctx.typeResolverNormalizeType(type);
    if (result && result !== type) {
      return result;
    }

    if (type.startsWith("'") && type.endsWith("'")) return "string";
    if (type.startsWith('"') && type.endsWith('"')) return "string";
    return type;
  }

  private fieldTypeToLlvmPrimitive(fieldType: string): string | null {
    if (fieldType === "string") return "i8*";
    if (fieldType === "number") return "double";
    if (fieldType === "boolean") return "double";
    if (fieldType.startsWith("'") || fieldType.startsWith('"')) return "i8*";
    return null;
  }

  private fieldTypeToLlvm(fieldType: string): string {
    const prim = this.fieldTypeToLlvmPrimitive(fieldType);
    if (prim) return prim;
    if (this.isEnumType(fieldType)) return "double";
    return "i8*";
  }

  private isEnumType(typeName: string): boolean {
    let checkType = typeName;
    if (checkType.indexOf(" | ") !== -1) {
      const parts = checkType.split(" | ");
      for (let j = 0; j < parts.length; j++) {
        const part = parts[j].trim();
        if (part !== "undefined" && part !== "null") {
          checkType = part;
          break;
        }
      }
    }
    return this.ctx.isEnumType(checkType);
  }

  private detectTypeGuard(condition: Expression): {
    varName: string;
    narrowedMetadata: { keys: string[]; types: string[]; tsTypes?: string[] };
  } | null {
    if (!condition) return null;

    const result = this.ctx.typeResolverDetectTypeGuard(condition);
    if (result) {
      return {
        varName: result.varName,
        narrowedMetadata: {
          keys: result.narrowedMetadata.keys,
          types: result.narrowedMetadata.types,
          tsTypes: result.narrowedMetadata.tsTypes,
        },
      };
    }

    const parts = this.extractTypeGuardBinaryParts(condition);
    if (!parts) return null;

    return this.resolveTypeGuardFromBinary(parts.binary, parts.memberAccess, parts.literalValue);
  }

  private extractTypeGuardBinaryParts(
    condition: Expression,
  ): { binary: BinaryNode; memberAccess: MemberAccessNode; literalValue: string } | null {
    if (condition.type !== "binary") return null;

    const binary = condition as BinaryNode;
    if (binary.op !== "===" && binary.op !== "==" && binary.op !== "!==" && binary.op !== "!=")
      return null;
    if (!binary.left || !binary.right) return null;

    const leftBase = binary.left as ExprBase;
    const rightBase = binary.right as ExprBase;
    if (!leftBase.type || !rightBase.type) return null;

    let memberAccess: MemberAccessNode | null = null;
    let literalValue: string | null = null;

    if (leftBase.type === "member_access" && rightBase.type === "string") {
      memberAccess = binary.left as MemberAccessNode;
      const rightStr = binary.right as StringNode;
      literalValue = rightStr.value;
    } else if (rightBase.type === "member_access" && leftBase.type === "string") {
      memberAccess = binary.right as MemberAccessNode;
      const leftStr = binary.left as StringNode;
      literalValue = leftStr.value;
    }

    if (!memberAccess || !literalValue) return null;
    return { binary, memberAccess, literalValue };
  }

  private resolveTypeGuardFromBinary(
    binary: BinaryNode,
    memberAccess: MemberAccessNode,
    literalValue: string,
  ): {
    varName: string;
    narrowedMetadata: { keys: string[]; types: string[]; tsTypes?: string[] };
  } | null {
    if (memberAccess.property !== "type") return null;
    const maObjBase = memberAccess.object as ExprBase;
    if (maObjBase.type !== "variable") return null;

    const varName = (memberAccess.object as VariableNode).name;
    const objMeta = this.ctx.symbolTable.getObjectMetadata(varName);
    if (!objMeta) return null;

    const ifaceAllFields = this.resolveCompatibleInterface(literalValue, objMeta.keys as string[]);
    if (!ifaceAllFields) return null;

    if (binary.op === "!==" || binary.op === "!=") return null;

    const keys: string[] = [];
    const types: string[] = [];
    const tsTypes: string[] = [];
    for (let i = 0; i < ifaceAllFields.length; i++) {
      const f = ifaceAllFields[i] as { name: string; type: string };
      keys.push(stripOptional(f.name));
      types.push(this.fieldTypeToLlvm(f.type));
      tsTypes.push(f.type);
    }

    return { varName, narrowedMetadata: { keys, types, tsTypes } };
  }

  private resolveCompatibleInterface(
    discriminantValue: string,
    currentKeys: string[],
  ): object[] | null {
    const interfaceName = this.findInterfaceByDiscriminant(discriminantValue);
    if (!interfaceName) return null;

    const ifaceResult = this.getInterfaceDecl(interfaceName);
    if (!ifaceResult) return null;
    const iface = ifaceResult as InterfaceDeclaration;
    const ifaceAllFields = this.ctx.getAllInterfaceFields(iface);

    const ifaceKeys: string[] = [];
    for (let fi = 0; fi < ifaceAllFields.length; fi++) {
      const f = ifaceAllFields[fi] as { name: string; type: string };
      ifaceKeys.push(f.name);
    }
    for (let ki = 0; ki < currentKeys.length; ki++) {
      if (ifaceKeys.indexOf(currentKeys[ki]) === -1) return null;
    }

    return ifaceAllFields;
  }

  private findInterfaceByDiscriminant(discriminantValue: string): string | null {
    return this.ctx.typeResolverFindInterfaceByDiscriminant(discriminantValue);
  }

  private checkDiscriminant(
    ifaceName: string,
    fields: { name: string; type: string }[],
    discriminantValue: string,
  ): string | null {
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i] as { name: string; type: string };
      if (f.name === "type") {
        const fieldType = f.type;
        if (fieldType === `'${discriminantValue}'` || fieldType === `"${discriminantValue}"`) {
          return ifaceName;
        }
      }
    }
    return null;
  }

  private isStringSetExpression(expr: Expression): boolean {
    const e = expr as ExprBase;

    if (e.type === "variable") {
      const varName = (expr as VariableNode).name;
      if (this.ctx.symbolTable.isSet(varName)) {
        const setMeta = this.ctx.symbolTable.getSetValueType(varName);
        return !setMeta || setMeta === "string";
      }
      return false;
    }

    if (e.type === "member_access") {
      const memberExpr = expr as MemberAccessNode;
      const memberObjBase = memberExpr.object as ExprBase;
      const className = this.ctx.getCurrentClassName();
      if (memberObjBase.type === "this" && className) {
        const fieldInfoResult = this.ctx.classGenGetFieldInfo(className, memberExpr.property);
        const fieldInfo = fieldInfoResult as FieldInfo;
        if (fieldInfoResult && fieldInfo.tsType && fieldInfo.tsType.startsWith("Set<string>")) {
          return true;
        }
      }
    }

    return false;
  }

  private isMapEntriesCall(expr: Expression): boolean {
    const e = expr as ExprBase;

    if (e.type === "variable") {
      const varName = (expr as VariableNode).name;
      return this.ctx.symbolTable.isMap(varName);
    }

    if (e.type === "member_access") {
      const memberExpr = expr as MemberAccessNode;
      const memberObjBase = memberExpr.object as ExprBase;
      const className = this.ctx.getCurrentClassName();
      if (memberObjBase.type === "this" && className) {
        const fieldInfoResult = this.ctx.classGenGetFieldInfo(className, memberExpr.property);
        const fieldInfo = fieldInfoResult as FieldInfo;
        if (fieldInfoResult && fieldInfo.tsType && fieldInfo.tsType.startsWith("Map<")) {
          return true;
        }
      }
    }

    if (e.type !== "method_call") return false;
    const methodCall = expr as MethodCallNode;
    if (methodCall.method !== "entries") return false;

    const objBase = methodCall.object as ExprBase;
    if (objBase.type === "variable") {
      const varName = (methodCall.object as VariableNode).name;
      return this.ctx.symbolTable.isMap(varName);
    }

    if (objBase.type === "member_access") {
      const memberExpr = methodCall.object as MemberAccessNode;
      const memberObjBase = memberExpr.object as ExprBase;
      const className = this.ctx.getCurrentClassName();
      if (memberObjBase.type === "this" && className) {
        const fieldInfoResult = this.ctx.classGenGetFieldInfo(className, memberExpr.property);
        const fieldInfo = fieldInfoResult as FieldInfo;
        if (fieldInfoResult && fieldInfo.tsType && fieldInfo.tsType.startsWith("Map<")) {
          return true;
        }
      }
    }

    return false;
  }

  generateSwitchStatement(stmt: Statement, params: string[]): string {
    if (stmt.type !== "switch") {
      return this.ctx.emitError("Expected switch statement", stmt.loc);
    }

    const switchStmt = stmt as SwitchStatement;
    const endLabel = this.nextLabel("switch_end");

    const discriminantValue = this.ctx.generateExpression(switchStmt.discriminant, params);
    const discriminantType = this.ctx.getVariableType(discriminantValue);
    const isString = discriminantType === "i8*";

    this.loopContinueLabels.push("");
    this.loopBreakLabels.push(endLabel);

    const caseLabels: string[] = [];
    let defaultLabelIndex: number = -1;

    for (let i = 0; i < switchStmt.cases.length; i++) {
      const caseItem = switchStmt.cases[i];
      if (!caseItem) continue;
      if (caseItem.test === null) {
        defaultLabelIndex = i;
        caseLabels.push(this.nextLabel("case_default"));
      } else {
        caseLabels.push(this.nextLabel("case"));
      }
    }

    const defaultLabel = defaultLabelIndex >= 0 ? caseLabels[defaultLabelIndex] : endLabel;

    let checkLabels: string[] = [];
    let testCaseCount = 0;
    for (let i = 0; i < switchStmt.cases.length; i++) {
      const caseItem = switchStmt.cases[i];
      if (!caseItem) continue;
      if (caseItem.test !== null) {
        testCaseCount++;
      }
    }

    for (let i = 0; i < testCaseCount; i++) {
      checkLabels.push(this.nextLabel("check"));
    }

    let checkIndex = 0;
    for (let i = 0; i < switchStmt.cases.length; i++) {
      const caseItem = switchStmt.cases[i];
      if (!caseItem) continue;
      if (caseItem.test !== null) {
        if (checkIndex > 0) {
          this.ctx.emitLabel(checkLabels[checkIndex - 1]);
        }

        const testValue = this.ctx.generateExpression(caseItem.test, params);

        if (isString) {
          const strCmp = this.ctx.emitCall(
            "i32",
            "@strcmp",
            `i8* ${discriminantValue}, i8* ${testValue}`,
          );
          const cmpResult = this.ctx.emitIcmp("eq", "i32", strCmp, "0");
          const nextLabel = checkIndex < testCaseCount - 1 ? checkLabels[checkIndex] : defaultLabel;
          this.ctx.emitBrCond(cmpResult, caseLabels[i], nextLabel);
        } else {
          const dblDiscriminant = this.ctx.ensureDouble(discriminantValue);
          const dblTest = this.ctx.ensureDouble(testValue);
          const cmpResult = this.nextTemp();
          this.emit(`${cmpResult} = fcmp oeq double ${dblDiscriminant}, ${dblTest}`);
          const nextLabel = checkIndex < testCaseCount - 1 ? checkLabels[checkIndex] : defaultLabel;
          this.ctx.emitBrCond(cmpResult, caseLabels[i], nextLabel);
        }
        checkIndex++;
      }
    }

    for (let i = 0; i < switchStmt.cases.length; i++) {
      const caseItem = switchStmt.cases[i];
      if (!caseItem) continue;
      this.ctx.emitLabel(caseLabels[i]);
      this.ctx.setCurrentLabel(caseLabels[i]);

      for (let j = 0; j < caseItem.consequent.length; j++) {
        const consequentStmt = caseItem.consequent[j];
        if (!consequentStmt) continue;
        if (consequentStmt.type === "break") {
          this.ctx.emitBr(endLabel);
        } else if (
          consequentStmt.type === "variable_declaration" ||
          consequentStmt.type === "return" ||
          consequentStmt.type === "if" ||
          consequentStmt.type === "assignment" ||
          consequentStmt.type === "throw" ||
          consequentStmt.type === "while" ||
          consequentStmt.type === "for" ||
          consequentStmt.type === "for_of" ||
          consequentStmt.type === "continue" ||
          consequentStmt.type === "try" ||
          consequentStmt.type === "switch"
        ) {
          this.ctx.generateBlock({ type: "block", statements: [consequentStmt] }, params);
        } else {
          this.ctx.generateExpression(consequentStmt as Expression, params);
        }
      }

      const lastStmt = caseItem.consequent[caseItem.consequent.length - 1];
      if (
        !lastStmt ||
        (lastStmt.type !== "break" && lastStmt.type !== "return" && lastStmt.type !== "throw")
      ) {
        const nextCaseLabel = i < switchStmt.cases.length - 1 ? caseLabels[i + 1] : endLabel;
        this.ctx.emitBr(nextCaseLabel);
      }
    }

    this.loopContinueLabels.pop();
    this.loopBreakLabels.pop();
    this.ctx.emitLabel(endLabel);

    return "0";
  }
}

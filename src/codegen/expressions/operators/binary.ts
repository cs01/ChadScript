import {
  Expression,
  SourceLocation,
  NumberNode,
  StringNode,
  MethodCallNode,
  IndexAccessNode,
} from "../../../ast/types.js";
import type { IStringGenerator } from "../../infrastructure/generator-context.js";
import { getWantsI1, setWantsI1 } from "../condition-generator.js";
import {
  emitPtrtoint,
  emitSitofp,
  emitFptosi,
  emitSRem,
  emitFcmp,
  emitAnd,
  emitOr,
  emitXor,
  emitZext,
  emitSext,
  emitTrunc,
  emitInttoptr,
} from "../../infrastructure/ir-builders.js";

interface ControlFlowGeneratorLike {
  generateLogicalOp(op: string, left: Expression, right: Expression, params: string[]): string;
}

export interface BinaryExpressionGeneratorContext {
  nextTemp(): string;
  nextLabel(prefix: string): string;
  getCurrentLabel(): string;
  emit(instruction: string): void;
  emitIcmp(pred: string, type: string, lhs: string, rhs: string): string;
  emitBr(label: string): void;
  emitBrCond(cond: string, thenLabel: string, elseLabel: string): void;
  emitLabel(name: string): void;
  emitCall(retType: string, func: string, args: string): string;
  emitBitcast(value: string, fromType: string, toType: string): string;
  isStringExpression(expr: Expression): boolean;
  variableTypes: Map<string, string>;
  getVariableType(name: string): string | undefined;
  setVariableType(name: string, type: string): void;
  ensureDouble(value: string): string;
  ensureI64(value: string): string;
  controlFlowGen: ControlFlowGeneratorLike;
  readonly stringGen: IStringGenerator;
  generateExpression(expr: Expression, params: string[]): string;
  emitError(message: string, loc?: SourceLocation, suggestion?: string): never;
  emitLoad(type: string, ptr: string): string;
  isUint8ArrayExpression(expr: Expression): boolean;
}

/**
 * BinaryExpressionGenerator
 *
 * Handles binary operations:
 * - Logical operators (&&, ||) with short-circuit evaluation
 * - String concatenation (+)
 * - Arithmetic operators (+, -, *, /, %)
 * - Bitwise operators (&, |, ^, <<, >>)
 * - Comparison operators (<, >, <=, >=, ==, !=, ===, !==)
 *   - String comparisons use strcmp
 *   - Numeric comparisons use fcmp
 */
export class BinaryExpressionGenerator {
  constructor(private ctx: BinaryExpressionGeneratorContext) {}

  generate(op: string, left: Expression, right: Expression, params: string[]): string {
    if (op === "&&" || op === "||" || op === "??") {
      const savedI1 = getWantsI1();
      setWantsI1(false);
      const result = this.ctx.controlFlowGen.generateLogicalOp(op, left, right, params);
      setWantsI1(savedI1);
      return result;
    }

    if (op === "+" && (this.ctx.isStringExpression(left) || this.ctx.isStringExpression(right))) {
      return this.ctx.stringGen.doGenerateStringConcat(left, right, params);
    }

    if (op === "===" || op === "!==" || op === "==" || op === "!=") {
      const charAtResult = this.tryOptimizeCharAtComparison(op, left, right, params);
      if (charAtResult !== "") return charAtResult;
    }

    if (
      op === "===" ||
      op === "!==" ||
      op === "==" ||
      op === "!=" ||
      op === "<" ||
      op === ">" ||
      op === "<=" ||
      op === ">="
    ) {
      const u8Result = this.tryOptimizeUint8ArrayComparison(op, left, right, params);
      if (u8Result !== "") return u8Result;
    }

    const leftValue = this.ctx.generateExpression(left, params);
    const rightValue = this.ctx.generateExpression(right, params);

    // Arithmetic operators (floating-point) — fast-math flags enable LLVM optimizations
    const arithMap: { [key: string]: string } = {
      "+": "fadd nnan ninf nsz arcp contract reassoc afn",
      "-": "fsub nnan ninf nsz arcp contract reassoc afn",
      "*": "fmul nnan ninf nsz arcp contract reassoc afn",
      "/": "fdiv nnan ninf nsz arcp contract reassoc afn",
    };

    // Bitwise operators (need to convert double -> i64 -> operate -> double)
    const bitwiseMap: { [key: string]: string } = {
      "&": "and",
      "|": "or",
      "^": "xor",
      "<<": "shl",
      ">>": "ashr", // arithmetic shift right (preserves sign)
      ">>>": "lshr", // logical shift right (zero-fill)
    };

    // Comparison operators (fcmp returns i1, need to extend to i32)
    const cmpMap: { [key: string]: string } = {
      "<": "olt", // ordered less than
      ">": "ogt", // ordered greater than
      "<=": "ole", // ordered less or equal
      ">=": "oge", // ordered greater or equal
      "==": "oeq", // ordered equal
      "!=": "une", // unordered not equal (true if NaN or not equal)
      "===": "oeq", // Strict equality (same as == for double)
      "!==": "une", // unordered not equal (true if NaN or not equal)
    };

    if (op === "**") {
      return this.generateExponentiation(leftValue, rightValue);
    } else if (op === "%") {
      return this.generateModulo(leftValue, rightValue, left, right);
    } else if (arithMap[op]) {
      return this.generateArithmetic(op, arithMap[op], leftValue, rightValue);
    } else if (bitwiseMap[op]) {
      return this.generateBitwise(op, bitwiseMap[op], leftValue, rightValue);
    } else if (cmpMap[op]) {
      return this.generateComparison(op, cmpMap[op], leftValue, rightValue, left, right);
    } else {
      return this.ctx.emitError(
        "Unknown operator: " + op,
        undefined,
        "supported operators: +, -, *, /, %, **, ==, !=, <, >, <=, >=, &&, ||, ??",
      );
    }
  }

  private generateArithmetic(_op: string, llvmOp: string, left: string, right: string): string {
    const leftType = this.ctx.getVariableType(left);
    const rightType = this.ctx.getVariableType(right);

    if (leftType === "i64" && rightType === "i64" && _op !== "/") {
      const i64Op = _op === "+" ? "add" : _op === "-" ? "sub" : "mul";
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = ${i64Op} i64 ${left}, ${right}`);
      this.ctx.setVariableType(temp, "i64");
      return temp;
    }

    if (leftType === "i8*" || (leftType && leftType.indexOf("*") !== -1)) {
      const asInt = emitPtrtoint(this.ctx, left, leftType, "i64");
      left = emitSitofp(this.ctx, asInt, "i64");
    } else {
      left = this.ctx.ensureDouble(left);
    }

    if (rightType === "i8*" || (rightType && rightType.indexOf("*") !== -1)) {
      const asInt = emitPtrtoint(this.ctx, right, rightType, "i64");
      right = emitSitofp(this.ctx, asInt, "i64");
    } else {
      right = this.ctx.ensureDouble(right);
    }

    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = ${llvmOp} double ${left}, ${right}`);
    this.ctx.setVariableType(temp, "double");
    return temp;
  }

  private isKnownInteger(expr: Expression): boolean {
    const exprTyped = expr as NumberNode;
    if (exprTyped.type === "number" && typeof exprTyped.value === "number") {
      return exprTyped.isFloat !== true && Number.isInteger(exprTyped.value);
    }
    return false;
  }

  private generateModulo(
    left: string,
    right: string,
    leftExpr: Expression,
    rightExpr: Expression,
  ): string {
    const leftType = this.ctx.getVariableType(left);
    const rightType = this.ctx.getVariableType(right);

    if (leftType === "i64" && rightType === "i64") {
      const isZero = this.ctx.emitIcmp("eq", "i64", right, "0");
      const sremLabel = this.ctx.nextLabel("mod_i64_srem");
      const zeroLabel = this.ctx.nextLabel("mod_i64_zero");
      const mergeLabel = this.ctx.nextLabel("mod_i64_merge");
      this.ctx.emitBrCond(isZero, zeroLabel, sremLabel);

      this.ctx.emitLabel(sremLabel);
      const sremVal = emitSRem(this.ctx, "i64", left, right);
      const sremEnd = this.ctx.getCurrentLabel();
      this.ctx.emitBr(mergeLabel);

      this.ctx.emitLabel(zeroLabel);
      const zeroEnd = this.ctx.getCurrentLabel();
      this.ctx.emitBr(mergeLabel);

      this.ctx.emitLabel(mergeLabel);
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = phi i64 [ ${sremVal}, %${sremEnd} ], [ 0, %${zeroEnd} ]`);
      this.ctx.setVariableType(temp, "i64");
      return temp;
    }

    if (leftType === "i8*" || (leftType && leftType.indexOf("*") !== -1)) {
      const asInt = emitPtrtoint(this.ctx, left, leftType, "i64");
      left = emitSitofp(this.ctx, asInt, "i64");
    } else {
      left = this.ctx.ensureDouble(left);
    }

    if (rightType === "i8*" || (rightType && rightType.indexOf("*") !== -1)) {
      const asInt = emitPtrtoint(this.ctx, right, rightType, "i64");
      right = emitSitofp(this.ctx, asInt, "i64");
    } else {
      right = this.ctx.ensureDouble(right);
    }

    const leftIsKnown = this.isKnownInteger(leftExpr);
    const rightIsKnown = this.isKnownInteger(rightExpr);

    if (leftIsKnown && rightIsKnown) {
      const rightIsZero = emitFcmp(this.ctx, "oeq", right, "0.0");
      const knownSremLabel = this.ctx.nextLabel("mod_known_srem");
      const knownNanLabel = this.ctx.nextLabel("mod_known_nan");
      const knownMergeLabel = this.ctx.nextLabel("mod_known_merge");
      this.ctx.emitBrCond(rightIsZero, knownNanLabel, knownSremLabel);

      this.ctx.emitLabel(knownSremLabel);
      const leftInt = emitFptosi(this.ctx, left, "i64");
      const rightInt = emitFptosi(this.ctx, right, "i64");
      const sremResult = emitSRem(this.ctx, "i64", leftInt, rightInt);
      const intResult = emitSitofp(this.ctx, sremResult, "i64");
      const knownSremEnd = this.ctx.getCurrentLabel();
      this.ctx.emitBr(knownMergeLabel);

      this.ctx.emitLabel(knownNanLabel);
      const knownNanEnd = this.ctx.getCurrentLabel();
      this.ctx.emitBr(knownMergeLabel);

      this.ctx.emitLabel(knownMergeLabel);
      const result = this.ctx.nextTemp();
      this.ctx.emit(
        `${result} = phi double [ ${intResult}, %${knownSremEnd} ], [ 0x7FF8000000000000, %${knownNanEnd} ]`,
      );
      this.ctx.setVariableType(result, "double");
      return result;
    }

    let bothInt: string;
    if (leftIsKnown) {
      const rightTrunc = this.ctx.emitCall("double", "@llvm.trunc.f64", `double ${right}`);
      bothInt = emitFcmp(this.ctx, "oeq", right, rightTrunc);
    } else if (rightIsKnown) {
      const leftTrunc = this.ctx.emitCall("double", "@llvm.trunc.f64", `double ${left}`);
      bothInt = emitFcmp(this.ctx, "oeq", left, leftTrunc);
    } else {
      const leftTrunc = this.ctx.emitCall("double", "@llvm.trunc.f64", `double ${left}`);
      const leftIsInt = emitFcmp(this.ctx, "oeq", left, leftTrunc);

      const rightTrunc = this.ctx.emitCall("double", "@llvm.trunc.f64", `double ${right}`);
      const rightIsInt = emitFcmp(this.ctx, "oeq", right, rightTrunc);

      bothInt = emitAnd(this.ctx, "i1", leftIsInt, rightIsInt);
    }

    const intModLabel = this.ctx.nextLabel("mod_int");
    const floatModLabel = this.ctx.nextLabel("mod_float");
    const mergeLabel = this.ctx.nextLabel("mod_merge");

    this.ctx.emitBrCond(bothInt, intModLabel, floatModLabel);

    this.ctx.emitLabel(intModLabel);
    const leftInt = emitFptosi(this.ctx, left, "i64");
    const rightInt = emitFptosi(this.ctx, right, "i64");
    const dynIsZero = this.ctx.emitIcmp("eq", "i64", rightInt, "0");
    const dynSremLabel = this.ctx.nextLabel("mod_dyn_srem");
    const dynNanLabel = this.ctx.nextLabel("mod_dyn_nan");
    this.ctx.emitBrCond(dynIsZero, dynNanLabel, dynSremLabel);

    this.ctx.emitLabel(dynSremLabel);
    const sremResult = emitSRem(this.ctx, "i64", leftInt, rightInt);
    const intResult = emitSitofp(this.ctx, sremResult, "i64");
    const intBranchEnd = this.ctx.getCurrentLabel();
    this.ctx.emitBr(mergeLabel);

    this.ctx.emitLabel(dynNanLabel);
    const dynNanEnd = this.ctx.getCurrentLabel();
    this.ctx.emitBr(mergeLabel);

    this.ctx.emitLabel(floatModLabel);
    const fremResult = this.ctx.nextTemp();
    this.ctx.emit(`${fremResult} = frem nsz arcp contract reassoc afn double ${left}, ${right}`);
    const floatBranchEnd = this.ctx.getCurrentLabel();
    this.ctx.emitBr(mergeLabel);

    this.ctx.emitLabel(mergeLabel);
    const result = this.ctx.nextTemp();
    this.ctx.emit(
      `${result} = phi double [ ${intResult}, %${intBranchEnd} ], [ 0x7FF8000000000000, %${dynNanEnd} ], [ ${fremResult}, %${floatBranchEnd} ]`,
    );
    this.ctx.setVariableType(result, "double");
    return result;
  }

  private generateBitwise(_op: string, llvmOp: string, left: string, right: string): string {
    const leftType = this.ctx.getVariableType(left);
    const rightType = this.ctx.getVariableType(right);

    let leftInt: string;
    if (leftType === "i64") {
      leftInt = left;
    } else if (leftType === "i8*" || (leftType && leftType.indexOf("*") !== -1)) {
      leftInt = emitPtrtoint(this.ctx, left, leftType, "i64");
    } else {
      leftInt = emitFptosi(this.ctx, left, "i64");
    }

    let rightInt: string;
    if (rightType === "i64") {
      rightInt = right;
    } else if (rightType === "i8*" || (rightType && rightType.indexOf("*") !== -1)) {
      rightInt = emitPtrtoint(this.ctx, right, rightType, "i64");
    } else {
      rightInt = emitFptosi(this.ctx, right, "i64");
    }

    const resultInt = this.ctx.nextTemp();
    this.ctx.emit(`${resultInt} = ${llvmOp} i64 ${leftInt}, ${rightInt}`);
    this.ctx.setVariableType(resultInt, "i64");
    return resultInt;
  }

  private generateExponentiation(left: string, right: string): string {
    const dblLeft = this.ctx.ensureDouble(left);
    const dblRight = this.ctx.ensureDouble(right);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call double @llvm.pow.f64(double ${dblLeft}, double ${dblRight})`);
    this.ctx.setVariableType(result, "double");
    return result;
  }

  private generateComparison(
    op: string,
    cond: string,
    leftValue: string,
    rightValue: string,
    leftExpr: Expression,
    rightExpr: Expression,
  ): string {
    const leftIsNullish = leftExpr.type === "null" || leftExpr.type === "undefined";
    const rightIsNullish = rightExpr.type === "null" || rightExpr.type === "undefined";
    if (leftIsNullish || rightIsNullish) {
      return this.generatePointerNullComparison(op, leftValue, rightValue);
    }

    const leftIsString = this.ctx.isStringExpression(leftExpr);
    const rightIsString = this.ctx.isStringExpression(rightExpr);

    const leftType = this.ctx.getVariableType(leftValue) || "double";
    const rightType = this.ctx.getVariableType(rightValue) || "double";
    const leftIsStringType = leftType === "i8*" || leftValue.startsWith("@.str");
    const rightIsStringType = rightType === "i8*" || rightValue.startsWith("@.str");

    const leftIsJSONi32 = leftType === "i32";
    const rightIsJSONi32 = rightType === "i32";

    const isStringOp =
      ((leftIsString || leftIsStringType) && (rightIsString || rightIsStringType)) ||
      (leftIsJSONi32 && (rightIsString || rightIsStringType)) ||
      ((leftIsString || leftIsStringType) && rightIsJSONi32) ||
      (leftIsJSONi32 && rightIsJSONi32);

    if (isStringOp) {
      const singleCharResult = this.tryOptimizeSingleCharLiteralComparison(
        op,
        leftValue,
        rightValue,
        leftExpr,
        rightExpr,
      );
      if (singleCharResult !== "") return singleCharResult;
      return this.generateStringComparison(op, leftValue, rightValue);
    }

    return this.generateNumericComparison(cond, leftValue, rightValue);
  }

  private generateStringComparison(op: string, left: string, right: string): string {
    const leftType = this.ctx.getVariableType(left);
    const rightType = this.ctx.getVariableType(right);

    let leftPtr = left;
    let rightPtr = right;

    if (leftType === "i32") {
      leftPtr = emitInttoptr(this.ctx, left, "i32", "i8*");
    }

    if (rightType === "i32") {
      rightPtr = emitInttoptr(this.ctx, right, "i32", "i8*");
    }

    const leftNull = this.ctx.emitIcmp("eq", "i8*", leftPtr, "null");
    const rightNull = this.ctx.emitIcmp("eq", "i8*", rightPtr, "null");
    const eitherNull = emitOr(this.ctx, "i1", leftNull, rightNull);

    const nullCheckLabel = this.ctx.nextLabel("strcmp_null_check");
    const strcmpLabel = this.ctx.nextLabel("strcmp_call");
    const mergeLabel = this.ctx.nextLabel("strcmp_merge");

    this.ctx.emitBrCond(eitherNull, nullCheckLabel, strcmpLabel);

    this.ctx.emitLabel(nullCheckLabel);
    const bothNull = emitAnd(this.ctx, "i1", leftNull, rightNull);
    let nullResult: string;
    if (op === "==" || op === "===") {
      nullResult = bothNull;
    } else if (op === "!=" || op === "!==") {
      nullResult = emitXor(this.ctx, "i1", bothNull, "true");
    } else {
      const falseVal = this.ctx.emitIcmp("eq", "i32", "0", "1");
      nullResult = falseVal;
    }
    const nullResultInt = emitZext(this.ctx, nullResult, "i1", "i32");
    const nullBranchEnd = this.ctx.getCurrentLabel();
    this.ctx.emitBr(mergeLabel);

    this.ctx.emitLabel(strcmpLabel);
    const strcmpResult = this.ctx.emitCall("i32", "@strcmp", `i8* ${leftPtr}, i8* ${rightPtr}`);

    let cmpResult: string;
    if (op === "==" || op === "===") {
      cmpResult = this.ctx.emitIcmp("eq", "i32", strcmpResult, "0");
    } else if (op === "!=" || op === "!==") {
      cmpResult = this.ctx.emitIcmp("ne", "i32", strcmpResult, "0");
    } else if (op === "<") {
      cmpResult = this.ctx.emitIcmp("slt", "i32", strcmpResult, "0");
    } else if (op === ">") {
      cmpResult = this.ctx.emitIcmp("sgt", "i32", strcmpResult, "0");
    } else if (op === "<=") {
      cmpResult = this.ctx.emitIcmp("sle", "i32", strcmpResult, "0");
    } else if (op === ">=") {
      cmpResult = this.ctx.emitIcmp("sge", "i32", strcmpResult, "0");
    } else {
      cmpResult = this.ctx.emitIcmp("eq", "i32", strcmpResult, "0");
    }
    const strcmpResultInt = emitZext(this.ctx, cmpResult, "i1", "i32");
    const strcmpBranchEnd = this.ctx.getCurrentLabel();
    this.ctx.emitBr(mergeLabel);

    this.ctx.emitLabel(mergeLabel);
    const i32Result = this.ctx.nextTemp();
    this.ctx.emit(
      `${i32Result} = phi i32 [ ${nullResultInt}, %${nullBranchEnd} ], [ ${strcmpResultInt}, %${strcmpBranchEnd} ]`,
    );
    const extResult = emitSitofp(this.ctx, i32Result, "i32");
    return extResult;
  }

  private generateNumericComparison(cond: string, left: string, right: string): string {
    const leftType = this.ctx.getVariableType(left);
    const rightType = this.ctx.getVariableType(right);

    if (leftType === "i64" && rightType === "i64") {
      const icmpCond =
        cond === "olt"
          ? "slt"
          : cond === "ogt"
            ? "sgt"
            : cond === "ole"
              ? "sle"
              : cond === "oge"
                ? "sge"
                : cond === "oeq"
                  ? "eq"
                  : "ne";
      const cmpResult = this.ctx.emitIcmp(icmpCond, "i64", left, right);
      if (getWantsI1()) {
        setWantsI1(false);
        return cmpResult;
      }
      return emitZext(this.ctx, cmpResult, "i1", "i64");
    }

    let leftDouble = left;
    let rightDouble = right;

    if (leftType === "i32") {
      leftDouble = emitSitofp(this.ctx, left, "i32");
    } else if (leftType === "i8*" || (leftType && leftType.indexOf("*") !== -1)) {
      const asInt = emitPtrtoint(this.ctx, left, leftType, "i64");
      leftDouble = emitSitofp(this.ctx, asInt, "i64");
    } else {
      leftDouble = this.ctx.ensureDouble(left);
    }

    if (rightType === "i32") {
      rightDouble = emitSitofp(this.ctx, right, "i32");
    } else if (rightType === "i8*" || (rightType && rightType.indexOf("*") !== -1)) {
      const asInt = emitPtrtoint(this.ctx, right, rightType, "i64");
      rightDouble = emitSitofp(this.ctx, asInt, "i64");
    } else {
      rightDouble = this.ctx.ensureDouble(right);
    }

    const cmpResult = emitFcmp(this.ctx, cond, leftDouble, rightDouble);

    if (getWantsI1()) {
      setWantsI1(false);
      this.ctx.setVariableType(cmpResult, "i1");
      return cmpResult;
    }

    const i32Result = emitZext(this.ctx, cmpResult, "i1", "i32");
    const doubleResult = emitSitofp(this.ctx, i32Result, "i32");
    return doubleResult;
  }

  private generatePointerNullComparison(op: string, left: string, right: string): string {
    const leftType = this.ctx.getVariableType(left) || "i8*";
    const rightType = this.ctx.getVariableType(right) || "i8*";
    let leftPtr = left;
    let rightPtr = right;
    if (leftType !== "i8*" && leftType.indexOf("*") !== -1) {
      leftPtr = this.ctx.emitBitcast(left, leftType, "i8*");
    } else if (leftType === "double") {
      const asInt = this.ctx.nextTemp();
      this.ctx.emit(`${asInt} = bitcast double ${left} to i64`);
      leftPtr = emitInttoptr(this.ctx, asInt, "i64", "i8*");
    } else if (leftType === "i64") {
      leftPtr = emitInttoptr(this.ctx, left, "i64", "i8*");
    }
    if (rightType !== "i8*" && rightType.indexOf("*") !== -1) {
      rightPtr = this.ctx.emitBitcast(right, rightType, "i8*");
    } else if (rightType === "double") {
      const asInt = this.ctx.nextTemp();
      this.ctx.emit(`${asInt} = bitcast double ${right} to i64`);
      rightPtr = emitInttoptr(this.ctx, asInt, "i64", "i8*");
    } else if (rightType === "i64") {
      rightPtr = emitInttoptr(this.ctx, right, "i64", "i8*");
    }
    let cond = "";
    if (op === "==" || op === "===") {
      cond = "eq";
    } else if (op === "!=" || op === "!==") {
      cond = "ne";
    } else {
      cond = "eq";
    }
    const cmpResult = this.ctx.emitIcmp(cond, "i8*", leftPtr, rightPtr);
    const i32Result = emitZext(this.ctx, cmpResult, "i1", "i32");
    const doubleResult = emitSitofp(this.ctx, i32Result, "i32");
    return doubleResult;
  }

  private getSingleCharCode(expr: Expression): number {
    if (expr.type !== "string") return -1;
    const s = (expr as StringNode).value;
    if (s.length !== 1) return -1;
    return s.charCodeAt(0);
  }

  private isCharAtCall(expr: Expression): boolean {
    if (expr.type !== "method_call") return false;
    const mc = expr as MethodCallNode;
    return mc.method === "charAt" && mc.args.length === 1;
  }

  private tryOptimizeCharAtComparison(
    op: string,
    left: Expression,
    right: Expression,
    params: string[],
  ): string {
    let charAtExpr: MethodCallNode;
    let charCode: number;

    if (this.isCharAtCall(left) && this.getSingleCharCode(right) >= 0) {
      charAtExpr = left as MethodCallNode;
      charCode = this.getSingleCharCode(right);
    } else if (this.isCharAtCall(right) && this.getSingleCharCode(left) >= 0) {
      charAtExpr = right as MethodCallNode;
      charCode = this.getSingleCharCode(left);
    } else {
      return "";
    }

    const strPtr = this.ctx.generateExpression(charAtExpr.object, params);
    const indexValue = this.ctx.generateExpression(charAtExpr.args[0], params);

    const indexType = this.ctx.getVariableType(indexValue);
    let indexI64: string;
    if (indexType === "i64") {
      indexI64 = indexValue;
    } else if (indexType === "double" || !indexType) {
      indexI64 = emitFptosi(this.ctx, indexValue, "i64");
    } else if (indexType === "i32") {
      indexI64 = emitSext(this.ctx, indexValue, "i32", "i64");
    } else {
      indexI64 = indexValue;
    }

    const isNeg = this.ctx.emitIcmp("slt", "i64", indexI64, "0");

    const loadLabel = this.ctx.nextLabel("charat_cmp_load");
    const negLabel = this.ctx.nextLabel("charat_cmp_neg");
    const endLabel = this.ctx.nextLabel("charat_cmp_end");

    this.ctx.emitBrCond(isNeg, negLabel, loadLabel);

    this.ctx.emitLabel(loadLabel);
    const strLen = this.ctx.emitCall("i64", "@cs_cached_strlen", `i8* ${strPtr}`);
    const inBounds = this.ctx.emitIcmp("slt", "i64", indexI64, strLen);

    const cmpLabel = this.ctx.nextLabel("charat_cmp_do");
    const oobLabel = this.ctx.nextLabel("charat_cmp_oob");
    this.ctx.emitBrCond(inBounds, cmpLabel, oobLabel);

    this.ctx.emitLabel(cmpLabel);
    const charPtr = this.ctx.nextTemp();
    this.ctx.emit(`${charPtr} = getelementptr inbounds i8, i8* ${strPtr}, i64 ${indexI64}`);
    const charByte = this.ctx.emitLoad("i8", charPtr);
    const isEq = op === "===" || op === "==";
    const cmpPred = isEq ? "eq" : "ne";
    const validCmp = this.ctx.emitIcmp(cmpPred, "i8", charByte, `${charCode}`);
    const validI32 = emitZext(this.ctx, validCmp, "i1", "i32");
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(oobLabel);
    const oobVal = isEq ? "0" : "1";
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(negLabel);
    const negVal = isEq ? "0" : "1";
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(endLabel);
    const resultI32 = this.ctx.nextTemp();
    this.ctx.emit(
      `${resultI32} = phi i32 [${validI32}, %${cmpLabel}], [${oobVal}, %${oobLabel}], [${negVal}, %${negLabel}]`,
    );
    const result = emitSitofp(this.ctx, resultI32, "i32");
    return result;
  }

  private isUint8ArrayIndexAccess(expr: Expression): boolean {
    if (expr.type !== "index_access") return false;
    const ia = expr as IndexAccessNode;
    return this.ctx.isUint8ArrayExpression(ia.object);
  }

  private getSmallIntLiteral(expr: Expression): number {
    if (expr.type !== "number") return -1;
    const val = (expr as NumberNode).value;
    if (val < 0 || val > 255 || Math.floor(val) !== val) return -1;
    return val;
  }

  private tryOptimizeUint8ArrayComparison(
    op: string,
    left: Expression,
    right: Expression,
    params: string[],
  ): string {
    let u8Expr: IndexAccessNode;
    let literalVal: number;

    if (this.isUint8ArrayIndexAccess(left) && this.getSmallIntLiteral(right) >= 0) {
      u8Expr = left as IndexAccessNode;
      literalVal = this.getSmallIntLiteral(right);
    } else if (this.isUint8ArrayIndexAccess(right) && this.getSmallIntLiteral(left) >= 0) {
      u8Expr = right as IndexAccessNode;
      literalVal = this.getSmallIntLiteral(left);
    } else {
      return "";
    }

    const arrayPtr = this.ctx.generateExpression(u8Expr.object, params);
    const indexDouble = this.ctx.generateExpression(u8Expr.index, params);
    const indexType = this.ctx.getVariableType(indexDouble);
    let index = indexDouble;
    if (indexType === "double" || !indexType) {
      index = emitFptosi(this.ctx, indexDouble, "i32");
    } else if (indexType === "i64") {
      index = emitTrunc(this.ctx, indexDouble, "i64", "i32");
    }

    const dataFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${dataFieldPtr} = getelementptr inbounds %Uint8Array, %Uint8Array* ${arrayPtr}, i32 0, i32 0`,
    );
    const dataPtr = this.ctx.emitLoad("i8*", dataFieldPtr);
    const elemPtr = this.ctx.nextTemp();
    this.ctx.emit(`${elemPtr} = getelementptr inbounds i8, i8* ${dataPtr}, i32 ${index}`);
    const byteVal = this.ctx.emitLoad("i8", elemPtr);

    const icmpPred =
      op === "===" || op === "=="
        ? "eq"
        : op === "!==" || op === "!="
          ? "ne"
          : op === "<"
            ? "ult"
            : op === ">"
              ? "ugt"
              : op === "<="
                ? "ule"
                : "uge";

    const swapped = this.isUint8ArrayIndexAccess(right) && this.getSmallIntLiteral(left) >= 0;
    const lhs = swapped ? `${literalVal}` : byteVal;
    const rhs = swapped ? byteVal : `${literalVal}`;
    const cmpResult = this.ctx.emitIcmp(icmpPred, "i8", lhs, rhs);

    const i32Result = emitZext(this.ctx, cmpResult, "i1", "i32");
    return emitSitofp(this.ctx, i32Result, "i32");
  }

  private tryOptimizeSingleCharLiteralComparison(
    op: string,
    leftValue: string,
    rightValue: string,
    leftExpr: Expression,
    rightExpr: Expression,
  ): string {
    let strValue: string;
    let charCode: number;

    const leftCode = this.getSingleCharCode(leftExpr);
    const rightCode = this.getSingleCharCode(rightExpr);

    if (leftCode >= 0 && rightCode < 0) {
      charCode = leftCode;
      strValue = rightValue;
    } else if (rightCode >= 0 && leftCode < 0) {
      charCode = rightCode;
      strValue = leftValue;
    } else {
      return "";
    }

    const strType = this.ctx.getVariableType(strValue);
    if (strType !== "i8*" && !strValue.startsWith("@.str")) return "";

    const byte = this.ctx.emitLoad("i8", strValue);
    const secondPtr = this.ctx.nextTemp();
    this.ctx.emit(`${secondPtr} = getelementptr inbounds i8, i8* ${strValue}, i64 1`);
    const secondByte = this.ctx.emitLoad("i8", secondPtr);

    const byteMatch = this.ctx.emitIcmp("eq", "i8", byte, `${charCode}`);
    const isNull = this.ctx.emitIcmp("eq", "i8", secondByte, "0");
    const isSingleChar = emitAnd(this.ctx, "i1", byteMatch, isNull);

    const isEq = op === "===" || op === "==";
    const isNe = op === "!==" || op === "!=";
    if (!isEq && !isNe) return "";
    let cmpBool: string;
    if (isEq) {
      cmpBool = isSingleChar;
    } else {
      cmpBool = emitXor(this.ctx, "i1", isSingleChar, "true");
    }

    const i32Result = emitZext(this.ctx, cmpBool, "i1", "i32");
    return emitSitofp(this.ctx, i32Result, "i32");
  }
}

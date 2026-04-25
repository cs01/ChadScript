import { Expression, MemberAccessNode, VariableNode, SourceLocation } from "../../../ast/types.js";
import type { SymbolTable } from "../../infrastructure/symbol-table.js";
import type { IStringGenerator } from "../../infrastructure/generator-context.js";
import type { FieldInfo } from "../../infrastructure/type-resolver/types.js";
import {
  emitAdd,
  emitFcmp,
  emitSitofp,
  emitZext,
  emitSub,
  emitFptosi,
  emitXor,
} from "../../infrastructure/ir-builders.js";

interface ExprBase {
  type: string;
}

interface UnaryExpressionContext {
  nextTemp(): string;
  emit(instruction: string): void;
  getVariableType(name: string): string | undefined;
  setVariableType(name: string, type: string): void;
  getVariableAlloca(name: string): string | undefined;
  getThisPointer(): string | null;
  getCurrentClassName(): string | null;
  hasClassGen(): boolean;
  classGenGetFieldInfo(className: string | null, fieldName: string | null): FieldInfo | null;
  generateExpression(expr: Expression, params: string[]): string;
  ensureDouble(value: string): string;
  readonly stringGen: IStringGenerator;
  readonly symbolTable: SymbolTable;
  emitError(message: string, loc?: SourceLocation, suggestion?: string): never;
}

export class UnaryExpressionGenerator {
  constructor(private ctx: UnaryExpressionContext) {}

  generate(op: string, operand: Expression, params: string[]): string {
    if (op === "post++" || op === "post--") {
      return this.generatePostIncDec(op, operand, params);
    }

    if (op === "++" || op === "--") {
      return this.generatePreIncDec(op, operand, params);
    }

    if (op === "typeof") {
      return this.generateTypeof(operand, params);
    }

    const operandValue = this.ctx.generateExpression(operand, params);

    if (op === "!") {
      return this.generateLogicalNot(operandValue);
    }

    if (op === "-") {
      return this.generateNegation(operandValue);
    }

    if (op === "+") {
      return operandValue;
    }

    if (op === "~") {
      return this.generateBitwiseNot(operandValue);
    }

    return this.ctx.emitError(
      "Unknown unary operator: " + op,
      undefined,
      "supported operators: !, -, +, ~, typeof, ++, --",
    );
  }

  private generatePostIncDec(op: string, operand: Expression, _params: string[]): string {
    if (operand.type === "member_access") {
      return this.generateMemberAccessIncDec(op, operand as MemberAccessNode, true);
    }

    if (operand.type !== "variable") {
      return this.ctx.emitError("Post-increment/decrement requires a variable operand");
    }
    const operandVar = operand as VariableNode;
    const varName = operandVar.name;
    const allocaReg = this.ctx.getVariableAlloca(varName);
    if (!allocaReg) {
      return this.ctx.emitError(`Cannot find alloca for variable: ${varName}`);
    }

    const varLlvmType = this.ctx.getVariableType(varName) || "double";
    if (varLlvmType === "i64") {
      const originalValue = this.ctx.nextTemp();
      this.ctx.emit(`${originalValue} = load i64, i64* ${allocaReg}`);
      this.ctx.setVariableType(originalValue, "i64");

      const delta = op === "post++" ? "1" : "-1";
      const newValue = emitAdd(this.ctx, "i64", originalValue, delta);

      this.ctx.emit(`store i64 ${newValue}, i64* ${allocaReg}`);

      return originalValue;
    }

    const originalValue = this.ctx.nextTemp();
    this.ctx.emit(`${originalValue} = load double, double* ${allocaReg}`);
    this.ctx.setVariableType(originalValue, "double");

    const delta = op === "post++" ? "1.0" : "-1.0";
    const newValue = this.ctx.nextTemp();
    this.ctx.emit(
      `${newValue} = fadd nsz arcp contract reassoc afn double ${originalValue}, ${delta}`,
    );
    this.ctx.setVariableType(newValue, "double");

    this.ctx.emit(`store double ${newValue}, double* ${allocaReg}`);

    return originalValue;
  }

  private generatePreIncDec(op: string, operand: Expression, _params: string[]): string {
    if (operand.type === "member_access") {
      return this.generateMemberAccessIncDec(op, operand as MemberAccessNode, false);
    }

    if (operand.type !== "variable") {
      return this.ctx.emitError("Pre-increment/decrement requires a variable operand");
    }
    const operandVarPre = operand as VariableNode;
    const varName = operandVarPre.name;
    const allocaReg = this.ctx.getVariableAlloca(varName);
    if (!allocaReg) {
      return this.ctx.emitError(`Cannot find alloca for variable: ${varName}`);
    }

    const varLlvmType = this.ctx.getVariableType(varName) || "double";
    if (varLlvmType === "i64") {
      const originalValue = this.ctx.nextTemp();
      this.ctx.emit(`${originalValue} = load i64, i64* ${allocaReg}`);
      this.ctx.setVariableType(originalValue, "i64");

      const delta = op === "++" ? "1" : "-1";
      const newValue = emitAdd(this.ctx, "i64", originalValue, delta);

      this.ctx.emit(`store i64 ${newValue}, i64* ${allocaReg}`);

      return newValue;
    }

    const originalValue = this.ctx.nextTemp();
    this.ctx.emit(`${originalValue} = load double, double* ${allocaReg}`);

    const delta = op === "++" ? "1.0" : "-1.0";
    const newValue = this.ctx.nextTemp();
    this.ctx.emit(
      `${newValue} = fadd nsz arcp contract reassoc afn double ${originalValue}, ${delta}`,
    );
    this.ctx.setVariableType(newValue, "double");

    this.ctx.emit(`store double ${newValue}, double* ${allocaReg}`);

    return newValue;
  }

  private generateLogicalNot(operand: string): string {
    const operandType = this.ctx.getVariableType(operand);
    let cmpResult: string;

    if (operandType === "i64") {
      cmpResult = this.ctx.nextTemp();
      this.ctx.emit(`${cmpResult} = icmp eq i64 ${operand}, 0`);
    } else if (
      operandType === "double" ||
      (operand.indexOf(".") !== -1 && !operand.startsWith("%"))
    ) {
      cmpResult = emitFcmp(this.ctx, "oeq", operand, "0.0");
    } else if (operandType && operandType.indexOf("*") !== -1) {
      cmpResult = this.ctx.nextTemp();
      this.ctx.emit(`${cmpResult} = icmp eq ${operandType} ${operand}, null`);
    } else if (operandType === "i32") {
      const operandDouble = emitSitofp(this.ctx, operand, "i32");
      cmpResult = emitFcmp(this.ctx, "oeq", operandDouble, "0.0");
    } else {
      cmpResult = emitFcmp(this.ctx, "oeq", operand, "0.0");
    }

    const i64Result = emitZext(this.ctx, cmpResult, "i1", "i64");
    return i64Result;
  }

  private generateNegation(operand: string): string {
    const operandType = this.ctx.getVariableType(operand);
    if (operandType === "i64") {
      return emitSub(this.ctx, "i64", "0", operand);
    }
    const dblOperand = this.ctx.ensureDouble(operand);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = fneg double ${dblOperand}`);
    this.ctx.setVariableType(result, "double");
    return result;
  }

  private generateMemberAccessIncDec(
    op: string,
    memberExpr: MemberAccessNode,
    isPost: boolean,
  ): string {
    const memberExprObjBase = memberExpr.object as ExprBase;
    if (memberExprObjBase.type !== "this") {
      return this.ctx.emitError(
        "Increment/decrement on member access only supported for 'this' fields",
      );
    }

    const thisPtr = this.ctx.getThisPointer();
    const className = this.ctx.getCurrentClassName();
    if (!thisPtr || !className || !this.ctx.hasClassGen()) {
      return this.ctx.emitError("this.field increment/decrement used outside of class method");
    }

    const fieldName = memberExpr.property;
    const fieldInfoResult = this.ctx.classGenGetFieldInfo(className, fieldName);
    if (!fieldInfoResult) {
      return this.ctx.emitError("Cannot find field '" + fieldName + "' in class " + className);
    }
    const fieldInfo = fieldInfoResult as FieldInfo;

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${thisPtr}, i32 0, i32 ${fieldInfo.index}`,
    );

    const originalValue = this.ctx.nextTemp();
    this.ctx.emit(`${originalValue} = load double, double* ${fieldPtr}`);
    this.ctx.setVariableType(originalValue, "double");

    const isIncrement = op === "post++" || op === "++";
    const delta = isIncrement ? "1.0" : "-1.0";
    const newValue = this.ctx.nextTemp();
    this.ctx.emit(
      `${newValue} = fadd nsz arcp contract reassoc afn double ${originalValue}, ${delta}`,
    );
    this.ctx.setVariableType(newValue, "double");

    this.ctx.emit(`store double ${newValue}, double* ${fieldPtr}`);

    return isPost ? originalValue : newValue;
  }

  private generateBitwiseNot(operand: string): string {
    const operandType = this.ctx.getVariableType(operand);
    let intVal: string;
    if (operandType === "i64") {
      intVal = operand;
    } else {
      intVal = emitFptosi(this.ctx, operand, "i64");
    }
    const result = emitXor(this.ctx, "i64", intVal, "-1");
    return result;
  }

  private generateTypeof(operand: Expression, params: string[]): string {
    let typeString: string;

    if (operand.type === "string") {
      typeString = "string";
    } else if (operand.type === "number") {
      typeString = "number";
    } else if (operand.type === "boolean") {
      typeString = "boolean";
    } else if (operand.type === "null") {
      typeString = "object";
    } else if (operand.type === "undefined") {
      typeString = "undefined";
    } else if (operand.type === "arrow_function") {
      typeString = "function";
    } else if (operand.type === "variable") {
      const varName = (operand as VariableNode).name;
      if (varName === "undefined") {
        typeString = "undefined";
      } else if (this.ctx.symbolTable.isString(varName)) {
        typeString = "string";
      } else if (this.ctx.symbolTable.isBoolean(varName)) {
        typeString = "boolean";
      } else if (this.ctx.symbolTable.isClosure(varName)) {
        typeString = "function";
      } else {
        const operandValue = this.ctx.generateExpression(operand, params);
        const operandType = this.ctx.getVariableType(operandValue);
        if (operandType === "double" || operandType === "i64") {
          typeString = "number";
        } else {
          typeString = "object";
        }
      }
    } else {
      const operandValue = this.ctx.generateExpression(operand, params);
      const operandType = this.ctx.getVariableType(operandValue);
      if (operandType === "double" || operandType === "i64") {
        typeString = "number";
      } else {
        typeString = "object";
      }
    }

    const strPtr = this.ctx.stringGen.doCreateStringConstant(typeString);
    this.ctx.setVariableType(strPtr, "i8*");
    return strPtr;
  }
}

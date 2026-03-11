import type {
  Expression,
  MethodCallNode,
  VariableNode,
  MemberAccessNode,
} from "../../../ast/types.js";
import { parseSetTypeString } from "../../infrastructure/type-system.js";
import type { MethodCallGeneratorContext } from "../method-calls.js";

interface ExprBase {
  type: string;
}

function setGetVariableName(expr: Expression): string | null {
  const e = expr as ExprBase;
  if (e.type === "variable") {
    return (expr as VariableNode).name;
  }
  return null;
}

function getThisFieldSetValueType(
  ctx: MethodCallGeneratorContext,
  expr: Expression,
): string | null {
  const result = ctx.typeResolver?.getThisFieldSetValueType(expr);
  if (result) {
    return result;
  }

  const e = expr as ExprBase;
  if (e.type !== "member_access") return null;
  const memberExpr = expr as MemberAccessNode;
  const objBase = memberExpr.object as ExprBase;
  if (objBase.type !== "this") return null;

  const classNameForSet = ctx.getCurrentClassName();
  if (!classNameForSet) return null;
  const fieldInfoResult = ctx.classGenGetFieldInfo(classNameForSet, memberExpr.property);
  if (!fieldInfoResult || !fieldInfoResult.tsType) return null;

  const setParsed = parseSetTypeString(fieldInfoResult.tsType);
  if (!setParsed) return null;
  return setParsed.valueType;
}

export function dispatchSetMethod(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  const varName = setGetVariableName(expr.object);
  if (varName && ctx.symbolTable.isSet(varName)) {
    const setValueType = ctx.symbolTable.getSetValueType(varName);

    if (setValueType && setValueType === "string") {
      let setAlloca = ctx.symbolTable.getAlloca(varName);
      if (setAlloca) {
        if (setAlloca.startsWith("@")) {
          setAlloca = ctx.emitLoad("%StringSet*", setAlloca);
        }
        if (method === "add") {
          const valueValue = ctx.generateExpression(expr.args[0], params);
          return ctx.stringSetGen.generateStringSetAdd(setAlloca, valueValue);
        } else if (method === "has") {
          const valueValue = ctx.generateExpression(expr.args[0], params);
          return ctx.stringSetGen.generateStringSetHas(setAlloca, valueValue);
        } else if (method === "delete") {
          const valueValue = ctx.generateExpression(expr.args[0], params);
          return ctx.stringSetGen.generateStringSetDelete(setAlloca, valueValue);
        } else {
          return ctx.emitError(`Set.${method}() is not supported`, expr.loc);
        }
      }
      return ctx.emitError(
        `Set<string>.${method}() failed: no alloca found for '${varName}'`,
        expr.loc,
      );
    }

    if (method === "add") {
      return ctx.setGen.generateSetAdd(expr, params);
    } else if (method === "has") {
      return ctx.setGen.generateSetHas(expr, params);
    } else if (method === "delete") {
      return ctx.setGen.generateSetDelete(expr, params);
    } else {
      return ctx.emitError(`Set.${method}() is not supported`, expr.loc);
    }
  }

  const thisFieldSetValueType = getThisFieldSetValueType(ctx, expr.object);
  if (thisFieldSetValueType) {
    const setPtr = ctx.generateExpression(expr.object, params);
    if (thisFieldSetValueType === "string") {
      if (method === "add") {
        const valueValue = ctx.generateExpression(expr.args[0], params);
        return ctx.stringSetGen.generateStringSetAdd(setPtr, valueValue);
      } else if (method === "has") {
        const valueValue = ctx.generateExpression(expr.args[0], params);
        return ctx.stringSetGen.generateStringSetHas(setPtr, valueValue);
      } else if (method === "delete") {
        const valueValue = ctx.generateExpression(expr.args[0], params);
        return ctx.stringSetGen.generateStringSetDelete(setPtr, valueValue);
      } else {
        return ctx.emitError(`Set.${method}() is not supported`, expr.loc);
      }
    } else {
      if (method === "add") {
        return ctx.setGen.generateSetAdd(expr, params);
      } else if (method === "has") {
        return ctx.setGen.generateSetHas(expr, params);
      } else if (method === "delete") {
        return ctx.setGen.generateSetDelete(expr, params);
      } else {
        return ctx.emitError(`Set.${method}() is not supported`, expr.loc);
      }
    }
  }

  return null;
}

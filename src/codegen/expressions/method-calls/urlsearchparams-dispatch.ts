import type { Expression, MethodCallNode, VariableNode } from "../../../ast/types.js";
import type { MethodCallGeneratorContext } from "../method-calls.js";

interface ExprBase {
  type: string;
}

function urlspGetVariableName(expr: Expression): string | null {
  const e = expr as ExprBase;
  if (e.type === "variable") {
    return (expr as VariableNode).name;
  }
  return null;
}

export function dispatchUrlSearchParamsMethod(
  ctx: MethodCallGeneratorContext,
  method: string,
  expr: MethodCallNode,
  params: string[],
): string | null {
  const urlspVarName = urlspGetVariableName(expr.object);
  if (!urlspVarName || !ctx.symbolTable.isUrlSearchParams(urlspVarName)) return null;

  const urlspAlloca = ctx.symbolTable.getAlloca(urlspVarName);
  if (!urlspAlloca) return null;

  const queryPtr = ctx.emitLoad("i8*", urlspAlloca);
  if (method === "get") {
    const keyPtr = ctx.generateExpression(expr.args[0], params);
    const result = ctx.emitCall("i8*", "@cs_urlsearch_get", `i8* ${queryPtr}, i8* ${keyPtr}`);
    ctx.setVariableType(result, "i8*");
    return result;
  } else if (method === "has") {
    const keyPtr = ctx.generateExpression(expr.args[0], params);
    const i32Result = ctx.emitCall("i32", "@cs_urlsearch_has", `i8* ${queryPtr}, i8* ${keyPtr}`);
    const dblResult = ctx.nextTemp();
    ctx.emit(`${dblResult} = sitofp i32 ${i32Result} to double`);
    ctx.setVariableType(dblResult, "double");
    return dblResult;
  } else if (method === "set") {
    const keyPtr = ctx.generateExpression(expr.args[0], params);
    const valPtr = ctx.generateExpression(expr.args[1], params);
    const newQuery = ctx.emitCall(
      "i8*",
      "@cs_urlsearch_set",
      `i8* ${queryPtr}, i8* ${keyPtr}, i8* ${valPtr}`,
    );
    ctx.emitStore("i8*", newQuery, urlspAlloca);
    return newQuery;
  } else if (method === "append") {
    const keyPtr = ctx.generateExpression(expr.args[0], params);
    const valPtr = ctx.generateExpression(expr.args[1], params);
    const newQuery = ctx.emitCall(
      "i8*",
      "@cs_urlsearch_append",
      `i8* ${queryPtr}, i8* ${keyPtr}, i8* ${valPtr}`,
    );
    ctx.emitStore("i8*", newQuery, urlspAlloca);
    return newQuery;
  } else if (method === "delete") {
    const keyPtr = ctx.generateExpression(expr.args[0], params);
    const newQuery = ctx.emitCall("i8*", "@cs_urlsearch_delete", `i8* ${queryPtr}, i8* ${keyPtr}`);
    ctx.emitStore("i8*", newQuery, urlspAlloca);
    return newQuery;
  } else if (method === "toString") {
    const result = ctx.emitCall("i8*", "@cs_urlsearch_tostring", `i8* ${queryPtr}`);
    ctx.setVariableType(result, "i8*");
    return result;
  }

  return null;
}

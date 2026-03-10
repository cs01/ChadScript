import { MemberAccessNode, VariableNode } from "../../../ast/types.js";
import type { MemberAccessGeneratorContext } from "./member.js";

interface ExprBase {
  type: string;
}

export function isProcessArgv(expr: MemberAccessNode): boolean {
  const exprObjBase = expr.object as ExprBase;
  return (
    exprObjBase.type === "variable" &&
    (expr.object as VariableNode).name === "process" &&
    expr.property === "argv"
  );
}

export function isProcessPlatform(expr: MemberAccessNode): boolean {
  const exprObjBase = expr.object as ExprBase;
  return (
    exprObjBase.type === "variable" &&
    (expr.object as VariableNode).name === "process" &&
    expr.property === "platform"
  );
}

export function isProcessEnvAccess(expr: MemberAccessNode): boolean {
  const exprObjBase = expr.object as ExprBase;
  if (exprObjBase.type !== "member_access") return false;
  const innerMember = expr.object as MemberAccessNode;
  const innerObjBase = innerMember.object as ExprBase;
  return (
    innerObjBase.type === "variable" &&
    (innerMember.object as VariableNode).name === "process" &&
    innerMember.property === "env"
  );
}

export function handleProcessEnvAccess(
  ctx: MemberAccessGeneratorContext,
  expr: MemberAccessNode,
): string {
  const envVarName = expr.property;
  const nameConst = ctx.stringGen.doCreateStringConstant(envVarName);
  const result = ctx.nextTemp();
  ctx.emit(`${result} = call i8* @getenv(i8* ${nameConst})`);
  ctx.setVariableType(result, "i8*");
  return result;
}

export function handleProcessSimpleProperty(
  ctx: MemberAccessGeneratorContext,
  expr: MemberAccessNode,
): string | null {
  const exprObjBase = expr.object as ExprBase;
  if (exprObjBase.type !== "variable") return null;
  const varNode = expr.object as VariableNode;
  if (varNode.name !== "process") return null;

  const prop = expr.property;

  if (prop === "arch") {
    const archStr = ctx.getTargetArch() || "x64";
    return ctx.stringGen.doCreateStringConstant(archStr);
  }
  if (prop === "version") {
    return ctx.stringGen.doCreateStringConstant("v1.0.0");
  }
  if (prop === "pid") {
    const pidI32 = ctx.nextTemp();
    ctx.emit(`${pidI32} = call i32 @getpid()`);
    const pidDouble = ctx.nextTemp();
    ctx.emit(`${pidDouble} = sitofp i32 ${pidI32} to double`);
    ctx.setVariableType(pidDouble, "double");
    return pidDouble;
  }
  if (prop === "ppid") {
    const ppidI32 = ctx.nextTemp();
    ctx.emit(`${ppidI32} = call i32 @getppid()`);
    const ppidDouble = ctx.nextTemp();
    ctx.emit(`${ppidDouble} = sitofp i32 ${ppidI32} to double`);
    ctx.setVariableType(ppidDouble, "double");
    return ppidDouble;
  }
  if (prop === "execPath" || prop === "argv0") {
    const argvPtr = ctx.nextTemp();
    ctx.emit(`${argvPtr} = load i8**, i8*** @__argv`);
    const firstArg = ctx.nextTemp();
    ctx.emit(`${firstArg} = load i8*, i8** ${argvPtr}`);
    ctx.setVariableType(firstArg, "i8*");
    return firstArg;
  }
  return null;
}

export function handleProcessPlatform(ctx: MemberAccessGeneratorContext): string {
  const platformStr = ctx.getTargetOS() || process.platform;
  return ctx.stringGen.doCreateStringConstant(platformStr);
}

export function handleProcessArgv(ctx: MemberAccessGeneratorContext): string {
  const sizePtr = ctx.nextTemp();
  ctx.emit(`${sizePtr} = getelementptr %StringArray, %StringArray* null, i32 1`);
  const structSize = ctx.nextTemp();
  ctx.emit(`${structSize} = ptrtoint %StringArray* ${sizePtr} to i64`);
  const arrayMem = ctx.nextTemp();
  ctx.emit(`${arrayMem} = call i8* @GC_malloc(i64 ${structSize})`);
  const argvStruct = ctx.nextTemp();
  ctx.emit(`${argvStruct} = bitcast i8* ${arrayMem} to %StringArray*`);

  const dataField = ctx.nextTemp();
  ctx.emit(
    `${dataField} = getelementptr inbounds %StringArray, %StringArray* ${argvStruct}, i32 0, i32 0`,
  );
  const argvPtr = ctx.nextTemp();
  ctx.emit(`${argvPtr} = load i8**, i8*** @__argv`);
  const argvSkipFirst = ctx.nextTemp();
  ctx.emit(`${argvSkipFirst} = getelementptr i8*, i8** ${argvPtr}, i32 1`);
  ctx.emit(`store i8** ${argvSkipFirst}, i8*** ${dataField}`);

  const lenField = ctx.nextTemp();
  ctx.emit(
    `${lenField} = getelementptr inbounds %StringArray, %StringArray* ${argvStruct}, i32 0, i32 1`,
  );
  const argc = ctx.nextTemp();
  ctx.emit(`${argc} = load i32, i32* @__argc`);
  const argcMinusOne = ctx.nextTemp();
  ctx.emit(`${argcMinusOne} = sub i32 ${argc}, 1`);
  ctx.emit(`store i32 ${argcMinusOne}, i32* ${lenField}`);

  const capField = ctx.nextTemp();
  ctx.emit(
    `${capField} = getelementptr inbounds %StringArray, %StringArray* ${argvStruct}, i32 0, i32 2`,
  );
  ctx.emit(`store i32 ${argcMinusOne}, i32* ${capField}`);

  ctx.setVariableType(argvStruct, "%StringArray*");
  return argvStruct;
}

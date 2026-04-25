interface EmitContext {
  nextTemp(): string;
  emit(instruction: string): void;
  setVariableType(name: string, type: string): void;
}

export function emitAdd(ctx: EmitContext, type: string, lhs: string, rhs: string): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = add ${type} ${lhs}, ${rhs}`);
  ctx.setVariableType(temp, type);
  return temp;
}

export function emitSub(ctx: EmitContext, type: string, lhs: string, rhs: string): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = sub ${type} ${lhs}, ${rhs}`);
  ctx.setVariableType(temp, type);
  return temp;
}

export function emitMul(ctx: EmitContext, type: string, lhs: string, rhs: string): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = mul ${type} ${lhs}, ${rhs}`);
  ctx.setVariableType(temp, type);
  return temp;
}

const FMATH = "nnan ninf nsz arcp contract reassoc afn";

export function emitFAdd(ctx: EmitContext, lhs: string, rhs: string): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = fadd ${FMATH} double ${lhs}, ${rhs}`);
  ctx.setVariableType(temp, "double");
  return temp;
}

export function emitFSub(ctx: EmitContext, lhs: string, rhs: string): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = fsub ${FMATH} double ${lhs}, ${rhs}`);
  ctx.setVariableType(temp, "double");
  return temp;
}

export function emitFMul(ctx: EmitContext, lhs: string, rhs: string): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = fmul ${FMATH} double ${lhs}, ${rhs}`);
  ctx.setVariableType(temp, "double");
  return temp;
}

export function emitFDiv(ctx: EmitContext, lhs: string, rhs: string): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = fdiv ${FMATH} double ${lhs}, ${rhs}`);
  ctx.setVariableType(temp, "double");
  return temp;
}

export function emitSRem(ctx: EmitContext, type: string, lhs: string, rhs: string): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = srem ${type} ${lhs}, ${rhs}`);
  ctx.setVariableType(temp, type);
  return temp;
}

export function emitFRem(ctx: EmitContext, lhs: string, rhs: string): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = frem ${FMATH} double ${lhs}, ${rhs}`);
  ctx.setVariableType(temp, "double");
  return temp;
}

export function emitFNeg(ctx: EmitContext, value: string): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = fneg ${FMATH} double ${value}`);
  ctx.setVariableType(temp, "double");
  return temp;
}

export function emitZext(
  ctx: EmitContext,
  value: string,
  fromType: string,
  toType: string,
): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = zext ${fromType} ${value} to ${toType}`);
  ctx.setVariableType(temp, toType);
  return temp;
}

export function emitSext(
  ctx: EmitContext,
  value: string,
  fromType: string,
  toType: string,
): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = sext ${fromType} ${value} to ${toType}`);
  ctx.setVariableType(temp, toType);
  return temp;
}

export function emitTrunc(
  ctx: EmitContext,
  value: string,
  fromType: string,
  toType: string,
): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = trunc ${fromType} ${value} to ${toType}`);
  ctx.setVariableType(temp, toType);
  return temp;
}

export function emitSitofp(ctx: EmitContext, value: string, fromType: string): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = sitofp ${fromType} ${value} to double`);
  ctx.setVariableType(temp, "double");
  return temp;
}

export function emitFptosi(ctx: EmitContext, value: string, toType: string): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = fptosi double ${value} to ${toType}`);
  ctx.setVariableType(temp, toType);
  return temp;
}

export function emitPtrtoint(
  ctx: EmitContext,
  value: string,
  fromType: string,
  toType: string,
): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = ptrtoint ${fromType} ${value} to ${toType}`);
  ctx.setVariableType(temp, toType);
  return temp;
}

export function emitInttoptr(
  ctx: EmitContext,
  value: string,
  fromType: string,
  toType: string,
): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = inttoptr ${fromType} ${value} to ${toType}`);
  ctx.setVariableType(temp, toType);
  return temp;
}

export function emitAnd(ctx: EmitContext, type: string, lhs: string, rhs: string): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = and ${type} ${lhs}, ${rhs}`);
  ctx.setVariableType(temp, type);
  return temp;
}

export function emitOr(ctx: EmitContext, type: string, lhs: string, rhs: string): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = or ${type} ${lhs}, ${rhs}`);
  ctx.setVariableType(temp, type);
  return temp;
}

export function emitXor(ctx: EmitContext, type: string, lhs: string, rhs: string): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = xor ${type} ${lhs}, ${rhs}`);
  ctx.setVariableType(temp, type);
  return temp;
}

export function emitShl(ctx: EmitContext, type: string, lhs: string, rhs: string): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = shl ${type} ${lhs}, ${rhs}`);
  ctx.setVariableType(temp, type);
  return temp;
}

export function emitAShr(ctx: EmitContext, type: string, lhs: string, rhs: string): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = ashr ${type} ${lhs}, ${rhs}`);
  ctx.setVariableType(temp, type);
  return temp;
}

export function emitLShr(ctx: EmitContext, type: string, lhs: string, rhs: string): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = lshr ${type} ${lhs}, ${rhs}`);
  ctx.setVariableType(temp, type);
  return temp;
}

export function emitPhi(ctx: EmitContext, type: string, branches: Array<[string, string]>): string {
  const temp = ctx.nextTemp();
  const parts: string[] = [];
  const branchArr: string[][] = branches as string[][];
  for (let i = 0; i < branchArr.length; i++) {
    const pair: string[] = branchArr[i];
    const val: string = pair[0];
    const label: string = pair[1];
    parts.push(`[${val}, %${label}]`);
  }
  ctx.emit(`${temp} = phi ${type} ${parts.join(", ")}`);
  ctx.setVariableType(temp, type);
  return temp;
}

export function emitSelect(
  ctx: EmitContext,
  cond: string,
  type: string,
  trueVal: string,
  falseVal: string,
): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = select i1 ${cond}, ${type} ${trueVal}, ${type} ${falseVal}`);
  ctx.setVariableType(temp, type);
  return temp;
}

export function emitAlloca(ctx: EmitContext, type: string): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = alloca ${type}`);
  ctx.setVariableType(temp, type + "*");
  return temp;
}

export function emitFcmp(ctx: EmitContext, pred: string, lhs: string, rhs: string): string {
  const temp = ctx.nextTemp();
  ctx.emit(`${temp} = fcmp ${pred} double ${lhs}, ${rhs}`);
  ctx.setVariableType(temp, "i1");
  return temp;
}

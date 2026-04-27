import type {
  HIRModule,
  HIRFunction,
  HIRStmt,
  HIRExpr,
  HIRType,
  HIRParam,
  BinaryOp,
} from "../hir/types.js";

export function emitModule(mod: HIRModule): string {
  const ctx = new EmitContext();

  ctx.line("declare i32 @puts(i8*)");
  ctx.line("declare i32 @printf(i8*, ...)");
  ctx.line("declare i32 @sprintf(i8*, i8*, ...)");
  ctx.line("declare void @exit(i32)");
  ctx.line("declare i64 @strlen(i8*)");
  ctx.line("declare i8* @malloc(i64)");
  ctx.line("declare i8* @strcpy(i8*, i8*)");
  ctx.line("declare i8* @strcat(i8*, i8*)");
  ctx.line("declare double @llvm.floor.f64(double)");
  ctx.line("declare double @llvm.ceil.f64(double)");
  ctx.line("declare double @llvm.fabs.f64(double)");
  ctx.line("declare double @llvm.sqrt.f64(double)");
  ctx.line("declare double @llvm.pow.f64(double, double)");
  ctx.line("declare double @llvm.log.f64(double)");
  ctx.line("declare double @llvm.round.f64(double)");
  ctx.line("declare double @llvm.maxnum.f64(double, double)");
  ctx.line("declare double @llvm.minnum.f64(double, double)");
  ctx.line("");

  for (const g of mod.globals) {
    const t = llvmType(g.type);
    const init = g.type.kind === "f64" ? "0.0" : g.type.kind === "i8ptr" ? "null" : "0";
    ctx.line(`@g_${g.name} = global ${t} ${init}`);
  }
  if (mod.globals.length > 0) ctx.line("");

  for (const fn of mod.functions) {
    emitFunction(ctx, fn);
    ctx.line("");
  }

  emitMain(ctx, mod);

  return ctx.output();
}

class EmitContext {
  private lines: string[] = [];
  private tempCounter = 0;
  private labelCounter = 0;
  private stringConstants: Map<string, string> = new Map();
  private stringConstantDefs: string[] = [];
  loopStack: { condLabel: string; exitLabel: string }[] = [];

  line(s: string): void {
    this.lines.push(s);
  }

  nextTemp(): string {
    return `%t${this.tempCounter++}`;
  }

  nextLabel(prefix: string): string {
    return `${prefix}${this.labelCounter++}`;
  }

  resetTemps(): void {
    this.tempCounter = 0;
    this.labelCounter = 0;
  }

  getOrCreateString(value: string): string {
    const existing = this.stringConstants.get(value);
    if (existing) return existing;

    const name = `@.str.${this.stringConstants.size}`;
    const escaped = value.replace(/\\/g, "\\5C").replace(/"/g, "\\22").replace(/\n/g, "\\0A");
    const len = Buffer.byteLength(value, "utf-8") + 1;
    this.stringConstantDefs.push(
      `${name} = private unnamed_addr constant [${len} x i8] c"${escaped}\\00"`,
    );
    this.stringConstants.set(value, name);
    return name;
  }

  output(): string {
    return [...this.stringConstantDefs, "", ...this.lines].join("\n") + "\n";
  }
}

function llvmType(t: HIRType): string {
  switch (t.kind) {
    case "f64":
      return "double";
    case "i32":
      return "i32";
    case "i1":
      return "i1";
    case "i8ptr":
      return "i8*";
    case "void":
      return "void";
    case "boxed":
      return "double";
    case "ptr":
      return `%${t.pointee}*`;
    case "array":
      return "i8*";
    case "struct":
      return `%${t.name}*`;
    default: {
      const _: never = t;
      throw new Error(`unknown HIR type: ${JSON.stringify(t)}`);
    }
  }
}

function emitFunction(ctx: EmitContext, fn: HIRFunction): void {
  ctx.resetTemps();

  const params = fn.params.map((p) => `${llvmType(p.type)} %arg.${p.name}`).join(", ");
  const retType = llvmType(fn.returnType);

  ctx.line(`define ${retType} @${fn.name}(${params}) {`);
  ctx.line("entry:");

  localNames.clear();
  for (const p of fn.params) {
    registerLocal(p.id, p.name);
    const t = llvmType(p.type);
    ctx.line(`  %${p.name} = alloca ${t}`);
    ctx.line(`  store ${t} %arg.${p.name}, ${t}* %${p.name}`);
  }

  for (const stmt of fn.body) {
    emitStmt(ctx, stmt);
  }

  if (!blockTerminates(fn.body)) {
    if (fn.returnType.kind === "void") {
      ctx.line("  ret void");
    }
  }

  ctx.line("}");
}

function emitMain(ctx: EmitContext, mod: HIRModule): void {
  ctx.resetTemps();
  localNames.clear();
  ctx.line("define i32 @main(i32 %argc, i8** %argv) {");
  ctx.line("entry:");

  for (const g of mod.globals) {
    if (g.init) {
      const val = emitExpr(ctx, g.init);
      const t = llvmType(g.type);
      ctx.line(`  store ${t} ${val}, ${t}* @g_${g.name}`);
    }
  }

  for (const stmt of mod.init) {
    emitStmt(ctx, stmt);
  }

  ctx.line("  ret i32 0");
  ctx.line("}");
}

function stmtTerminates(stmts: HIRStmt[]): boolean {
  if (stmts.length === 0) return false;
  const last = stmts[stmts.length - 1];
  return last.kind === "break" || last.kind === "continue" || last.kind === "return";
}

function blockTerminates(stmts: HIRStmt[]): boolean {
  if (stmts.length === 0) return false;
  const last = stmts[stmts.length - 1];
  if (last.kind === "return") return true;
  if (last.kind === "if" && last.else) {
    return blockTerminates(last.then) && blockTerminates(last.else);
  }
  return false;
}

function emitStmt(ctx: EmitContext, stmt: HIRStmt): void {
  switch (stmt.kind) {
    case "let": {
      registerLocal(stmt.id, stmt.name);
      const t = llvmType(stmt.type);
      ctx.line(`  %${stmt.name} = alloca ${t}`);
      if (stmt.init) {
        const val = emitExpr(ctx, stmt.init);
        ctx.line(`  store ${t} ${val}, ${t}* %${stmt.name}`);
      }
      break;
    }
    case "assign": {
      const val = emitExpr(ctx, stmt.value);
      break;
    }
    case "expr":
      emitExpr(ctx, stmt.expr);
      break;
    case "return": {
      if (stmt.value) {
        const val = emitExpr(ctx, stmt.value);
        ctx.line(`  ret ${llvmType(stmt.value.type)} ${val}`);
      } else {
        ctx.line("  ret void");
      }
      break;
    }
    case "if": {
      const cond = emitExpr(ctx, stmt.condition);
      const thenLabel = ctx.nextLabel("then");
      const elseLabel = ctx.nextLabel("else");
      const mergeLabel = ctx.nextLabel("merge");

      if (stmt.else) {
        ctx.line(`  br i1 ${cond}, label %${thenLabel}, label %${elseLabel}`);
      } else {
        ctx.line(`  br i1 ${cond}, label %${thenLabel}, label %${mergeLabel}`);
      }

      ctx.line(`${thenLabel}:`);
      for (const s of stmt.then) emitStmt(ctx, s);
      const thenTerminated = blockTerminates(stmt.then);
      if (!thenTerminated) ctx.line(`  br label %${mergeLabel}`);

      let elseTerminated = false;
      if (stmt.else) {
        ctx.line(`${elseLabel}:`);
        for (const s of stmt.else) emitStmt(ctx, s);
        elseTerminated = blockTerminates(stmt.else);
        if (!elseTerminated) ctx.line(`  br label %${mergeLabel}`);
      }

      if (!(thenTerminated && elseTerminated)) {
        ctx.line(`${mergeLabel}:`);
      }
      break;
    }
    case "while": {
      const condLabel = ctx.nextLabel("while.cond");
      const bodyLabel = ctx.nextLabel("while.body");
      const exitLabel = ctx.nextLabel("while.exit");

      ctx.loopStack.push({ condLabel, exitLabel });
      ctx.line(`  br label %${condLabel}`);
      ctx.line(`${condLabel}:`);
      const cond = emitExpr(ctx, stmt.condition);
      ctx.line(`  br i1 ${cond}, label %${bodyLabel}, label %${exitLabel}`);
      ctx.line(`${bodyLabel}:`);
      for (const s of stmt.body) emitStmt(ctx, s);
      if (!stmtTerminates(stmt.body)) ctx.line(`  br label %${condLabel}`);
      ctx.line(`${exitLabel}:`);
      ctx.loopStack.pop();
      break;
    }
    case "for": {
      if (stmt.init) emitStmt(ctx, stmt.init);
      const condLabel = ctx.nextLabel("for.cond");
      const bodyLabel = ctx.nextLabel("for.body");
      const updateLabel = ctx.nextLabel("for.update");
      const exitLabel = ctx.nextLabel("for.exit");

      ctx.loopStack.push({ condLabel: updateLabel, exitLabel });
      ctx.line(`  br label %${condLabel}`);
      ctx.line(`${condLabel}:`);
      if (stmt.condition) {
        const cond = emitExpr(ctx, stmt.condition);
        ctx.line(`  br i1 ${cond}, label %${bodyLabel}, label %${exitLabel}`);
      } else {
        ctx.line(`  br label %${bodyLabel}`);
      }
      ctx.line(`${bodyLabel}:`);
      for (const s of stmt.body) emitStmt(ctx, s);
      if (!stmtTerminates(stmt.body)) ctx.line(`  br label %${updateLabel}`);
      ctx.line(`${updateLabel}:`);
      if (stmt.update) emitExpr(ctx, stmt.update);
      ctx.line(`  br label %${condLabel}`);
      ctx.line(`${exitLabel}:`);
      ctx.loopStack.pop();
      break;
    }
    case "break": {
      const loop = ctx.loopStack[ctx.loopStack.length - 1];
      ctx.line(`  br label %${loop.exitLabel}`);
      const deadLabel = ctx.nextLabel("dead");
      ctx.line(`${deadLabel}:`);
      break;
    }
    case "continue": {
      const loop = ctx.loopStack[ctx.loopStack.length - 1];
      ctx.line(`  br label %${loop.condLabel}`);
      const deadLabel = ctx.nextLabel("dead");
      ctx.line(`${deadLabel}:`);
      break;
    }
    default:
      break;
  }
}

function emitExpr(ctx: EmitContext, expr: HIRExpr): string {
  switch (expr.kind) {
    case "literal_f64": {
      if (Object.is(expr.value, -0)) return "-0.0";
      const s = expr.value.toExponential(20);
      return s;
    }
    case "literal_i32":
      return `${expr.value}`;
    case "literal_i1":
      return expr.value ? "1" : "0";
    case "literal_string": {
      const name = ctx.getOrCreateString(expr.value);
      const len = Buffer.byteLength(expr.value, "utf-8") + 1;
      const tmp = ctx.nextTemp();
      ctx.line(
        `  ${tmp} = getelementptr inbounds [${len} x i8], [${len} x i8]* ${name}, i64 0, i64 0`,
      );
      return tmp;
    }
    case "literal_null":
      return "null";
    case "local_get": {
      const tmp = ctx.nextTemp();
      const t = llvmType(expr.type);
      ctx.line(`  ${tmp} = load ${t}, ${t}* %${getLocalName(expr.id)}`);
      return tmp;
    }
    case "local_set": {
      const val = emitExpr(ctx, expr.value);
      const t = llvmType(expr.type);
      ctx.line(`  store ${t} ${val}, ${t}* %${getLocalName(expr.id)}`);
      return val;
    }
    case "global_get": {
      const tmp = ctx.nextTemp();
      const t = llvmType(expr.type);
      ctx.line(`  ${tmp} = load ${t}, ${t}* @g_${expr.name}`);
      return tmp;
    }
    case "global_set": {
      const val = emitExpr(ctx, expr.value);
      const t = llvmType(expr.type);
      ctx.line(`  store ${t} ${val}, ${t}* @g_${expr.name}`);
      return val;
    }
    case "binary":
      return emitBinary(ctx, expr);
    case "unary":
      return emitUnary(ctx, expr);
    case "call": {
      const args = expr.args.map((a) => {
        const val = emitExpr(ctx, a);
        return `${llvmType(a.type)} ${val}`;
      });
      const retType = llvmType(expr.returnType);
      if (retType === "void") {
        ctx.line(`  call void @${expr.callee}(${args.join(", ")})`);
        return "void";
      }
      const tmp = ctx.nextTemp();
      ctx.line(`  ${tmp} = call ${retType} @${expr.callee}(${args.join(", ")})`);
      return tmp;
    }
    case "runtime_call":
      return emitRuntimeCall(ctx, expr);
    case "conditional": {
      const cond = emitExpr(ctx, expr.condition);
      const thenVal = emitExpr(ctx, expr.then);
      const elseVal = emitExpr(ctx, expr.else);
      const tmp = ctx.nextTemp();
      ctx.line(
        `  ${tmp} = select i1 ${cond}, ${llvmType(expr.type)} ${thenVal}, ${llvmType(expr.type)} ${elseVal}`,
      );
      return tmp;
    }
    case "narrow_i32": {
      const val = emitExpr(ctx, expr.value);
      const i64tmp = ctx.nextTemp();
      const tmp = ctx.nextTemp();
      ctx.line(`  ${i64tmp} = fptosi double ${val} to i64`);
      ctx.line(`  ${tmp} = trunc i64 ${i64tmp} to i32`);
      return tmp;
    }
    case "widen_f64": {
      const val = emitExpr(ctx, expr.value);
      const tmp = ctx.nextTemp();
      ctx.line(`  ${tmp} = sitofp i32 ${val} to double`);
      return tmp;
    }
    default:
      return "0";
  }
}

const localNames = new Map<number, string>();

function registerLocal(id: number, name: string): void {
  localNames.set(id, name);
}

function getLocalName(id: number): string {
  return localNames.get(id) || `local.${id}`;
}

function emitBinary(ctx: EmitContext, expr: HIRExpr & { kind: "binary" }): string {
  if (expr.op === "and" || expr.op === "or") {
    return emitShortCircuit(ctx, expr);
  }

  const left = emitExpr(ctx, expr.left);
  const right = emitExpr(ctx, expr.right);
  const tmp = ctx.nextTemp();
  const t = llvmType(expr.left.type);
  const isFloat = expr.left.type.kind === "f64";
  const isInt = expr.left.type.kind === "i32" || expr.left.type.kind === "i1";

  switch (expr.op) {
    case "add":
      ctx.line(`  ${tmp} = ${isFloat ? "fadd" : "add"} ${t} ${left}, ${right}`);
      break;
    case "sub":
      ctx.line(`  ${tmp} = ${isFloat ? "fsub" : "sub"} ${t} ${left}, ${right}`);
      break;
    case "mul":
      ctx.line(`  ${tmp} = ${isFloat ? "fmul" : "mul"} ${t} ${left}, ${right}`);
      break;
    case "div":
      ctx.line(`  ${tmp} = ${isFloat ? "fdiv" : "sdiv"} ${t} ${left}, ${right}`);
      break;
    case "rem":
      ctx.line(`  ${tmp} = ${isFloat ? "frem" : "srem"} ${t} ${left}, ${right}`);
      break;
    case "eq":
      ctx.line(`  ${tmp} = ${isFloat ? "fcmp oeq" : "icmp eq"} ${t} ${left}, ${right}`);
      break;
    case "ne":
      ctx.line(`  ${tmp} = ${isFloat ? "fcmp one" : "icmp ne"} ${t} ${left}, ${right}`);
      break;
    case "lt":
      ctx.line(`  ${tmp} = ${isFloat ? "fcmp olt" : "icmp slt"} ${t} ${left}, ${right}`);
      break;
    case "le":
      ctx.line(`  ${tmp} = ${isFloat ? "fcmp ole" : "icmp sle"} ${t} ${left}, ${right}`);
      break;
    case "gt":
      ctx.line(`  ${tmp} = ${isFloat ? "fcmp ogt" : "icmp sgt"} ${t} ${left}, ${right}`);
      break;
    case "ge":
      ctx.line(`  ${tmp} = ${isFloat ? "fcmp oge" : "icmp sge"} ${t} ${left}, ${right}`);
      break;
    case "bit_and":
      ctx.line(`  ${tmp} = and ${t} ${left}, ${right}`);
      break;
    case "bit_or":
      ctx.line(`  ${tmp} = or ${t} ${left}, ${right}`);
      break;
    case "bit_xor":
      ctx.line(`  ${tmp} = xor ${t} ${left}, ${right}`);
      break;
    case "shl":
      ctx.line(`  ${tmp} = shl ${t} ${left}, ${right}`);
      break;
    case "shr":
      ctx.line(`  ${tmp} = ashr ${t} ${left}, ${right}`);
      break;
    case "ushr":
      ctx.line(`  ${tmp} = lshr ${t} ${left}, ${right}`);
      break;
    default:
      throw new Error(`unhandled binary op: ${expr.op}`);
  }

  return tmp;
}

function emitShortCircuit(ctx: EmitContext, expr: HIRExpr & { kind: "binary" }): string {
  const left = emitExpr(ctx, expr.left);
  const rhsLabel = ctx.nextLabel("sc.rhs");
  const mergeLabel = ctx.nextLabel("sc.merge");
  const skipLabel = ctx.nextLabel("sc.skip");
  const entryLabel = ctx.nextLabel("sc.entry");

  if (expr.op === "and") {
    ctx.line(`  br i1 ${left}, label %${rhsLabel}, label %${skipLabel}`);
  } else {
    ctx.line(`  br i1 ${left}, label %${skipLabel}, label %${rhsLabel}`);
  }

  ctx.line(`${rhsLabel}:`);
  const right = emitExpr(ctx, expr.right);
  ctx.line(`  br label %${mergeLabel}`);

  ctx.line(`${skipLabel}:`);
  ctx.line(`  br label %${mergeLabel}`);

  ctx.line(`${mergeLabel}:`);
  const result = ctx.nextTemp();
  if (expr.op === "and") {
    ctx.line(`  ${result} = phi i1 [ ${right}, %${rhsLabel} ], [ false, %${skipLabel} ]`);
  } else {
    ctx.line(`  ${result} = phi i1 [ ${right}, %${rhsLabel} ], [ true, %${skipLabel} ]`);
  }
  return result;
}

function emitUnary(ctx: EmitContext, expr: HIRExpr & { kind: "unary" }): string {
  const operand = emitExpr(ctx, expr.operand);
  const tmp = ctx.nextTemp();
  const t = llvmType(expr.operand.type);

  switch (expr.op) {
    case "neg":
      if (expr.operand.type.kind === "f64") {
        ctx.line(`  ${tmp} = fneg double ${operand}`);
      } else {
        ctx.line(`  ${tmp} = sub ${t} 0, ${operand}`);
      }
      break;
    case "not":
      ctx.line(`  ${tmp} = xor i1 ${operand}, 1`);
      break;
    case "bit_not":
      ctx.line(`  ${tmp} = xor ${t} ${operand}, -1`);
      break;
    default:
      throw new Error(`unhandled unary op: ${expr.op}`);
  }

  return tmp;
}

function emitRuntimeCall(ctx: EmitContext, expr: HIRExpr & { kind: "runtime_call" }): string {
  if (expr.func.startsWith("cs_math_")) {
    return emitMathCall(ctx, expr);
  }

  if (expr.func === "cs_string_concat") {
    return emitStringConcat(ctx, expr);
  }

  if (expr.func === "cs_console_log") {
    for (let i = 0; i < expr.args.length; i++) {
      if (i > 0) {
        const spaceFmt = ctx.getOrCreateString(" ");
        const spaceLen = 2;
        const spacePtr = ctx.nextTemp();
        ctx.line(
          `  ${spacePtr} = getelementptr inbounds [${spaceLen} x i8], [${spaceLen} x i8]* ${spaceFmt}, i64 0, i64 0`,
        );
        ctx.line(`  call i32 (i8*, ...) @printf(i8* ${spacePtr})`);
      }
      const arg = expr.args[i];
      const val = emitExpr(ctx, arg);
      emitPrintValue(ctx, arg, val, i === expr.args.length - 1);
    }
    if (expr.args.length === 0) {
      const nlFmt = ctx.getOrCreateString("\n");
      const nlPtr = ctx.nextTemp();
      ctx.line(`  ${nlPtr} = getelementptr inbounds [2 x i8], [2 x i8]* ${nlFmt}, i64 0, i64 0`);
      ctx.line(`  call i32 (i8*, ...) @printf(i8* ${nlPtr})`);
    }
    return "void";
  }

  return "0";
}

function emitPrintValue(ctx: EmitContext, arg: HIRExpr, val: string, isLast: boolean): void {
  const nl = isLast ? "\n" : "";
  if (arg.type.kind === "i8ptr") {
    if (isLast) {
      ctx.line(`  call i32 @puts(i8* ${val})`);
    } else {
      const fmt = ctx.getOrCreateString("%s");
      const fmtLen = 3;
      const fmtPtr = ctx.nextTemp();
      ctx.line(
        `  ${fmtPtr} = getelementptr inbounds [${fmtLen} x i8], [${fmtLen} x i8]* ${fmt}, i64 0, i64 0`,
      );
      ctx.line(`  call i32 (i8*, ...) @printf(i8* ${fmtPtr}, i8* ${val})`);
    }
  } else if (arg.type.kind === "f64") {
    const fmt = ctx.getOrCreateString(`%.17g${nl}`);
    const fmtLen = Buffer.byteLength(`%.17g${nl}`, "utf-8") + 1;
    const fmtPtr = ctx.nextTemp();
    ctx.line(
      `  ${fmtPtr} = getelementptr inbounds [${fmtLen} x i8], [${fmtLen} x i8]* ${fmt}, i64 0, i64 0`,
    );
    ctx.line(`  call i32 (i8*, ...) @printf(i8* ${fmtPtr}, double ${val})`);
  } else if (arg.type.kind === "i32") {
    const fmt = ctx.getOrCreateString(`%d${nl}`);
    const fmtLen = Buffer.byteLength(`%d${nl}`, "utf-8") + 1;
    const fmtPtr = ctx.nextTemp();
    ctx.line(
      `  ${fmtPtr} = getelementptr inbounds [${fmtLen} x i8], [${fmtLen} x i8]* ${fmt}, i64 0, i64 0`,
    );
    ctx.line(`  call i32 (i8*, ...) @printf(i8* ${fmtPtr}, i32 ${val})`);
  } else if (arg.type.kind === "i1") {
    const trueStr = ctx.getOrCreateString("true");
    const falseStr = ctx.getOrCreateString("false");
    const trueLen = Buffer.byteLength("true", "utf-8") + 1;
    const falseLen = Buffer.byteLength("false", "utf-8") + 1;
    const truePtr = ctx.nextTemp();
    const falsePtr = ctx.nextTemp();
    const selected = ctx.nextTemp();
    ctx.line(
      `  ${truePtr} = getelementptr inbounds [${trueLen} x i8], [${trueLen} x i8]* ${trueStr}, i64 0, i64 0`,
    );
    ctx.line(
      `  ${falsePtr} = getelementptr inbounds [${falseLen} x i8], [${falseLen} x i8]* ${falseStr}, i64 0, i64 0`,
    );
    ctx.line(`  ${selected} = select i1 ${val}, i8* ${truePtr}, i8* ${falsePtr}`);
    if (isLast) {
      ctx.line(`  call i32 @puts(i8* ${selected})`);
    } else {
      const fmt = ctx.getOrCreateString("%s");
      const fmtLen = 3;
      const fmtPtr = ctx.nextTemp();
      ctx.line(
        `  ${fmtPtr} = getelementptr inbounds [${fmtLen} x i8], [${fmtLen} x i8]* ${fmt}, i64 0, i64 0`,
      );
      ctx.line(`  call i32 (i8*, ...) @printf(i8* ${fmtPtr}, i8* ${selected})`);
    }
  }
}

function emitToString(ctx: EmitContext, arg: HIRExpr, val: string): string {
  if (arg.type.kind === "i8ptr") return val;
  const buf = ctx.nextTemp();
  ctx.line(`  ${buf} = call i8* @malloc(i64 32)`);
  if (arg.type.kind === "f64") {
    const fmt = ctx.getOrCreateString("%.17g");
    const fmtLen = Buffer.byteLength("%.17g", "utf-8") + 1;
    const fmtPtr = ctx.nextTemp();
    ctx.line(
      `  ${fmtPtr} = getelementptr inbounds [${fmtLen} x i8], [${fmtLen} x i8]* ${fmt}, i64 0, i64 0`,
    );
    ctx.line(`  call i32 (i8*, i8*, ...) @sprintf(i8* ${buf}, i8* ${fmtPtr}, double ${val})`);
  } else if (arg.type.kind === "i32") {
    const fmt = ctx.getOrCreateString("%d");
    const fmtLen = 3;
    const fmtPtr = ctx.nextTemp();
    ctx.line(
      `  ${fmtPtr} = getelementptr inbounds [${fmtLen} x i8], [${fmtLen} x i8]* ${fmt}, i64 0, i64 0`,
    );
    ctx.line(`  call i32 (i8*, i8*, ...) @sprintf(i8* ${buf}, i8* ${fmtPtr}, i32 ${val})`);
  } else if (arg.type.kind === "i1") {
    const trueStr = ctx.getOrCreateString("true");
    const falseStr = ctx.getOrCreateString("false");
    const truePtr = ctx.nextTemp();
    const falsePtr = ctx.nextTemp();
    const selected = ctx.nextTemp();
    ctx.line(`  ${truePtr} = getelementptr inbounds [5 x i8], [5 x i8]* ${trueStr}, i64 0, i64 0`);
    ctx.line(
      `  ${falsePtr} = getelementptr inbounds [6 x i8], [6 x i8]* ${falseStr}, i64 0, i64 0`,
    );
    ctx.line(`  ${selected} = select i1 ${val}, i8* ${truePtr}, i8* ${falsePtr}`);
    return selected;
  }
  return buf;
}

function emitStringConcat(ctx: EmitContext, expr: HIRExpr & { kind: "runtime_call" }): string {
  const leftArg = expr.args[0];
  const rightArg = expr.args[1];
  const leftVal = emitExpr(ctx, leftArg);
  const rightVal = emitExpr(ctx, rightArg);

  const leftStr = emitToString(ctx, leftArg, leftVal);
  const rightStr = emitToString(ctx, rightArg, rightVal);

  const lenL = ctx.nextTemp();
  const lenR = ctx.nextTemp();
  const totalLen = ctx.nextTemp();
  const totalLen1 = ctx.nextTemp();
  const buf = ctx.nextTemp();

  ctx.line(`  ${lenL} = call i64 @strlen(i8* ${leftStr})`);
  ctx.line(`  ${lenR} = call i64 @strlen(i8* ${rightStr})`);
  ctx.line(`  ${totalLen} = add i64 ${lenL}, ${lenR}`);
  ctx.line(`  ${totalLen1} = add i64 ${totalLen}, 1`);
  ctx.line(`  ${buf} = call i8* @malloc(i64 ${totalLen1})`);
  ctx.line(`  call i8* @strcpy(i8* ${buf}, i8* ${leftStr})`);
  ctx.line(`  call i8* @strcat(i8* ${buf}, i8* ${rightStr})`);
  return buf;
}

const MATH_INTRINSICS: Record<string, string> = {
  cs_math_floor: "@llvm.floor.f64",
  cs_math_ceil: "@llvm.ceil.f64",
  cs_math_abs: "@llvm.fabs.f64",
  cs_math_sqrt: "@llvm.sqrt.f64",
  cs_math_pow: "@llvm.pow.f64",
  cs_math_log: "@llvm.log.f64",
  cs_math_round: "@llvm.round.f64",
  cs_math_max: "@llvm.maxnum.f64",
  cs_math_min: "@llvm.minnum.f64",
};

function emitMathCall(ctx: EmitContext, expr: HIRExpr & { kind: "runtime_call" }): string {
  const intrinsic = MATH_INTRINSICS[expr.func];
  if (!intrinsic) throw new Error(`unsupported math function: ${expr.func}`);

  const args = expr.args.map((a) => {
    const val = emitExpr(ctx, a);
    if (a.type.kind === "i32") {
      const widened = ctx.nextTemp();
      ctx.line(`  ${widened} = sitofp i32 ${val} to double`);
      return `double ${widened}`;
    }
    return `double ${val}`;
  });

  const tmp = ctx.nextTemp();
  ctx.line(`  ${tmp} = call double ${intrinsic}(${args.join(", ")})`);
  return tmp;
}

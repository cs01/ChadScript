// Date codegen — Date.now() (static) and Date instance methods (getTime, getFullYear, etc.)
import { MethodCallNode, VariableNode } from "../../ast/types.js";

interface ExprBase {
  type: string;
}

import { IGeneratorContext } from "../infrastructure/generator-context.js";

export class DateGenerator {
  constructor(private ctx: IGeneratorContext) {}

  canHandle(expr: MethodCallNode): boolean {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type !== "variable") return false;
    const varNode = expr.object as VariableNode;
    if (varNode.name !== "Date") return false;
    return expr.method === "now";
  }

  generateNow(): string {
    return this.ctx.emitCall("double", "@cs_time_ms", "");
  }

  generateDateMethod(datePtr: string, method: string): string {
    // Load ms from %Date struct field 0
    const msPtr = this.ctx.nextTemp();
    this.ctx.emit(`${msPtr} = getelementptr inbounds %Date, %Date* ${datePtr}, i32 0, i32 0`);
    const msVal = this.ctx.nextTemp();
    this.ctx.emit(`${msVal} = load double, double* ${msPtr}`);

    if (method === "getTime") {
      return msVal;
    }

    // Convert ms → seconds as i64 for localtime_r / gmtime_r
    const secDbl = this.ctx.nextTemp();
    this.ctx.emit(`${secDbl} = fdiv nsz arcp contract reassoc afn double ${msVal}, 1.000000e+03`);
    const secI64 = this.ctx.nextTemp();
    this.ctx.emit(`${secI64} = fptosi double ${secDbl} to i64`);

    const timePtr = this.ctx.nextTemp();
    this.ctx.emit(`${timePtr} = alloca i64`);
    this.ctx.emit(`store i64 ${secI64}, i64* ${timePtr}`);
    const tmAlloca = this.ctx.nextTemp();
    this.ctx.emit(`${tmAlloca} = alloca %struct.tm`);

    if (method === "toISOString") {
      this.ctx.emitCall("%struct.tm*", "@gmtime_r", `i64* ${timePtr}, %struct.tm* ${tmAlloca}`);
      const buf = this.ctx.nextTemp();
      this.ctx.emit(`${buf} = call i8* @cs_arena_alloc(i64 32)`);
      const fmt = this.ctx.stringGen.doCreateStringConstant("%Y-%m-%dT%H:%M:%SZ");
      this.ctx.emitCall(
        "i64",
        "@strftime",
        `i8* ${buf}, i64 32, i8* ${fmt}, %struct.tm* ${tmAlloca}`,
      );
      this.ctx.setVariableType(buf, "i8*");
      return buf;
    }

    // struct tm fields: 0=sec, 1=min, 2=hour, 3=mday, 4=mon, 5=year
    // getFullYear needs +1900; getMonth is already 0-indexed (matches JS)
    this.ctx.emitCall("%struct.tm*", "@localtime_r", `i64* ${timePtr}, %struct.tm* ${tmAlloca}`);

    const fieldMap: Record<string, number> = {
      getSeconds: 0,
      getMinutes: 1,
      getHours: 2,
      getDate: 3,
      getMonth: 4,
      getFullYear: 5,
    };

    const fieldIndex = fieldMap[method];
    if (fieldIndex === undefined) {
      return this.ctx.emitError("Unknown Date method: " + method, undefined);
    }

    const fieldPtr = this.ctx.nextTemp();
    this.ctx.emit(
      `${fieldPtr} = getelementptr inbounds %struct.tm, %struct.tm* ${tmAlloca}, i32 0, i32 ${fieldIndex}`,
    );
    const fieldI32 = this.ctx.nextTemp();
    this.ctx.emit(`${fieldI32} = load i32, i32* ${fieldPtr}`);
    const fieldDbl = this.ctx.nextTemp();
    this.ctx.emit(`${fieldDbl} = sitofp i32 ${fieldI32} to double`);
    this.ctx.setVariableType(fieldDbl, "double");

    if (method === "getFullYear") {
      const result = this.ctx.nextTemp();
      this.ctx.emit(`${result} = fadd nsz arcp contract reassoc afn double ${fieldDbl}, 1900.0`);
      this.ctx.setVariableType(result, "double");
      return result;
    }

    return fieldDbl;
  }
}

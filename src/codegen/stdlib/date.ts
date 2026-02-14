import { MethodCallNode } from '../../ast/types.js';

interface ExprBase { type: string; }

import { IGeneratorContext } from '../infrastructure/generator-context.js';

export class DateGenerator {
  constructor(private ctx: IGeneratorContext) {}

  canHandle(expr: MethodCallNode): boolean {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type !== 'variable') return false;
    const varNode = expr.object as { type: string; name: string };
    if (varNode.name !== 'Date') return false;
    return expr.method === 'now';
  }

  generateNow(): string {
    const tvAlloca = this.ctx.nextTemp();
    this.ctx.emit(`${tvAlloca} = alloca %struct.timeval`);

    const callResult = this.ctx.nextTemp();
    this.ctx.emit(`${callResult} = call i32 @gettimeofday(%struct.timeval* ${tvAlloca}, i8* null)`);

    const secPtr = this.ctx.nextTemp();
    this.ctx.emit(`${secPtr} = getelementptr %struct.timeval, %struct.timeval* ${tvAlloca}, i32 0, i32 0`);
    const secVal = this.ctx.nextTemp();
    this.ctx.emit(`${secVal} = load i64, i64* ${secPtr}`);

    const usecPtr = this.ctx.nextTemp();
    this.ctx.emit(`${usecPtr} = getelementptr %struct.timeval, %struct.timeval* ${tvAlloca}, i32 0, i32 1`);
    const usecVal = this.ctx.nextTemp();
    this.ctx.emit(`${usecVal} = load i64, i64* ${usecPtr}`);

    const secDouble = this.ctx.nextTemp();
    this.ctx.emit(`${secDouble} = sitofp i64 ${secVal} to double`);
    const usecDouble = this.ctx.nextTemp();
    this.ctx.emit(`${usecDouble} = sitofp i64 ${usecVal} to double`);

    const secMs = this.ctx.nextTemp();
    this.ctx.emit(`${secMs} = fmul fast double ${secDouble}, 1.000000e+03`);
    const usecMs = this.ctx.nextTemp();
    this.ctx.emit(`${usecMs} = fdiv fast double ${usecDouble}, 1.000000e+03`);

    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = fadd fast double ${secMs}, ${usecMs}`);

    return result;
  }
}

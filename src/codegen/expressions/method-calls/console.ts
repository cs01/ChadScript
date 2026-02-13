import type { Expression, MethodCallNode } from '../../../ast/types.js';
import type { MethodCallGeneratorContext } from '../method-calls.js';

export function generateConsoleCallInline(ctx: MethodCallGeneratorContext, expr: MethodCallNode, params: string[]): string {
    const method = expr.method;
    const useStderr = method === 'error' || method === 'warn';

    if (expr.args.length === 0) {
      if (useStderr) {
        const stderrPtr = ctx.nextTemp();
        ctx.emit(`${stderrPtr} = load i8*, i8** @stderr`);
        const temp = ctx.nextTemp();
        ctx.emit(`${temp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* getelementptr([2 x i8], [2 x i8]* @.str.newline, i32 0, i32 0))`);
        const flushTemp = ctx.nextTemp();
        ctx.emit(`${flushTemp} = call i32 @fflush(i8* ${stderrPtr})`);
        return temp;
      } else {
        const temp = ctx.nextTemp();
        ctx.emit(`${temp} = call i32 (i8*, ...) @printf(i8* getelementptr([2 x i8], [2 x i8]* @.str.newline, i32 0, i32 0))`);
        return temp;
      }
    }

    const arg = expr.args[0];
    const argTyped = arg as { type: string; value: string | number };

    if (argTyped.type === 'string') {
      const strValue = argTyped.value as string;
      const strConstPtr = ctx.stringGenCreateStringConstant(strValue + '\n');
      if (useStderr) {
        const stderrPtr = ctx.nextTemp();
        ctx.emit(`${stderrPtr} = load i8*, i8** @stderr`);
        const temp = ctx.nextTemp();
        ctx.emit(`${temp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* ${strConstPtr})`);
        const flushTemp = ctx.nextTemp();
        ctx.emit(`${flushTemp} = call i32 @fflush(i8* ${stderrPtr})`);
        return temp;
      } else {
        const temp = ctx.nextTemp();
        ctx.emit(`${temp} = call i32 (i8*, ...) @printf(i8* ${strConstPtr})`);
        return temp;
      }
    } else if (argTyped.type === 'number') {
      const argValue = ctx.generateExpression(arg as Expression, params);
      if (useStderr) {
        const stderrPtr = ctx.nextTemp();
        ctx.emit(`${stderrPtr} = load i8*, i8** @stderr`);
        const temp = ctx.nextTemp();
        ctx.emit(`${temp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* getelementptr([7 x i8], [7 x i8]* @.str.numfmt, i32 0, i32 0), double ${argValue})`);
        const flushTemp = ctx.nextTemp();
        ctx.emit(`${flushTemp} = call i32 @fflush(i8* ${stderrPtr})`);
        return temp;
      } else {
        const temp = ctx.nextTemp();
        ctx.emit(`${temp} = call i32 (i8*, ...) @printf(i8* getelementptr([7 x i8], [7 x i8]* @.str.numfmt, i32 0, i32 0), double ${argValue})`);
        return temp;
      }
    } else {
      const argValue = ctx.generateExpression(arg as Expression, params);
      const isString = ctx.isStringExpression(arg as Expression);
      if (isString) {
        if (useStderr) {
          const stderrPtr = ctx.nextTemp();
          ctx.emit(`${stderrPtr} = load i8*, i8** @stderr`);
          const temp = ctx.nextTemp();
          ctx.emit(`${temp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* getelementptr([4 x i8], [4 x i8]* @.str.strfmt, i32 0, i32 0), i8* ${argValue})`);
          const flushTemp = ctx.nextTemp();
          ctx.emit(`${flushTemp} = call i32 @fflush(i8* ${stderrPtr})`);
          return temp;
        } else {
          const temp = ctx.nextTemp();
          ctx.emit(`${temp} = call i32 (i8*, ...) @printf(i8* getelementptr([4 x i8], [4 x i8]* @.str.strfmt, i32 0, i32 0), i8* ${argValue})`);
          return temp;
        }
      } else {
        if (useStderr) {
          const stderrPtr = ctx.nextTemp();
          ctx.emit(`${stderrPtr} = load i8*, i8** @stderr`);
          const temp = ctx.nextTemp();
          ctx.emit(`${temp} = call i32 (i8*, i8*, ...) @fprintf(i8* ${stderrPtr}, i8* getelementptr([7 x i8], [7 x i8]* @.str.numfmt, i32 0, i32 0), double ${argValue})`);
          const flushTemp = ctx.nextTemp();
          ctx.emit(`${flushTemp} = call i32 @fflush(i8* ${stderrPtr})`);
          return temp;
        } else {
          const temp = ctx.nextTemp();
          ctx.emit(`${temp} = call i32 (i8*, ...) @printf(i8* getelementptr([7 x i8], [7 x i8]* @.str.numfmt, i32 0, i32 0), double ${argValue})`);
          return temp;
        }
      }
    }
}

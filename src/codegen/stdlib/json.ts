import { Expression, MethodCallNode } from '../../ast/types.js';
import { IGeneratorContext } from '../infrastructure/generator-context.js';

/**
 * JSON Method Generator
 *
 * Generates LLVM IR for JSON.* methods using cJSON library.
 *
 * Supported methods:
 * - JSON.parse(str) → cJSON_Parse()
 * - JSON.stringify(value) → sprintf with format strings
 */
export class JsonGenerator {
  constructor(private ctx: IGeneratorContext) {}

  /**
   * Check if this method call is a JSON.* method
   */
  canHandle(expr: MethodCallNode): boolean {
    return expr.object.type === 'variable' &&
           (expr.object as any).name === 'JSON' &&
           (expr.method === 'parse' || expr.method === 'stringify');
  }

  /**
   * Generate LLVM IR for JSON.parse(str)
   * Uses cJSON library to parse JSON string
   */
  generateParse(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      throw new Error('JSON.parse() requires 1 argument (JSON string)');
    }

    // Check if type parameter was provided (JSON.parse<T>)
    const typeParam = (expr as any).typeParameter;
    if (!typeParam) {
      throw new Error(
        'JSON.parse() requires a type parameter. Use JSON.parse<InterfaceName>(jsonString).\n' +
        'ChadScript needs static types for JSON to generate efficient native code.\n\n' +
        'Example:\n' +
        '  interface User { name: string; age: number; }\n' +
        '  const user = JSON.parse<User>(\'{"name":"Alice","age":30}\');\n\n' +
        'Without type information, property access cannot be compiled.'
      );
    }

    const jsonStr = this.ctx.generateExpression(expr.args[0], params);

    // Parse JSON using cJSON
    const jsonRoot = this.ctx.nextTemp();
    this.ctx.emit(`${jsonRoot} = call i8* @cJSON_Parse(i8* ${jsonStr})`);

    // Check if parse succeeded
    const isNull = this.ctx.nextTemp();
    this.ctx.emit(`${isNull} = icmp eq i8* ${jsonRoot}, null`);

    const successLabel = this.ctx.nextLabel('json_success');
    const errorLabel = this.ctx.nextLabel('json_error');
    const endLabel = this.ctx.nextLabel('json_end');

    this.ctx.emit(`br i1 ${isNull}, label %${errorLabel}, label %${successLabel}`);

    // Error case: return null (0) as i8*
    this.ctx.emit(`${errorLabel}:`);
    const errorPtr = this.ctx.nextTemp();
    this.ctx.emit(`${errorPtr} = inttoptr i32 0 to i8*`);
    this.ctx.emit(`br label %${endLabel}`);

    // Success case: return raw cJSON object pointer
    this.ctx.emit(`${successLabel}:`);
    const resultPtr = this.ctx.nextTemp();
    this.ctx.emit(`${resultPtr} = bitcast i8* ${jsonRoot} to i8*`);
    this.ctx.emit(`br label %${endLabel}`);

    // Merge: return result or error
    this.ctx.emit(`${endLabel}:`);
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = phi i8* [ ${errorPtr}, %${errorLabel} ], [ ${resultPtr}, %${successLabel} ]`);

    return result;
  }

  /**
   * Generate LLVM IR for JSON.stringify(value)
   * Converts value to JSON string using sprintf
   */
  generateStringify(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      throw new Error('JSON.stringify() requires 1 argument');
    }

    const arg = expr.args[0];

    // Check if it's a string
    if (this.ctx.isStringExpression(arg)) {
      return this.stringifyString(arg, params);
    } else {
      return this.stringifyNumber(arg, params);
    }
  }

  /**
   * Stringify a string value: add quotes around it
   */
  private stringifyString(arg: Expression, params: string[]): string {
    const strPtr = this.ctx.generateExpression(arg, params);

    // For strings, we need to add quotes: "value"
    // Calculate: 2 (quotes) + strlen + 1 (null) = strlen + 3
    const strLen = this.ctx.nextTemp();
    this.ctx.emit(`${strLen} = call i64 @strlen(i8* ${strPtr})`);
    const bufferSize = this.ctx.nextTemp();
    this.ctx.emit(`${bufferSize} = add i64 ${strLen}, 3`);
    const buffer = this.ctx.nextTemp();
    this.ctx.emit(`${buffer} = call i8* @malloc(i64 ${bufferSize})`);

    // Create format string: "\"%s\""
    const formatStr = this.ctx.createStringConstant('"%s"');
    const sprintfResult = this.ctx.nextTemp();
    this.ctx.emit(`${sprintfResult} = call i32 (i8*, i8*, ...) @sprintf(i8* ${buffer}, i8* ${formatStr}, i8* ${strPtr})`);

    return buffer;
  }

  /**
   * Stringify a number value: convert to string
   */
  private stringifyNumber(arg: Expression, params: string[]): string {
    const numValue = this.ctx.generateExpression(arg, params);

    // Allocate buffer for number string (30 chars should be enough for double)
    const buffer = this.ctx.nextTemp();
    this.ctx.emit(`${buffer} = call i8* @malloc(i64 30)`);

    // Create format string: "%f"
    const formatStr = this.ctx.createStringConstant('%f');
    const sprintfResult = this.ctx.nextTemp();
    this.ctx.emit(`${sprintfResult} = call i32 (i8*, i8*, ...) @sprintf(i8* ${buffer}, i8* ${formatStr}, double ${numValue})`);

    return buffer;
  }
}

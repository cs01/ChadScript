/**
 * Response Generator
 *
 * Handles methods and properties on fetch() Response objects:
 * - response.text() - Get response body as string
 * - response.json() - Parse response body as JSON
 * - response.status - HTTP status code (200, 404, etc.)
 * - response.ok - Boolean indicating success (status 200-299)
 */

export class ResponseGenerator {
  constructor(private ctx: any) {}

  /**
   * Generate Response.text() method call
   * Returns the response body as a string
   *
   * @param responsePtr - LLVM register holding Response*
   */
  generateText(responsePtr: string): string {
    // Get pointer to body field (field 2)
    const bodyFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${bodyFieldPtr} = getelementptr %Response, %Response* ${responsePtr}, i32 0, i32 2`);

    // Load the i8* body pointer from the struct
    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = load i8*, i8** ${bodyFieldPtr}`);

    return temp;
  }

  /**
   * Generate Response.json() method call
   * Parses the response body as JSON
   *
   * @param responsePtr - LLVM register holding Response*
   */
  generateJson(responsePtr: string): string {
    // Get the body string first
    const bodyPtr = this.generateText(responsePtr);

    // Call JSON.parse on it
    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = call double @cJSON_Parse_number(i8* ${bodyPtr})`);

    return temp;
  }

  /**
   * Generate Response.status property access
   * Returns the HTTP status code as a number
   *
   * @param responsePtr - LLVM register holding Response*
   */
  generateStatus(responsePtr: string): string {
    // Get pointer to status_code field (field 1)
    const statusFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${statusFieldPtr} = getelementptr %Response, %Response* ${responsePtr}, i32 0, i32 1`);

    // Load the i32 status code
    const statusI32 = this.ctx.nextTemp();
    this.ctx.emit(`${statusI32} = load i32, i32* ${statusFieldPtr}`);

    // Convert to double (ChadScript's number type)
    const statusDouble = this.ctx.nextTemp();
    this.ctx.emit(`${statusDouble} = sitofp i32 ${statusI32} to double`);

    return statusDouble;
  }

  /**
   * Generate Response.ok property access
   * Returns true if status is 200-299 (success range)
   *
   * @param responsePtr - LLVM register holding Response*
   */
  generateOk(responsePtr: string): string {
    // Get pointer to status_code field (field 1)
    const statusFieldPtr = this.ctx.nextTemp();
    this.ctx.emit(`${statusFieldPtr} = getelementptr %Response, %Response* ${responsePtr}, i32 0, i32 1`);

    // Load the i32 status code
    const statusI32 = this.ctx.nextTemp();
    this.ctx.emit(`${statusI32} = load i32, i32* ${statusFieldPtr}`);

    // Check if status >= 200
    const gte200 = this.ctx.nextTemp();
    this.ctx.emit(`${gte200} = icmp sge i32 ${statusI32}, 200`);

    // Check if status < 300
    const lt300 = this.ctx.nextTemp();
    this.ctx.emit(`${lt300} = icmp slt i32 ${statusI32}, 300`);

    // AND the two conditions
    const isOk = this.ctx.nextTemp();
    this.ctx.emit(`${isOk} = and i1 ${gte200}, ${lt300}`);

    // Convert i1 (boolean) to double (0.0 or 1.0)
    const okDouble = this.ctx.nextTemp();
    this.ctx.emit(`${okDouble} = uitofp i1 ${isOk} to double`);

    return okDouble;
  }
}

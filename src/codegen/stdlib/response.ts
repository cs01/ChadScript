/**
 * Response Generator
 *
 * Handles methods and properties on fetch() Response objects:
 * - response.text() - Get response body as string
 * - response.json() - Parse response body as JSON (untyped or typed with generics)
 * - response.status - HTTP status code (200, 404, etc.)
 * - response.ok - Boolean indicating success (status 200-299)
 */

export class ResponseGenerator {
  private generatedStructs: Set<string> = new Set();  // Track generated interface structs
  private generatedParsers: Set<string> = new Set();  // Track generated JSON parsers

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
   * Parses the response body as JSON and returns cJSON object pointer
   *
   * @param responsePtr - LLVM register holding Response*
   */
  generateJson(responsePtr: string): string {
    // Get the body string first
    const bodyPtr = this.generateText(responsePtr);

    // Parse JSON using cJSON library (same as JSON.parse())
    const jsonRoot = this.ctx.nextTemp();
    this.ctx.emit(`${jsonRoot} = call i8* @cJSON_Parse(i8* ${bodyPtr})`);

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

    // Success case: return cJSON object pointer
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
   * Generate typed Response.json<T>() method call
   * Parses the response body as JSON and returns a typed struct pointer
   *
   * @param responsePtr - LLVM register holding Response*
   * @param typeName - Interface name (e.g., "JsonTestResponse")
   * @param interfaceDef - Interface definition with properties
   */
  generateTypedJson(
    responsePtr: string,
    typeName: string,
    interfaceDef: { properties: { name: string; type: string }[] }
  ): string {
    // Generate struct type if not already done
    if (!this.generatedStructs.has(typeName)) {
      this.generateJsonStruct(typeName, interfaceDef);
      this.generatedStructs.add(typeName);
    }

    // Generate parser function if not already done
    if (!this.generatedParsers.has(typeName)) {
      this.generateJsonParser(typeName, interfaceDef);
      this.generatedParsers.add(typeName);
    }

    // Get the body string
    const bodyPtr = this.generateText(responsePtr);

    // Call the specialized parser
    const result = this.ctx.nextTemp();
    this.ctx.emit(`${result} = call %${typeName}* @parse_json_${typeName}(i8* ${bodyPtr})`);

    return result;
  }

  /**
   * Generate a struct type definition for a JSON interface
   */
  private generateJsonStruct(
    typeName: string,
    interfaceDef: { properties: { name: string; type: string }[] }
  ): void {
    // Build struct type: %TypeName = type { i8*, double, i8*, ... }
    const fieldTypes = interfaceDef.properties.map(prop => {
      if (prop.type === 'string') return 'i8*';
      if (prop.type === 'number') return 'double';
      if (prop.type === 'boolean') return 'i1';
      return 'i8*';  // default to string for unknown types
    });

    const structDef = `%${typeName} = type { ${fieldTypes.join(', ')} }\n`;
    this.ctx.globalStrings.unshift(structDef);  // Add to beginning of global strings
  }

  /**
   * Generate a specialized JSON parser function for a struct type
   */
  private generateJsonParser(
    typeName: string,
    interfaceDef: { properties: { name: string; type: string }[] }
  ): void {
    let parserIR = `define %${typeName}* @parse_json_${typeName}(i8* %json_str) {\n`;
    parserIR += 'entry:\n';

    // Parse JSON
    parserIR += `  %json_root = call i8* @cJSON_Parse(i8* %json_str)\n`;

    // Allocate struct (size = number of fields * 8 bytes per field)
    const structSize = interfaceDef.properties.length * 8;
    parserIR += `  %struct_bytes = call i8* @GC_malloc(i64 ${structSize})\n`;
    parserIR += `  %struct_ptr = bitcast i8* %struct_bytes to %${typeName}*\n\n`;

    // Extract each field
    let fieldIndex = 0;
    for (const prop of interfaceDef.properties) {
      const fieldNameConst = this.ctx.nextString();
      this.ctx.globalStrings.push(`${fieldNameConst} = private unnamed_addr constant [${prop.name.length + 1} x i8] c"${prop.name}\\00", align 1`);

      parserIR += `  ; Extract field "${prop.name}"\n`;
      parserIR += `  %item_${fieldIndex} = call i8* @cJSON_GetObjectItem(i8* %json_root, i8* getelementptr inbounds ([${prop.name.length + 1} x i8], [${prop.name.length + 1} x i8]* ${fieldNameConst}, i64 0, i64 0))\n`;

      if (prop.type === 'string') {
        // Get string value from cJSON (this returns a pointer into the cJSON object)
        parserIR += `  %temp_str_${fieldIndex} = call i8* @cJSON_GetStringValue(i8* %item_${fieldIndex})\n`;
        // Duplicate the string so it survives after cJSON_Delete
        parserIR += `  %value_${fieldIndex} = call i8* @strdup(i8* %temp_str_${fieldIndex})\n`;
      } else if (prop.type === 'number') {
        parserIR += `  %value_${fieldIndex} = call double @cJSON_GetNumberValue(i8* %item_${fieldIndex})\n`;
      } else if (prop.type === 'boolean') {
        // Get as number, convert to boolean
        parserIR += `  %num_${fieldIndex} = call double @cJSON_GetNumberValue(i8* %item_${fieldIndex})\n`;
        parserIR += `  %value_${fieldIndex} = fcmp one double %num_${fieldIndex}, 0.0\n`;
      }

      // Store in struct
      parserIR += `  %field_ptr_${fieldIndex} = getelementptr inbounds %${typeName}, %${typeName}* %struct_ptr, i32 0, i32 ${fieldIndex}\n`;

      if (prop.type === 'string') {
        parserIR += `  store i8* %value_${fieldIndex}, i8** %field_ptr_${fieldIndex}\n\n`;
      } else if (prop.type === 'number') {
        parserIR += `  store double %value_${fieldIndex}, double* %field_ptr_${fieldIndex}\n\n`;
      } else if (prop.type === 'boolean') {
        parserIR += `  store i1 %value_${fieldIndex}, i1* %field_ptr_${fieldIndex}\n\n`;
      }

      fieldIndex++;
    }

    // Clean up cJSON object
    parserIR += `  call void @cJSON_Delete(i8* %json_root)\n`;

    // Return struct pointer
    parserIR += `  ret %${typeName}* %struct_ptr\n`;
    parserIR += `}\n\n`;

    // Add parser function to global strings (will be emitted before functions)
    this.ctx.globalStrings.push(parserIR);
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
    this.ctx.variableTypes.set(statusDouble, 'double');

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
    this.ctx.variableTypes.set(okDouble, 'double');

    return okDouble;
  }
}

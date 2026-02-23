import { Expression, MethodCallNode } from "../../ast/types.js";

interface ExprBase {
  type: string;
}

import { IGeneratorContext } from "../infrastructure/generator-context.js";

export class JsonGenerator {
  private generatedKeys: string[];

  constructor(private ctx: IGeneratorContext) {
    this.generatedKeys = [];
  }

  private hasGenerated(key: string): boolean {
    for (let i = 0; i < this.generatedKeys.length; i++) {
      if (this.generatedKeys[i] === key) return true;
    }
    return false;
  }

  private markGenerated(key: string): void {
    this.generatedKeys.push(key);
  }

  private getFieldName(typeName: string, index: number): string {
    let name = this.ctx.interfaceStructGenGetFieldName(typeName, index);
    if (name.charAt(name.length - 1) === "?") {
      name = name.substring(0, name.length - 1);
    }
    return name;
  }

  canHandle(expr: MethodCallNode): boolean {
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type !== "variable") return false;
    const varNode = expr.object as { type: string; name: string };
    if (varNode.name !== "JSON") return false;
    return expr.method === "parse" || expr.method === "stringify";
  }

  generateParse(expr: MethodCallNode, params: string[], typeParam?: string): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("JSON.parse() requires 1 argument (JSON string)", expr.loc);
    }

    if (!typeParam) {
      return this.generateUntypedParse(expr, params);
    }

    if (typeParam === "number[]") {
      return this.generateParseNumberArray(expr, params);
    }

    if (!this.ctx.interfaceStructGenHasInterface(typeParam)) {
      return this.ctx.emitError(
        `JSON.parse<${typeParam}>: Interface '${typeParam}' not found`,
        expr.loc,
      );
    }

    this.generateJsonStruct(typeParam);
    this.generateJsonParser(typeParam);

    const jsonStr = this.ctx.generateExpression(expr.args[0], params);

    const result = this.ctx.emitCall(
      `%${typeParam}*`,
      `@parse_json_${typeParam}`,
      `i8* ${jsonStr}`,
    );
    this.ctx.setVariableType(result, `%${typeParam}*`);

    return result;
  }

  private generateUntypedParse(expr: MethodCallNode, params: string[]): string {
    const jsonStr = this.ctx.generateExpression(expr.args[0], params);
    const jsonRoot = this.ctx.emitCall("i8*", "@csyyjson_parse", `i8* ${jsonStr}`);
    return jsonRoot;
  }

  private generateParseNumberArray(expr: MethodCallNode, params: string[]): string {
    const jsonStr = this.ctx.generateExpression(expr.args[0], params);

    const jsonRoot = this.ctx.emitCall("i8*", "@csyyjson_parse", `i8* ${jsonStr}`);

    const isNull = this.ctx.emitIcmp("eq", "i8*", jsonRoot, "null");

    const successLabel = this.ctx.nextLabel("json_arr_success");
    const errorLabel = this.ctx.nextLabel("json_arr_error");
    const endLabel = this.ctx.nextLabel("json_arr_end");

    this.ctx.emitBrCond(isNull, errorLabel, successLabel);

    this.ctx.emitLabel(errorLabel);
    // inttoptr — no builder
    const nullArray = this.ctx.nextTemp();
    this.ctx.emit(`${nullArray} = inttoptr i64 0 to %Array*`);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(successLabel);

    const sizeI32 = this.ctx.emitCall("i32", "@csyyjson_arr_size", `i8* ${jsonRoot}`);
    const size = this.ctx.nextTemp();
    this.ctx.emit(`${size} = sitofp i32 ${sizeI32} to double`);

    const sizeI64 = this.ctx.nextTemp();
    this.ctx.emit(`${sizeI64} = fptosi double ${size} to i64`);
    const dataSize = this.ctx.nextTemp();
    this.ctx.emit(`${dataSize} = mul i64 ${sizeI64}, 8`);
    const dataPtr = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);
    const data = this.ctx.emitBitcast(dataPtr, "i8*", "double*");

    const arrPtr = this.ctx.emitCall("i8*", "@GC_malloc", "i64 24");
    const arr = this.ctx.emitBitcast(arrPtr, "i8*", "%Array*");

    const dataFieldPtr = this.ctx.emitGep("%Array", arr, "i32 0, i32 0");
    this.ctx.emitStore("double*", data, dataFieldPtr);

    const lenFieldPtr = this.ctx.emitGep("%Array", arr, "i32 0, i32 1");
    this.ctx.emitStore("i32", sizeI32, lenFieldPtr);

    const capFieldPtr = this.ctx.emitGep("%Array", arr, "i32 0, i32 2");
    this.ctx.emitStore("i32", sizeI32, capFieldPtr);

    const loopInit = this.ctx.nextLabel("json_arr_loop_init");
    const loopCond = this.ctx.nextLabel("json_arr_loop_cond");
    const loopBody = this.ctx.nextLabel("json_arr_loop_body");
    const loopEnd = this.ctx.nextLabel("json_arr_loop_end");

    this.ctx.emitBr(loopInit);
    this.ctx.emitLabel(loopInit);
    this.ctx.emitBr(loopCond);

    this.ctx.emitLabel(loopCond);
    const i = this.ctx.nextTemp();
    const phiPlaceholder = `${i}.next`;
    this.ctx.emit(`${i} = phi i32 [ 0, %${loopInit} ], [ ${phiPlaceholder}, %${loopBody} ]`);
    const cond = this.ctx.emitIcmp("slt", "i32", i, sizeI32);
    this.ctx.emitBrCond(cond, loopBody, loopEnd);

    this.ctx.emitLabel(loopBody);
    const item = this.ctx.emitCall("i8*", "@csyyjson_arr_get", `i8* ${jsonRoot}, i32 ${i}`);
    const valPtr = this.ctx.emitCall("double", "@csyyjson_get_num", `i8* ${item}`);
    const elemPtr = this.ctx.emitGep("double", data, `i32 ${i}`);
    this.ctx.emitStore("double", valPtr, elemPtr);
    const iInc = this.ctx.nextTemp();
    this.ctx.emit(`${iInc} = add i32 ${i}, 1`);
    this.ctx.emitBr(loopCond);

    let phiIdx = -1;
    for (let phiSearchIdx = 0; phiSearchIdx < this.ctx.getOutputLength(); phiSearchIdx++) {
      if (this.ctx.getOutputLine(phiSearchIdx).includes(phiPlaceholder)) {
        phiIdx = phiSearchIdx;
        break;
      }
    }
    if (phiIdx !== -1) {
      this.ctx.setOutputLine(phiIdx, this.ctx.getOutputLine(phiIdx).replace(phiPlaceholder, iInc));
    }

    this.ctx.emitLabel(loopEnd);
    this.ctx.emitBr(endLabel);

    this.ctx.emitLabel(endLabel);
    const result = this.ctx.nextTemp();
    this.ctx.emit(
      `${result} = phi %Array* [ ${nullArray}, %${errorLabel} ], [ ${arr}, %${loopEnd} ]`,
    );
    this.ctx.setVariableType(result, "%Array*");

    return result;
  }

  private hasStructInGlobalStrings(typeName: string): boolean {
    const pattern = `%${typeName} = type`;
    for (let i = 0; i < this.ctx.getGlobalStringsLength(); i++) {
      if (this.ctx.getGlobalStringAt(i).includes(pattern)) {
        return true;
      }
    }
    return false;
  }

  private generateJsonStruct(typeName: string): void {
    if (this.hasGenerated(typeName)) {
      return;
    }
    this.markGenerated(typeName);

    if (this.hasStructInGlobalStrings(typeName)) {
      return;
    }

    if (this.ctx.interfaceStructGenHasInterface(typeName)) {
      return;
    }

    const fieldCount = this.ctx.interfaceStructGenGetFieldCount(typeName);
    const fieldTypes: string[] = [];
    for (let fi = 0; fi < fieldCount; fi++) {
      const fieldType = this.ctx.interfaceStructGenGetFieldTsType(typeName, fi);
      if (fieldType === "string") {
        fieldTypes.push("i8*");
      } else if (fieldType === "number") {
        fieldTypes.push("double");
      } else if (fieldType === "boolean") {
        fieldTypes.push("double");
      } else {
        if (this.ctx.interfaceStructGenHasInterface(fieldType)) {
          fieldTypes.push(`%${fieldType}*`);
        } else {
          fieldTypes.push("i8*");
        }
      }
    }

    const structDef = `%${typeName} = type { ${fieldTypes.join(", ")} }` + "\n";
    const newGlobalStrings: string[] = [structDef];
    for (let i = 0; i < this.ctx.getGlobalStringsLength(); i++) {
      newGlobalStrings.push(this.ctx.getGlobalStringAt(i));
    }
    this.ctx.clearGlobalStrings();
    for (let i = 0; i < newGlobalStrings.length; i++) {
      this.ctx.pushGlobalString(newGlobalStrings[i]);
    }
  }

  private generateJsonParser(typeName: string): void {
    const parserKey = "__parser__" + typeName;
    if (this.hasGenerated(parserKey)) {
      return;
    }
    this.markGenerated(parserKey);

    const fieldCount = this.ctx.interfaceStructGenGetFieldCount(typeName);

    for (let fi = 0; fi < fieldCount; fi++) {
      const fieldType = this.ctx.interfaceStructGenGetFieldTsType(typeName, fi);
      if (fieldType !== "string" && fieldType !== "number" && fieldType !== "boolean") {
        if (this.ctx.interfaceStructGenHasInterface(fieldType)) {
          this.generateJsonStruct(fieldType);
          this.generateJsonParser(fieldType);
        }
      }
    }

    const fieldNameConsts: string[] = [];
    const fieldNames: string[] = [];
    for (let fi = 0; fi < fieldCount; fi++) {
      const fn = this.getFieldName(typeName, fi);
      fieldNames.push(fn);
      const c = this.ctx.nextString();
      fieldNameConsts.push(c);
      this.ctx.pushGlobalString(
        c +
          " = private unnamed_addr constant [" +
          (fn.length + 1) +
          ' x i8] c"' +
          fn +
          '\\00", align 1\n',
      );
    }

    const structSize = fieldCount * 8;
    const lines: string[] = [];
    lines.push("define %" + typeName + "* @parse_json_" + typeName + "(i8* %json_str) {");
    lines.push("entry:");
    lines.push("  %struct_bytes = call i8* @GC_malloc(i64 " + structSize + ")");
    lines.push("  %struct_ptr = bitcast i8* %struct_bytes to %" + typeName + "*");

    for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) {
      const fieldType = this.ctx.interfaceStructGenGetFieldTsType(typeName, fieldIndex);
      if (fieldType === "string") {
        lines.push(
          "  %init_ptr_" +
            fieldIndex +
            " = getelementptr inbounds %" +
            typeName +
            ", %" +
            typeName +
            "* %struct_ptr, i32 0, i32 " +
            fieldIndex,
        );
        lines.push(
          "  store i8* getelementptr inbounds ([1 x i8], [1 x i8]* @.empty_str, i64 0, i64 0), i8** %init_ptr_" +
            fieldIndex,
        );
      }
    }

    lines.push("  %json_root = call i8* @csyyjson_parse(i8* %json_str)");
    lines.push("  %json_is_null = icmp eq i8* %json_root, null");
    lines.push("  br i1 %json_is_null, label %json_error, label %json_ok");
    lines.push("");
    lines.push("json_error:");
    lines.push("  ret %" + typeName + "* %struct_ptr");
    lines.push("");

    if (fieldCount === 0) {
      lines.push("json_ok:");
      lines.push("  br label %json_cleanup");
      lines.push("");
    } else {
      lines.push("json_ok:");
      lines.push("  br label %field_0");
      lines.push("");

      for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) {
        const fieldName = fieldNames[fieldIndex];
        const fieldType = this.ctx.interfaceStructGenGetFieldTsType(typeName, fieldIndex);
        const nextLabel =
          fieldIndex + 1 < fieldCount ? "field_" + (fieldIndex + 1) : "json_cleanup";
        const fnc = fieldNameConsts[fieldIndex];
        const fnLen = fieldName.length + 1;

        lines.push("field_" + fieldIndex + ":");
        lines.push(
          "  %item_" +
            fieldIndex +
            " = call i8* @csyyjson_obj_get(i8* %json_root, i8* getelementptr inbounds ([" +
            fnLen +
            " x i8], [" +
            fnLen +
            " x i8]* " +
            fnc +
            ", i64 0, i64 0))",
        );
        lines.push("  %item_" + fieldIndex + "_null = icmp eq i8* %item_" + fieldIndex + ", null");
        lines.push(
          "  br i1 %item_" +
            fieldIndex +
            "_null, label %" +
            nextLabel +
            ", label %field_" +
            fieldIndex +
            "_extract",
        );
        lines.push("");

        if (fieldType === "string") {
          lines.push("field_" + fieldIndex + "_extract:");
          lines.push(
            "  %temp_str_" +
              fieldIndex +
              " = call i8* @csyyjson_get_str(i8* %item_" +
              fieldIndex +
              ")",
          );
          lines.push(
            "  %str_" + fieldIndex + "_null = icmp eq i8* %temp_str_" + fieldIndex + ", null",
          );
          lines.push(
            "  br i1 %str_" +
              fieldIndex +
              "_null, label %" +
              nextLabel +
              ", label %field_" +
              fieldIndex +
              "_store",
          );
          lines.push("");
          lines.push("field_" + fieldIndex + "_store:");
          lines.push(
            "  %value_" + fieldIndex + " = call i8* @strdup(i8* %temp_str_" + fieldIndex + ")",
          );
          lines.push(
            "  %field_ptr_" +
              fieldIndex +
              " = getelementptr inbounds %" +
              typeName +
              ", %" +
              typeName +
              "* %struct_ptr, i32 0, i32 " +
              fieldIndex,
          );
          lines.push("  store i8* %value_" + fieldIndex + ", i8** %field_ptr_" + fieldIndex);
          lines.push("  br label %" + nextLabel);
          lines.push("");
        } else if (fieldType === "number" || fieldType === "boolean") {
          lines.push("field_" + fieldIndex + "_extract:");
          lines.push(
            "  %value_" +
              fieldIndex +
              " = call double @csyyjson_get_num(i8* %item_" +
              fieldIndex +
              ")",
          );
          lines.push(
            "  %field_ptr_" +
              fieldIndex +
              " = getelementptr inbounds %" +
              typeName +
              ", %" +
              typeName +
              "* %struct_ptr, i32 0, i32 " +
              fieldIndex,
          );
          lines.push("  store double %value_" + fieldIndex + ", double* %field_ptr_" + fieldIndex);
          lines.push("  br label %" + nextLabel);
          lines.push("");
        } else {
          lines.push("field_" + fieldIndex + "_extract:");
          lines.push(
            "  %nested_str_" +
              fieldIndex +
              " = call i8* @csyyjson_val_write(i8* %item_" +
              fieldIndex +
              ")",
          );
          lines.push(
            "  %value_" +
              fieldIndex +
              " = call %" +
              fieldType +
              "* @parse_json_" +
              fieldType +
              "(i8* %nested_str_" +
              fieldIndex +
              ")",
          );
          lines.push(
            "  %field_ptr_" +
              fieldIndex +
              " = getelementptr inbounds %" +
              typeName +
              ", %" +
              typeName +
              "* %struct_ptr, i32 0, i32 " +
              fieldIndex,
          );
          lines.push(
            "  store %" +
              fieldType +
              "* %value_" +
              fieldIndex +
              ", %" +
              fieldType +
              "** %field_ptr_" +
              fieldIndex,
          );
          lines.push("  br label %" + nextLabel);
          lines.push("");
        }
      }
    }

    lines.push("json_cleanup:");
    lines.push("  call void @csyyjson_free(i8* %json_root)");
    lines.push("  ret %" + typeName + "* %struct_ptr");
    lines.push("}");
    lines.push("");

    for (let li = 0; li < lines.length; li++) {
      this.ctx.pushGlobalString(lines[li] + "\n");
    }
  }

  generateStringify(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("JSON.stringify() requires 1 argument", expr.loc);
    }

    const arg = expr.args[0];

    if (this.ctx.isStringExpression(arg)) {
      return this.stringifyString(arg, params);
    }

    const interfaceType = this.resolveInterfaceType(arg);
    if (interfaceType) {
      return this.stringifyInterface(arg, params, interfaceType);
    }

    // Generate expression first to check its actual LLVM type.
    // Untyped JSON.parse() returns i8* (opaque yyjson value) — stringify via yyjson
    // instead of falling through to sprintf which expects double.
    const value = this.ctx.generateExpression(arg, params);
    const varType = this.ctx.getVariableType(value);
    if (varType && varType.endsWith("*")) {
      const result = this.ctx.emitCall("i8*", "@csyyjson_val_write", `i8* ${value}`);
      this.ctx.setVariableType(result, "i8*");
      return result;
    }

    // Numeric value — format with sprintf
    const dblValue = this.ctx.ensureDouble(value);
    const buffer = this.ctx.emitCall("i8*", "@GC_malloc_atomic", "i64 30");
    const formatStr = this.ctx.createStringConstant("%f");
    // sprintf has variadic signature — keep as raw emit
    const sprintfResult = this.ctx.nextTemp();
    this.ctx.emit(
      `${sprintfResult} = call i32 (i8*, i8*, ...) @sprintf(i8* ${buffer}, i8* ${formatStr}, double ${dblValue})`,
    );
    this.ctx.setVariableType(buffer, "i8*");
    return buffer;
  }

  private resolveInterfaceType(arg: Expression): string | null {
    if (arg.type === "variable") {
      const varNode = arg as { type: string; name: string };
      return (
        this.ctx.symbolTable.getInterfaceType(varNode.name) ||
        this.ctx.symbolTable.getRawInterfaceType(varNode.name) ||
        null
      );
    }
    if (arg.type === "index_access") {
      const indexAccess = arg as { type: string; object: Expression; index: Expression };
      const objExpr = indexAccess.object;
      if (objExpr && objExpr.type === "variable") {
        const varObj = objExpr as { type: string; name: string };
        const arrayName = varObj.name;
        if (arrayName) {
          const elemType = this.ctx.symbolTable.getRawInterfaceType(arrayName);
          if (elemType) {
            return elemType;
          }
        }
        return null;
      }
    }
    return null;
  }

  private stringifyInterface(arg: Expression, params: string[], interfaceType: string): string {
    if (!this.ctx.interfaceStructGenHasInterface(interfaceType)) {
      return this.stringifyNumber(arg, params);
    }
    const fieldCount = this.ctx.interfaceStructGenGetFieldCount(interfaceType);
    if (fieldCount === 0) {
      return this.stringifyNumber(arg, params);
    }

    const fieldTypes: string[] = [];
    for (let i = 0; i < fieldCount; i++) {
      fieldTypes.push(this.ctx.interfaceStructGenGetFieldLlvmType(interfaceType, i));
    }
    const structType = `{ ${fieldTypes.join(", ")} }`;

    const objPtr = this.ctx.generateExpression(arg, params);

    const typedPtr = this.ctx.emitBitcast(objPtr, "i8*", `${structType}*`);

    this.ctx.setUsesJson(true);
    const jsonDoc = this.ctx.emitCall("i8*", "@csyyjson_create_obj", "");
    const jsonObj = this.ctx.emitCall("i8*", "@csyyjson_mut_get_root", `i8* ${jsonDoc}`);

    for (let i = 0; i < fieldCount; i++) {
      const fieldName = this.ctx.interfaceStructGenGetFieldName(interfaceType, i);
      const fieldTsType = this.ctx.interfaceStructGenGetFieldTsType(interfaceType, i);
      // inbounds GEP — keep as raw emit
      const fieldPtr = this.ctx.nextTemp();
      this.ctx.emit(
        `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${i}`,
      );

      const nameConst = this.ctx.createStringConstant(fieldName);

      if (fieldTsType === "string") {
        const val = this.ctx.emitLoad("i8*", fieldPtr);
        this.ctx.emitCallVoid(
          "@csyyjson_obj_add_str",
          `i8* ${jsonDoc}, i8* ${jsonObj}, i8* ${nameConst}, i8* ${val}`,
        );
      } else if (fieldTsType === "boolean") {
        const val = this.ctx.emitLoad("double", fieldPtr);
        const boolInt = this.ctx.nextTemp();
        this.ctx.emit(`${boolInt} = fptosi double ${val} to i32`);
        this.ctx.emitCallVoid(
          "@csyyjson_obj_add_bool",
          `i8* ${jsonDoc}, i8* ${jsonObj}, i8* ${nameConst}, i32 ${boolInt}`,
        );
      } else {
        const val = this.ctx.emitLoad("double", fieldPtr);
        this.ctx.emitCallVoid(
          "@csyyjson_obj_add_num",
          `i8* ${jsonDoc}, i8* ${jsonObj}, i8* ${nameConst}, double ${val}`,
        );
      }
    }

    const result = this.ctx.emitCall("i8*", "@csyyjson_stringify", `i8* ${jsonDoc}`);
    this.ctx.setVariableType(result, "i8*");

    return result;
  }

  private stringifyString(arg: Expression, params: string[]): string {
    const strPtr = this.ctx.generateExpression(arg, params);

    const strLen = this.ctx.emitCall("i64", "@strlen", `i8* ${strPtr}`);
    const bufferSize = this.ctx.nextTemp();
    this.ctx.emit(`${bufferSize} = add i64 ${strLen}, 3`);
    const buffer = this.ctx.emitCall("i8*", "@GC_malloc_atomic", `i64 ${bufferSize}`);

    const formatStr = this.ctx.createStringConstant('"%s"');
    // sprintf has variadic signature — keep as raw emit
    const sprintfResult = this.ctx.nextTemp();
    this.ctx.emit(
      `${sprintfResult} = call i32 (i8*, i8*, ...) @sprintf(i8* ${buffer}, i8* ${formatStr}, i8* ${strPtr})`,
    );

    this.ctx.setVariableType(buffer, "i8*");
    return buffer;
  }

  private stringifyNumber(arg: Expression, params: string[]): string {
    const numValue = this.ctx.generateExpression(arg, params);
    const dblValue = this.ctx.ensureDouble(numValue);

    const buffer = this.ctx.emitCall("i8*", "@GC_malloc_atomic", "i64 30");

    const formatStr = this.ctx.createStringConstant("%f");
    // sprintf has variadic signature — keep as raw emit
    const sprintfResult = this.ctx.nextTemp();
    this.ctx.emit(
      `${sprintfResult} = call i32 (i8*, i8*, ...) @sprintf(i8* ${buffer}, i8* ${formatStr}, double ${dblValue})`,
    );

    this.ctx.setVariableType(buffer, "i8*");
    return buffer;
  }
}

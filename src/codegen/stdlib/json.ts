import {
  Expression,
  MethodCallNode,
  ObjectNode,
  ArrayNode,
  TypeAssertionNode,
  VariableNode,
  NumberNode,
  IndexAccessNode,
  MemberAccessNode,
} from "../../ast/types.js";
import { stringifyObjectArrayLiteral, stringifyObjectArrayWithMeta } from "./json-array.js";

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
    const varNode = expr.object as VariableNode;
    if (varNode.name !== "JSON") return false;
    return expr.method === "parse" || expr.method === "stringify";
  }

  generateParse(expr: MethodCallNode, params: string[], typeParam?: string): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("JSON.parse() requires 1 argument (JSON string)", expr.loc);
    }

    if (!typeParam) {
      return this.ctx.emitError(
        "JSON.parse() requires a type parameter, e.g. JSON.parse<MyType>(str)",
        expr.loc,
      );
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

    let phiIdx: number = -1;
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

  private hasParserInGlobalStrings(typeName: string): boolean {
    const pattern = `@parse_json_${typeName}(i8* %json_str)`;
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
    if (this.hasParserInGlobalStrings(typeName)) {
      return;
    }

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

  private getSpaces(expr: MethodCallNode): number {
    if (expr.args.length < 3) return 0;
    const spaceArg = expr.args[2] as NumberNode;
    if (spaceArg.type === "number" && typeof spaceArg.value === "number") {
      return spaceArg.value;
    }
    return 0;
  }

  private emitStringify(jsonDoc: string, spaces: number): string {
    if (spaces > 0) {
      const spacesI32 = spaces === 2 ? "2" : "4";
      return this.ctx.emitCall(
        "i8*",
        "@csyyjson_stringify_pretty",
        `i8* ${jsonDoc}, i32 ${spacesI32}`,
      );
    }
    return this.ctx.emitCall("i8*", "@csyyjson_stringify", `i8* ${jsonDoc}`);
  }

  generateStringifyExpr(arg: Expression, params: string[]): string {
    return this.generateStringifyArgWithSpaces(arg, params, 0);
  }

  generateStringify(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1) {
      return this.ctx.emitError("JSON.stringify() requires 1 argument", expr.loc);
    }

    const spaces = this.getSpaces(expr);
    if (expr.args[0].type === "type_assertion") {
      return this.generateStringifyArgWithSpaces(
        (expr.args[0] as TypeAssertionNode).expression,
        params,
        spaces,
      );
    }
    return this.generateStringifyArgWithSpaces(expr.args[0], params, spaces);
  }

  private generateStringifyArg(arg: Expression, expr: MethodCallNode, params: string[]): string {
    return this.generateStringifyArgWithSpaces(arg, params, this.getSpaces(expr));
  }

  private generateStringifyArgWithSpaces(
    arg: Expression,
    params: string[],
    spaces: number,
  ): string {
    if (this.ctx.isStringExpression(arg)) {
      return this.stringifyString(arg, params);
    }

    if (arg.type === "object") {
      return this.stringifyObjectLiteral(arg as ObjectNode, params, spaces);
    }

    if (arg.type === "array") {
      const arrayExpr = arg as ArrayNode;
      const elements = arrayExpr.elements || [];
      if (elements.length > 0 && (elements[0] as ExprBase).type === "object") {
        return stringifyObjectArrayLiteral(this.ctx, arrayExpr, params, spaces);
      }
    }

    // Check for ObjectArray (e.g. Post[]) before resolveInterfaceType —
    // getRawInterfaceType returns the element type for arrays, which would
    // cause stringifyInterface to treat the array pointer as a single object.
    if (arg.type === "variable") {
      const varNode = arg as VariableNode;
      const elementType = this.ctx.symbolTable.getObjectArrayElementType(varNode.name);
      if (elementType) {
        return this.stringifyObjectArray(arg, params, elementType, spaces);
      }
      if (this.ctx.symbolTable.isStringArray(varNode.name)) {
        return this.stringifyStringArray(arg, params, spaces);
      }
      if (this.ctx.symbolTable.isNumberArray(varNode.name)) {
        return this.stringifyNumberArray(arg, params, spaces);
      }
    }

    if (this.ctx.isStringArrayExpression(arg)) {
      return this.stringifyStringArray(arg, params, spaces);
    }

    const interfaceType = this.resolveInterfaceType(arg);
    if (interfaceType) {
      return this.stringifyInterface(arg, params, interfaceType, spaces);
    }

    if (arg.type === "number" || arg.type === "boolean") {
      return this.stringifyNumber(arg, params);
    }
    if (arg.type === "variable") {
      const varNode = arg as VariableNode;
      if (
        this.ctx.symbolTable.isNumber(varNode.name) ||
        this.ctx.symbolTable.isBoolean(varNode.name)
      ) {
        return this.stringifyNumber(arg, params);
      }
      return this.ctx.emitError(
        `JSON.stringify: unsupported type for variable '${varNode.name}' — only string, number, boolean, interface, string[], number[], and object[] are supported`,
      );
    }

    return this.ctx.emitError(
      "JSON.stringify: unsupported argument type — only string, number, boolean, interface, string[], number[], and object[] are supported",
    );
  }

  private extractInterfaceFromLlvmType(llvmType: string): string | null {
    if (llvmType.startsWith("%") && llvmType.endsWith("*")) {
      return llvmType.slice(1, -1);
    }
    return null;
  }

  private resolveInterfaceType(arg: Expression): string | null {
    if (arg.type === "variable") {
      const varNode = arg as VariableNode;
      const fromSymbol =
        this.ctx.symbolTable.getInterfaceType(varNode.name) ||
        this.ctx.symbolTable.getRawInterfaceType(varNode.name) ||
        null;
      if (fromSymbol) return fromSymbol;
      const llvmType = this.ctx.getVariableType(varNode.name);
      if (llvmType) {
        const extracted = this.extractInterfaceFromLlvmType(llvmType);
        if (extracted && this.ctx.interfaceStructGenHasInterface(extracted)) return extracted;
      }
      return null;
    }
    if (arg.type === "index_access") {
      const indexAccess = arg as IndexAccessNode;
      const objExpr = indexAccess.object;
      if (objExpr && objExpr.type === "variable") {
        const varObj = objExpr as VariableNode;
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
    if (arg.type === "member_access") {
      const memberAccess = arg as MemberAccessNode;
      const objType = this.resolveInterfaceType(memberAccess.object);
      if (objType && this.ctx.interfaceStructGenHasInterface(objType)) {
        const fieldCount = this.ctx.interfaceStructGenGetFieldCount(objType);
        for (let i = 0; i < fieldCount; i++) {
          const rawName = this.ctx.interfaceStructGenGetFieldName(objType, i);
          const fName =
            rawName.charAt(rawName.length - 1) === "?"
              ? rawName.substring(0, rawName.length - 1)
              : rawName;
          if (fName === memberAccess.property) {
            const fTsType = this.ctx.interfaceStructGenGetFieldTsType(objType, i);
            if (this.ctx.interfaceStructGenHasInterface(fTsType)) return fTsType;
          }
        }
      }
    }
    return null;
  }

  private stringifyInterface(
    arg: Expression,
    params: string[],
    interfaceType: string,
    spaces: number = 0,
  ): string {
    if (!this.ctx.interfaceStructGenHasInterface(interfaceType)) {
      return this.stringifyNumber(arg, params);
    }
    const fieldCount = this.ctx.interfaceStructGenGetFieldCount(interfaceType);
    if (fieldCount === 0) {
      return this.stringifyNumber(arg, params);
    }

    const structType = this.buildStructType(interfaceType, fieldCount);

    const objPtr = this.ctx.generateExpression(arg, params);
    const typedPtr = this.ctx.emitBitcast(objPtr, "i8*", `${structType}*`);

    this.ctx.setUsesJson(true);
    const jsonDoc = this.ctx.emitCall("i8*", "@csyyjson_create_obj", "");
    const jsonObj = this.ctx.emitCall("i8*", "@csyyjson_mut_get_root", `i8* ${jsonDoc}`);

    this.emitAddFieldsToJsonObj(typedPtr, structType, interfaceType, jsonDoc, jsonObj);

    const result = this.emitStringify(jsonDoc, spaces);
    this.ctx.setVariableType(result, "i8*");

    return result;
  }

  /** Build the LLVM struct type string for an interface (e.g. "{ i8*, double }") */
  private buildStructType(interfaceType: string, fieldCount: number): string {
    const fieldTypes: string[] = [];
    for (let i = 0; i < fieldCount; i++) {
      fieldTypes.push(this.ctx.interfaceStructGenGetFieldLlvmType(interfaceType, i));
    }
    return `{ ${fieldTypes.join(", ")} }`;
  }

  /** Emit IR to add all fields of a typed struct to a yyjson object.
   *  Shared by stringifyInterface (single object) and stringifyObjectArray (per-element). */
  private emitAddFieldsToJsonObj(
    typedPtr: string,
    structType: string,
    interfaceType: string,
    jsonDoc: string,
    jsonObj: string,
  ): void {
    const fieldCount = this.ctx.interfaceStructGenGetFieldCount(interfaceType);
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
      } else if (this.ctx.interfaceStructGenHasInterface(fieldTsType)) {
        const nestedPtr = this.ctx.emitLoad("i8*", fieldPtr);
        const nestedFieldCount = this.ctx.interfaceStructGenGetFieldCount(fieldTsType);
        const nestedStructType = this.buildStructType(fieldTsType, nestedFieldCount);
        const nestedTyped = this.ctx.emitBitcast(nestedPtr, "i8*", `${nestedStructType}*`);
        const subObj = this.ctx.emitCall(
          "i8*",
          "@csyyjson_obj_add_obj",
          `i8* ${jsonDoc}, i8* ${jsonObj}, i8* ${nameConst}`,
        );
        this.emitAddFieldsToJsonObj(nestedTyped, nestedStructType, fieldTsType, jsonDoc, subObj);
      } else {
        const val = this.ctx.emitLoad("double", fieldPtr);
        this.ctx.emitCallVoid(
          "@csyyjson_obj_add_num",
          `i8* ${jsonDoc}, i8* ${jsonObj}, i8* ${nameConst}, double ${val}`,
        );
      }
    }
  }

  /** Stringify an ObjectArray (e.g. Post[]) as a JSON array of objects */
  private stringifyObjectArray(
    arg: Expression,
    params: string[],
    elementType: string,
    spaces: number = 0,
  ): string {
    if (!this.ctx.interfaceStructGenHasInterface(elementType)) {
      if (arg.type === "variable") {
        const varName = (arg as VariableNode).name;
        const meta = this.ctx.symbolTable.getObjectArrayMetadata(varName);
        if (meta && meta.elementKeys.length > 0) {
          return stringifyObjectArrayWithMeta(
            this.ctx,
            arg,
            params,
            meta.elementKeys,
            meta.elementTypes,
            meta.elementTsTypes || [],
            spaces,
          );
        }
      }
      return this.stringifyNumber(arg, params);
    }
    const fieldCount = this.ctx.interfaceStructGenGetFieldCount(elementType);
    if (fieldCount === 0) {
      return this.stringifyNumber(arg, params);
    }

    const structType = this.buildStructType(elementType, fieldCount);
    const structSize = fieldCount * 8;

    const arrPtr = this.ctx.generateExpression(arg, params);

    this.ctx.setUsesJson(true);

    // Load ObjectArray length (field 1) and data pointer (field 0)
    const lenPtr = this.ctx.emitGep("%ObjectArray", arrPtr, "i32 0, i32 1");
    const len = this.ctx.emitLoad("i32", lenPtr);
    const dataRawPtr = this.ctx.emitGep("%ObjectArray", arrPtr, "i32 0, i32 0");
    const dataI8 = this.ctx.emitLoad("i8*", dataRawPtr);
    const dataPtr = this.ctx.emitBitcast(dataI8, "i8*", "i8**");

    // Create yyjson array doc
    const jsonDoc = this.ctx.emitCall("i8*", "@csyyjson_create_arr", "");
    const jsonArr = this.ctx.emitCall("i8*", "@csyyjson_mut_get_root", `i8* ${jsonDoc}`);

    // Loop over elements using alloca counter pattern
    const counterAlloca = this.ctx.nextTemp();
    this.ctx.emit(`${counterAlloca} = alloca i32`);
    this.ctx.emitStore("i32", "0", counterAlloca);

    const loopCond = this.ctx.nextLabel("json_arr_loop_cond");
    const loopBody = this.ctx.nextLabel("json_arr_loop_body");
    const loopEnd = this.ctx.nextLabel("json_arr_loop_end");

    this.ctx.emitBr(loopCond);
    this.ctx.emitLabel(loopCond);
    const i = this.ctx.emitLoad("i32", counterAlloca);
    const cond = this.ctx.emitIcmp("slt", "i32", i, len);
    this.ctx.emitBrCond(cond, loopBody, loopEnd);

    this.ctx.emitLabel(loopBody);
    // Load element pointer: dataPtr[i] is an i8*
    const elemSlot = this.ctx.emitGep("i8*", dataPtr, `i32 ${i}`);
    const elemRaw = this.ctx.emitLoad("i8*", elemSlot);
    const elemTyped = this.ctx.emitBitcast(elemRaw, "i8*", `${structType}*`);

    // Create a sub-object in the JSON array
    const subObj = this.ctx.emitCall(
      "i8*",
      "@csyyjson_mut_arr_add_obj",
      `i8* ${jsonDoc}, i8* ${jsonArr}`,
    );

    // Add all fields from this element to the sub-object
    this.emitAddFieldsToJsonObj(elemTyped, structType, elementType, jsonDoc, subObj);

    // Increment counter
    const iNext = this.ctx.nextTemp();
    this.ctx.emit(`${iNext} = add i32 ${i}, 1`);
    this.ctx.emitStore("i32", iNext, counterAlloca);
    this.ctx.emitBr(loopCond);

    this.ctx.emitLabel(loopEnd);

    const result = this.emitStringify(jsonDoc, spaces);
    this.ctx.setVariableType(result, "i8*");

    return result;
  }

  private stringifyStringArray(arg: Expression, params: string[], spaces: number): string {
    this.ctx.setUsesJson(true);
    const arrPtr = this.ctx.generateExpression(arg, params);
    const jsonDoc = this.ctx.emitCall("i8*", "@csyyjson_create_arr", "");
    const jsonArr = this.ctx.emitCall("i8*", "@csyyjson_mut_get_root", `i8* ${jsonDoc}`);

    // Load length (field 1) and data pointer (field 0) from %StringArray
    const lenPtr = this.ctx.emitGep("%StringArray", arrPtr, "i32 0, i32 1");
    const len = this.ctx.emitLoad("i32", lenPtr);
    const dataPtr = this.ctx.emitGep("%StringArray", arrPtr, "i32 0, i32 0");
    const dataRaw = this.ctx.emitLoad("i8**", dataPtr);

    const counterAlloca = this.ctx.nextTemp();
    this.ctx.emit(`${counterAlloca} = alloca i32`);
    this.ctx.emitStore("i32", "0", counterAlloca);

    const loopCond = this.ctx.nextLabel("json_str_arr_cond");
    const loopBody = this.ctx.nextLabel("json_str_arr_body");
    const loopEnd = this.ctx.nextLabel("json_str_arr_end");

    this.ctx.emitBr(loopCond);
    this.ctx.emitLabel(loopCond);
    const i = this.ctx.emitLoad("i32", counterAlloca);
    const cond = this.ctx.emitIcmp("slt", "i32", i, len);
    this.ctx.emitBrCond(cond, loopBody, loopEnd);

    this.ctx.emitLabel(loopBody);
    const elemSlot = this.ctx.emitGep("i8*", dataRaw, `i32 ${i}`);
    const elem = this.ctx.emitLoad("i8*", elemSlot);
    this.ctx.emitCallVoid("@csyyjson_arr_add_str", `i8* ${jsonDoc}, i8* ${jsonArr}, i8* ${elem}`);
    const iNext = this.ctx.nextTemp();
    this.ctx.emit(`${iNext} = add i32 ${i}, 1`);
    this.ctx.emitStore("i32", iNext, counterAlloca);
    this.ctx.emitBr(loopCond);

    this.ctx.emitLabel(loopEnd);
    const result = this.emitStringify(jsonDoc, spaces);
    this.ctx.setVariableType(result, "i8*");
    return result;
  }

  private stringifyNumberArray(arg: Expression, params: string[], spaces: number): string {
    this.ctx.setUsesJson(true);
    const arrPtr = this.ctx.generateExpression(arg, params);
    const jsonDoc = this.ctx.emitCall("i8*", "@csyyjson_create_arr", "");
    const jsonArr = this.ctx.emitCall("i8*", "@csyyjson_mut_get_root", `i8* ${jsonDoc}`);

    // Load length (field 1) and data pointer (field 0) from %Array
    const lenPtr = this.ctx.emitGep("%Array", arrPtr, "i32 0, i32 1");
    const len = this.ctx.emitLoad("i32", lenPtr);
    const dataPtr = this.ctx.emitGep("%Array", arrPtr, "i32 0, i32 0");
    const dataRaw = this.ctx.emitLoad("double*", dataPtr);

    const counterAlloca = this.ctx.nextTemp();
    this.ctx.emit(`${counterAlloca} = alloca i32`);
    this.ctx.emitStore("i32", "0", counterAlloca);

    const loopCond = this.ctx.nextLabel("json_num_arr_cond");
    const loopBody = this.ctx.nextLabel("json_num_arr_body");
    const loopEnd = this.ctx.nextLabel("json_num_arr_end");

    this.ctx.emitBr(loopCond);
    this.ctx.emitLabel(loopCond);
    const i = this.ctx.emitLoad("i32", counterAlloca);
    const cond = this.ctx.emitIcmp("slt", "i32", i, len);
    this.ctx.emitBrCond(cond, loopBody, loopEnd);

    this.ctx.emitLabel(loopBody);
    const elemSlot = this.ctx.emitGep("double", dataRaw, `i32 ${i}`);
    const elem = this.ctx.emitLoad("double", elemSlot);
    this.ctx.emitCallVoid(
      "@csyyjson_arr_add_num",
      `i8* ${jsonDoc}, i8* ${jsonArr}, double ${elem}`,
    );
    const iNext = this.ctx.nextTemp();
    this.ctx.emit(`${iNext} = add i32 ${i}, 1`);
    this.ctx.emitStore("i32", iNext, counterAlloca);
    this.ctx.emitBr(loopCond);

    this.ctx.emitLabel(loopEnd);
    const result = this.emitStringify(jsonDoc, spaces);
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

  private stringifyObjectLiteral(obj: ObjectNode, params: string[], spaces: number): string {
    this.ctx.setUsesJson(true);
    const jsonDoc = this.ctx.emitCall("i8*", "@csyyjson_create_obj", "");
    const jsonObj = this.ctx.emitCall("i8*", "@csyyjson_mut_get_root", `i8* ${jsonDoc}`);
    this.buildJsonProperties(obj, params, jsonDoc, jsonObj);
    const result = this.emitStringify(jsonDoc, spaces);
    this.ctx.setVariableType(result, "i8*");
    return result;
  }

  private buildJsonProperties(
    obj: ObjectNode,
    params: string[],
    jsonDoc: string,
    jsonObj: string,
  ): void {
    for (let i = 0; i < obj.properties.length; i++) {
      const prop = obj.properties[i];
      const nameConst = this.ctx.createStringConstant(prop.key);

      if (prop.value.type === "object") {
        const childObj = this.ctx.emitCall(
          "i8*",
          "@csyyjson_obj_add_obj",
          `i8* ${jsonDoc}, i8* ${jsonObj}, i8* ${nameConst}`,
        );
        this.buildJsonProperties(prop.value as ObjectNode, params, jsonDoc, childObj);
      } else if (prop.value.type === "boolean") {
        const val = this.ctx.generateExpression(prop.value, params);
        const boolI32 = this.ctx.nextTemp();
        this.ctx.emit(`${boolI32} = trunc i64 ${val} to i32`);
        this.ctx.emitCallVoid(
          "@csyyjson_obj_add_bool",
          `i8* ${jsonDoc}, i8* ${jsonObj}, i8* ${nameConst}, i32 ${boolI32}`,
        );
      } else if (this.ctx.isStringExpression(prop.value)) {
        const val = this.ctx.generateExpression(prop.value, params);
        this.ctx.emitCallVoid(
          "@csyyjson_obj_add_str",
          `i8* ${jsonDoc}, i8* ${jsonObj}, i8* ${nameConst}, i8* ${val}`,
        );
      } else {
        const val = this.ctx.generateExpression(prop.value, params);
        const vt = this.ctx.getVariableType(val);
        if (vt === "i8*") {
          this.ctx.emitCallVoid(
            "@csyyjson_obj_add_str",
            `i8* ${jsonDoc}, i8* ${jsonObj}, i8* ${nameConst}, i8* ${val}`,
          );
        } else if (vt === "i1") {
          const boolI32 = this.ctx.nextTemp();
          this.ctx.emit(`${boolI32} = zext i1 ${val} to i32`);
          this.ctx.emitCallVoid(
            "@csyyjson_obj_add_bool",
            `i8* ${jsonDoc}, i8* ${jsonObj}, i8* ${nameConst}, i32 ${boolI32}`,
          );
        } else {
          const dbl = this.ctx.ensureDouble(val);
          this.ctx.emitCallVoid(
            "@csyyjson_obj_add_num",
            `i8* ${jsonDoc}, i8* ${jsonObj}, i8* ${nameConst}, double ${dbl}`,
          );
        }
      }
    }
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

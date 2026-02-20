import { MemberAccessNode, InterfaceDeclaration, VariableNode } from "../../../ast/types.js";
import { stripOptional, stripNullable, tsTypeToLlvm } from "../../infrastructure/type-system.js";
import type { MemberAccessGeneratorContext } from "./member.js";

interface ExprBase {
  type: string;
}

function hasObjectInfoChained(ctx: MemberAccessGeneratorContext, name: string): boolean {
  if (!ctx.symbolTable.isObject(name) && !ctx.symbolTable.isJSON(name)) return false;
  return ctx.symbolTable.getObjectMetadataKeys(name) !== undefined;
}

function getInterfaceDeclForChained(
  ctx: MemberAccessGeneratorContext,
  name: string,
): InterfaceDeclaration | null {
  return ctx.getInterfaceDeclByName(name);
}

export function handleNestedInterfaceField(
  ctx: MemberAccessGeneratorContext,
  fieldItem: string,
  tsType: string,
): string {
  const baseType = stripNullable(tsType);
  const nestedInterfaceDefResult = getInterfaceDeclForChained(ctx, baseType);
  const nestedInterfaceDef = nestedInterfaceDefResult as InterfaceDeclaration;
  if (nestedInterfaceDefResult) {
    const keys: string[] = [];
    const tsTypes: string[] = [];
    const types: string[] = [];
    if (nestedInterfaceDef.fields) {
      for (let i = 0; i < nestedInterfaceDef.fields.length; i++) {
        const f = nestedInterfaceDef.fields[i] as { name: string; type: string };
        keys.push(stripOptional(f.name));
        tsTypes.push(f.type);
        types.push(tsTypeToLlvm(f.type));
      }
    }
    ctx.setJsonObjectMetadata(fieldItem, { keys, types, tsTypes, interfaceType: undefined });
  }
  ctx.setVariableType(fieldItem, "i8*");
  return fieldItem;
}

export function extractJsonFieldValue(
  ctx: MemberAccessGeneratorContext,
  fieldItem: string,
): string {
  const fieldExists = ctx.nextTemp();
  ctx.emit(`${fieldExists} = icmp ne i8* ${fieldItem}, null`);

  const hasFieldLabel = ctx.nextLabel("json_has_field");
  const noFieldLabel = ctx.nextLabel("json_no_field");
  const fieldEndLabel = ctx.nextLabel("json_field_end");

  ctx.emit(`br i1 ${fieldExists}, label %${hasFieldLabel}, label %${noFieldLabel}`);
  ctx.emit(`${hasFieldLabel}:`);

  const isNumber = ctx.nextTemp();
  ctx.emit(`${isNumber} = call i32 @csyyjson_is_num(i8* ${fieldItem})`);
  const isNumBool = ctx.nextTemp();
  ctx.emit(`${isNumBool} = icmp ne i32 ${isNumber}, 0`);

  const numberLabel = ctx.nextLabel("json_number");
  const stringLabel = ctx.nextLabel("json_string");

  ctx.emit(`br i1 ${isNumBool}, label %${numberLabel}, label %${stringLabel}`);

  ctx.emit(`${numberLabel}:`);
  const numValueDouble = ctx.nextTemp();
  ctx.emit(`${numValueDouble} = call double @csyyjson_get_num(i8* ${fieldItem})`);
  const numAsStr = ctx.nextTemp();
  ctx.emit(`${numAsStr} = call i8* @__double_to_string(double ${numValueDouble})`);
  ctx.emit(`br label %${fieldEndLabel}`);

  ctx.emit(`${stringLabel}:`);
  const strValue = ctx.nextTemp();
  ctx.emit(`${strValue} = call i8* @csyyjson_get_str(i8* ${fieldItem})`);
  ctx.emit(`br label %${fieldEndLabel}`);

  ctx.emit(`${noFieldLabel}:`);
  ctx.emit(`br label %${fieldEndLabel}`);

  ctx.emit(`${fieldEndLabel}:`);
  const result = ctx.nextTemp();
  ctx.emit(
    `${result} = phi i8* [ ${numAsStr}, %${numberLabel} ], [ ${strValue}, %${stringLabel} ], [ null, %${noFieldLabel} ]`,
  );

  ctx.setVariableType(result, "i8*");
  return result;
}

export function extractNestedJsonFieldValue(
  ctx: MemberAccessGeneratorContext,
  fieldItem: string,
): string {
  const isNumber = ctx.nextTemp();
  ctx.emit(`${isNumber} = call i32 @csyyjson_is_num(i8* ${fieldItem})`);
  const isNumBool = ctx.nextTemp();
  ctx.emit(`${isNumBool} = icmp ne i32 ${isNumber}, 0`);

  const numberLabel = ctx.nextLabel("json_number");
  const stringLabel = ctx.nextLabel("json_string");
  const fieldEndLabel = ctx.nextLabel("json_field_end");

  ctx.emit(`br i1 ${isNumBool}, label %${numberLabel}, label %${stringLabel}`);

  ctx.emit(`${numberLabel}:`);
  const numValueDouble = ctx.nextTemp();
  ctx.emit(`${numValueDouble} = call double @csyyjson_get_num(i8* ${fieldItem})`);
  const numAsStr = ctx.nextTemp();
  ctx.emit(`${numAsStr} = call i8* @__double_to_string(double ${numValueDouble})`);
  ctx.emit(`br label %${fieldEndLabel}`);

  ctx.emit(`${stringLabel}:`);
  const strValue = ctx.nextTemp();
  ctx.emit(`${strValue} = call i8* @csyyjson_get_str(i8* ${fieldItem})`);
  ctx.emit(`br label %${fieldEndLabel}`);

  ctx.emit(`${fieldEndLabel}:`);
  const result = ctx.nextTemp();
  ctx.emit(
    `${result} = phi i8* [ ${numAsStr}, %${numberLabel} ], [ ${strValue}, %${stringLabel} ]`,
  );

  ctx.setVariableType(result, "i8*");
  return result;
}

export function handleJsonPropertyAccess(
  ctx: MemberAccessGeneratorContext,
  expr: MemberAccessNode,
  _params: string[],
): string {
  const varName = (expr.object as VariableNode).name;
  ctx.setUsesJson(true);

  if (expr.property === "length") {
    const jsonObjPtrPtr = ctx.getVariableAlloca(varName)!;
    const jsonObjPtr = ctx.nextTemp();
    ctx.emit(`${jsonObjPtr} = load i8*, i8** ${jsonObjPtrPtr}`);
    const arraySize = ctx.nextTemp();
    ctx.emit(`${arraySize} = call i32 @csyyjson_arr_size(i8* ${jsonObjPtr})`);
    const sizeDouble = ctx.nextTemp();
    ctx.emit(`${sizeDouble} = sitofp i32 ${arraySize} to double`);
    ctx.setVariableType(sizeDouble, "double");
    return sizeDouble;
  }

  let tsType: string | undefined;
  if (hasObjectInfoChained(ctx, varName)) {
    const tsTypesArr = ctx.symbolTable.getObjectMetadataTsTypes(varName);
    const keysArr = ctx.symbolTable.getObjectMetadataKeys(varName);
    if (tsTypesArr && keysArr) {
      const propIdx = keysArr.indexOf(expr.property);
      if (propIdx !== -1) {
        tsType = tsTypesArr[propIdx];
      }
    }
  }

  const jsonObjPtrPtr = ctx.getVariableAlloca(varName)!;
  const jsonObjPtr = ctx.nextTemp();
  ctx.emit(`${jsonObjPtr} = load i8*, i8** ${jsonObjPtrPtr}`);

  const fieldNameStr = ctx.stringGen.doCreateStringConstant(expr.property);

  const fieldItem = ctx.nextTemp();
  ctx.emit(`${fieldItem} = call i8* @csyyjson_obj_get(i8* ${jsonObjPtr}, i8* ${fieldNameStr})`);

  if (
    tsType &&
    ["string", "number", "boolean", "string[]", "number[]", "boolean[]"].indexOf(tsType) === -1
  ) {
    return handleNestedInterfaceField(ctx, fieldItem, tsType);
  }

  if (tsType === "string") {
    const strValue = ctx.nextTemp();
    ctx.emit(`${strValue} = call i8* @csyyjson_get_str(i8* ${fieldItem})`);
    ctx.setVariableType(strValue, "i8*");
    return strValue;
  } else if (tsType === "number") {
    const numValue = ctx.nextTemp();
    ctx.emit(`${numValue} = call double @csyyjson_get_num(i8* ${fieldItem})`);
    ctx.setVariableType(numValue, "double");
    return numValue;
  } else if (tsType === "boolean") {
    const boolValue = ctx.nextTemp();
    ctx.emit(`${boolValue} = call i32 @csyyjson_is_true(i8* ${fieldItem})`);
    const boolAsDouble = ctx.nextTemp();
    ctx.emit(`${boolAsDouble} = sitofp i32 ${boolValue} to double`);
    ctx.setVariableType(boolAsDouble, "double");
    return boolAsDouble;
  } else if (tsType === "string[]" || tsType === "number[]" || tsType === "boolean[]") {
    ctx.setVariableType(fieldItem, "i8*");
    return fieldItem;
  }

  return extractJsonFieldValue(ctx, fieldItem);
}

export function handleNestedJsonAccess(
  ctx: MemberAccessGeneratorContext,
  expr: MemberAccessNode,
  params: string[],
): string | null {
  if (expr.property === "length") return null;

  const innerResult = ctx.generateExpression(expr.object, params);

  const innerType = ctx.getVariableType(innerResult);
  if (innerType === "%Array*" || innerType === "%StringArray*" || innerType === "%ObjectArray*") {
    return null;
  }
  if (
    innerType &&
    innerType.startsWith("%") &&
    innerType.endsWith("*") &&
    innerType !== "%__FetchResponse*" &&
    innerType.indexOf("Map") === -1 &&
    innerType.indexOf("Set") === -1
  ) {
    return null;
  }

  if (!ctx.hasJsonObjectMetadata(innerResult)) return null;
  const nestedMetaKeys = ctx.getJsonObjectMetadataKeys(innerResult);
  const nestedMetaTsTypes = ctx.getJsonObjectMetadataTsTypes(innerResult);
  if (!nestedMetaKeys) return null;

  ctx.setUsesJson(true);
  const fieldNameStr = ctx.stringGen.doCreateStringConstant(expr.property);
  const fieldItem = ctx.nextTemp();
  ctx.emit(`${fieldItem} = call i8* @csyyjson_obj_get(i8* ${innerResult}, i8* ${fieldNameStr})`);

  const propIdx = nestedMetaKeys.indexOf(expr.property);
  let tsType: string | undefined;
  if (propIdx !== -1 && nestedMetaTsTypes) {
    tsType = nestedMetaTsTypes[propIdx];
  }

  if (
    tsType &&
    ["string", "number", "boolean", "string[]", "number[]", "boolean[]"].indexOf(tsType) === -1
  ) {
    return handleNestedInterfaceField(ctx, fieldItem, tsType);
  }

  if (tsType === "string") {
    const strValue = ctx.nextTemp();
    ctx.emit(`${strValue} = call i8* @csyyjson_get_str(i8* ${fieldItem})`);
    ctx.setVariableType(strValue, "i8*");
    return strValue;
  } else if (tsType === "number") {
    const numValue = ctx.nextTemp();
    ctx.emit(`${numValue} = call double @csyyjson_get_num(i8* ${fieldItem})`);
    ctx.setVariableType(numValue, "double");
    return numValue;
  } else if (tsType === "boolean") {
    const boolValue = ctx.nextTemp();
    ctx.emit(`${boolValue} = call i32 @csyyjson_is_true(i8* ${fieldItem})`);
    const boolAsDouble = ctx.nextTemp();
    ctx.emit(`${boolAsDouble} = sitofp i32 ${boolValue} to double`);
    ctx.setVariableType(boolAsDouble, "double");
    return boolAsDouble;
  } else if (tsType === "string[]" || tsType === "number[]" || tsType === "boolean[]") {
    ctx.setVariableType(fieldItem, "i8*");
    return fieldItem;
  }

  return extractNestedJsonFieldValue(ctx, fieldItem);
}

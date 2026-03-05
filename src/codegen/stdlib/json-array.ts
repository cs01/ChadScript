import { Expression, ArrayNode, ObjectNode } from "../../ast/types.js";
import { IGeneratorContext } from "../infrastructure/generator-context.js";

interface ExprBase {
  type: string;
}

function buildObjectProperties(
  ctx: IGeneratorContext,
  obj: ObjectNode,
  params: string[],
  jsonDoc: string,
  jsonObj: string,
): void {
  for (let i = 0; i < obj.properties.length; i++) {
    const prop = obj.properties[i];
    const nameConst = ctx.createStringConstant(prop.key);

    if (prop.value.type === "object") {
      const childObj = ctx.emitCall(
        "i8*",
        "@csyyjson_obj_add_obj",
        `i8* ${jsonDoc}, i8* ${jsonObj}, i8* ${nameConst}`,
      );
      buildObjectProperties(ctx, prop.value as unknown as ObjectNode, params, jsonDoc, childObj);
    } else if (prop.value.type === "boolean") {
      const val = ctx.generateExpression(prop.value, params);
      const boolI32 = ctx.nextTemp();
      ctx.emit(`${boolI32} = trunc i64 ${val} to i32`);
      ctx.emitCallVoid(
        "@csyyjson_obj_add_bool",
        `i8* ${jsonDoc}, i8* ${jsonObj}, i8* ${nameConst}, i32 ${boolI32}`,
      );
    } else if (ctx.isStringExpression(prop.value)) {
      const val = ctx.generateExpression(prop.value, params);
      ctx.emitCallVoid(
        "@csyyjson_obj_add_str",
        `i8* ${jsonDoc}, i8* ${jsonObj}, i8* ${nameConst}, i8* ${val}`,
      );
    } else {
      const val = ctx.generateExpression(prop.value, params);
      const vt = ctx.getVariableType(val);
      if (vt === "i8*") {
        ctx.emitCallVoid(
          "@csyyjson_obj_add_str",
          `i8* ${jsonDoc}, i8* ${jsonObj}, i8* ${nameConst}, i8* ${val}`,
        );
      } else if (vt === "i1") {
        const boolI32 = ctx.nextTemp();
        ctx.emit(`${boolI32} = zext i1 ${val} to i32`);
        ctx.emitCallVoid(
          "@csyyjson_obj_add_bool",
          `i8* ${jsonDoc}, i8* ${jsonObj}, i8* ${nameConst}, i32 ${boolI32}`,
        );
      } else {
        const dbl = ctx.ensureDouble(val);
        ctx.emitCallVoid(
          "@csyyjson_obj_add_num",
          `i8* ${jsonDoc}, i8* ${jsonObj}, i8* ${nameConst}, double ${dbl}`,
        );
      }
    }
  }
}

function emitStringify(ctx: IGeneratorContext, jsonDoc: string, spaces: number): string {
  if (spaces > 0) {
    return ctx.emitCall(
      "i8*",
      "@csyyjson_stringify_pretty",
      `i8* ${jsonDoc}, i32 ${spaces === 2 ? "2" : "4"}`,
    );
  }
  return ctx.emitCall("i8*", "@csyyjson_stringify", `i8* ${jsonDoc}`);
}

export function stringifyObjectArrayLiteral(
  ctx: IGeneratorContext,
  arrayExpr: ArrayNode,
  params: string[],
  spaces: number,
): string {
  ctx.setUsesJson(true);
  const jsonDoc = ctx.emitCall("i8*", "@csyyjson_create_arr", "");
  const jsonArr = ctx.emitCall("i8*", "@csyyjson_mut_get_root", `i8* ${jsonDoc}`);

  for (let i = 0; i < arrayExpr.elements.length; i++) {
    const elem = arrayExpr.elements[i];
    const elemBase = elem as ExprBase;
    if (elemBase.type === "object") {
      const subObj = ctx.emitCall(
        "i8*",
        "@csyyjson_mut_arr_add_obj",
        `i8* ${jsonDoc}, i8* ${jsonArr}`,
      );
      buildObjectProperties(ctx, elem as unknown as ObjectNode, params, jsonDoc, subObj);
    }
  }

  const result = emitStringify(ctx, jsonDoc, spaces);
  ctx.setVariableType(result, "i8*");
  return result;
}

export function stringifyObjectArrayWithMeta(
  ctx: IGeneratorContext,
  arg: Expression,
  params: string[],
  elementKeys: string[],
  elementTypes: string[],
  elementTsTypes: string[],
  spaces: number,
): string {
  const fieldCount = elementKeys.length;
  const structType = `{ ${elementTypes.join(", ")} }`;

  const arrPtr = ctx.generateExpression(arg, params);
  ctx.setUsesJson(true);

  const lenPtr = ctx.emitGep("%ObjectArray", arrPtr, "i32 0, i32 1");
  const len = ctx.emitLoad("i32", lenPtr);
  const dataRawPtr = ctx.emitGep("%ObjectArray", arrPtr, "i32 0, i32 0");
  const dataI8 = ctx.emitLoad("i8*", dataRawPtr);
  const dataPtr = ctx.emitBitcast(dataI8, "i8*", "i8**");

  const jsonDoc = ctx.emitCall("i8*", "@csyyjson_create_arr", "");
  const jsonArr = ctx.emitCall("i8*", "@csyyjson_mut_get_root", `i8* ${jsonDoc}`);

  const counterAlloca = ctx.nextTemp();
  ctx.emit(`${counterAlloca} = alloca i32`);
  ctx.emitStore("i32", "0", counterAlloca);

  const loopCond = ctx.nextLabel("json_meta_arr_cond");
  const loopBody = ctx.nextLabel("json_meta_arr_body");
  const loopEnd = ctx.nextLabel("json_meta_arr_end");

  ctx.emitBr(loopCond);
  ctx.emitLabel(loopCond);
  const i = ctx.emitLoad("i32", counterAlloca);
  const cond = ctx.emitIcmp("slt", "i32", i, len);
  ctx.emitBrCond(cond, loopBody, loopEnd);

  ctx.emitLabel(loopBody);
  const elemSlot = ctx.emitGep("i8*", dataPtr, `i32 ${i}`);
  const elemRaw = ctx.emitLoad("i8*", elemSlot);
  const elemTyped = ctx.emitBitcast(elemRaw, "i8*", `${structType}*`);

  const subObj = ctx.emitCall("i8*", "@csyyjson_mut_arr_add_obj", `i8* ${jsonDoc}, i8* ${jsonArr}`);

  for (let fi = 0; fi < fieldCount; fi++) {
    const fieldPtr = ctx.nextTemp();
    ctx.emit(
      `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${elemTyped}, i32 0, i32 ${fi}`,
    );
    const nameConst = ctx.createStringConstant(elementKeys[fi]);
    const tsType = elementTsTypes[fi] || "string";
    if (tsType === "string") {
      const val = ctx.emitLoad("i8*", fieldPtr);
      ctx.emitCallVoid(
        "@csyyjson_obj_add_str",
        `i8* ${jsonDoc}, i8* ${subObj}, i8* ${nameConst}, i8* ${val}`,
      );
    } else if (tsType === "boolean") {
      const val = ctx.emitLoad("double", fieldPtr);
      const boolInt = ctx.nextTemp();
      ctx.emit(`${boolInt} = fptosi double ${val} to i32`);
      ctx.emitCallVoid(
        "@csyyjson_obj_add_bool",
        `i8* ${jsonDoc}, i8* ${subObj}, i8* ${nameConst}, i32 ${boolInt}`,
      );
    } else {
      const val = ctx.emitLoad("double", fieldPtr);
      ctx.emitCallVoid(
        "@csyyjson_obj_add_num",
        `i8* ${jsonDoc}, i8* ${subObj}, i8* ${nameConst}, double ${val}`,
      );
    }
  }

  const iNext = ctx.nextTemp();
  ctx.emit(`${iNext} = add i32 ${i}, 1`);
  ctx.emitStore("i32", iNext, counterAlloca);
  ctx.emitBr(loopCond);

  ctx.emitLabel(loopEnd);
  const result = emitStringify(ctx, jsonDoc, spaces);
  ctx.setVariableType(result, "i8*");
  return result;
}

import {
  Expression,
  ArrayNode,
  VariableNode,
  MethodCallNode,
  CallNode,
} from "../../../../ast/types.js";
import { IGeneratorContext } from "./context.js";

/**
 * Array literal generation
 * Handles creation of numeric, string, and pointer arrays
 */
export function generateArrayLiteral(
  gen: IGeneratorContext,
  expr: Expression,
  params: string[],
): string {
  const e = expr as { type: string };
  if (e.type !== "array") {
    return gen.emitError("Expected array literal");
  }

  const arrExpr = expr as ArrayNode;
  const length = arrExpr.elements.length;

  // Determine if this is a string array:
  // 1. All elements are strings, OR
  // 2. Empty array with expectedArrayElementType='string' from context
  let isStringArray = false;
  if (length > 0) {
    let allStrings = true;
    for (let i = 0; i < arrExpr.elements.length; i++) {
      const el = arrExpr.elements[i] as { type: string };
      if (el.type !== "string") {
        allStrings = false;
        break;
      }
    }
    isStringArray = allStrings;
  }
  if (length === 0 && gen.getExpectedArrayElementType() === "string") {
    isStringArray = true;
  }

  let isPointerArray = false;
  if (length === 0 && gen.getExpectedArrayElementType() === "pointer") {
    isPointerArray = true;
  }
  let firstElemValue: string | null = null;
  if (length > 0 && !isStringArray) {
    firstElemValue = gen.generateExpression(arrExpr.elements[0], params);
    const firstElemType = gen.getVariableType(firstElemValue);
    if (firstElemType === "i8*") {
      isStringArray = true;
    } else if (firstElemType && firstElemType !== "double" && firstElemType.indexOf("*") !== -1) {
      isPointerArray = true;
    }
    if (!isPointerArray && !isStringArray) {
      for (let i = 0; i < arrExpr.elements.length; i++) {
        const elem = arrExpr.elements[i];
        const el = elem as { type: string };
        if (el.type === "variable") {
          const varExpr = elem as VariableNode;
          const varName = varExpr.name;
          const varType = gen.getVariableType(varName);
          if (varType && (varType.indexOf("%Promise") !== -1 || varType.indexOf("*") !== -1)) {
            isPointerArray = true;
            break;
          }
        }
        if (el.type === "method_call") {
          const mcExpr = elem as MethodCallNode;
          const obj = mcExpr.object;
          const objBase = obj as { type: string };
          if (obj && objBase.type === "variable") {
            const objVar = obj as VariableNode;
            if (objVar.name === "Promise") {
              isPointerArray = true;
              break;
            }
          }
        }
        if (el.type === "call") {
          const callExpr = elem as CallNode;
          const callName = callExpr.name;
          if (callName === "fetch") {
            isPointerArray = true;
            break;
          }
        }
      }
    }
  }

  if (isStringArray) {
    // Generate string array - allocate on HEAP, not stack
    // Compute sizeof(%StringArray) dynamically for portability
    const sizePtr = gen.nextTemp();
    gen.emit(`${sizePtr} = getelementptr %StringArray, %StringArray* null, i32 1`);
    const structSize = gen.nextTemp();
    gen.emit(`${structSize} = ptrtoint %StringArray* ${sizePtr} to i64`);
    const arrayMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
    const arrayPtr = gen.emitBitcast(arrayMem, "i8*", "%StringArray*");

    // Allocate data array on heap (i8** with length elements)
    // GC_malloc for pointer array (GC needs to scan for string pointers)
    const dataCount = length === 0 ? 1 : length; // Allocate at least 1 element
    const dataSize = gen.nextTemp();
    gen.emit(`${dataSize} = mul i64 ${dataCount}, 8`);
    const dataMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);
    const dataPtr = gen.emitBitcast(dataMem, "i8*", "i8**");

    // Store each string element
    for (let i = 0; i < arrExpr.elements.length; i++) {
      const elemValue = gen.generateExpression(arrExpr.elements[i], params);
      const elemPtr = gen.nextTemp();
      gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
      gen.emitStore("i8*", elemValue, elemPtr);
    }

    // Store data pointer in array struct (field 0)
    const dataPtrField = gen.nextTemp();
    gen.emit(
      `${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
    );
    gen.emitStore("i8**", dataPtr, dataPtrField);

    // Store length in array struct (field 1)
    const lenField = gen.nextTemp();
    gen.emit(
      `${lenField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`,
    );
    gen.emitStore("i32", `${length}`, lenField);

    // Store capacity in array struct (field 2)
    const capField = gen.nextTemp();
    gen.emit(
      `${capField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`,
    );
    gen.emitStore("i32", `${length}`, capField);

    gen.setVariableType(arrayPtr, "%StringArray*");
    return arrayPtr;
  } else if (isPointerArray) {
    // Generate pointer/object array - uses %ObjectArray with i8* data
    const sizePtr = gen.nextTemp();
    gen.emit(`${sizePtr} = getelementptr %ObjectArray, %ObjectArray* null, i32 1`);
    const structSize = gen.nextTemp();
    gen.emit(`${structSize} = ptrtoint %ObjectArray* ${sizePtr} to i64`);
    const arrayMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
    const arrayPtr = gen.emitBitcast(arrayMem, "i8*", "%ObjectArray*");

    // Allocate data array on heap (i8* cast to i8** for pointer storage)
    const dataCount = length === 0 ? 1 : length;
    const dataSize = gen.nextTemp();
    gen.emit(`${dataSize} = mul i64 ${dataCount}, 8`);
    const dataMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${dataSize}`);
    const dataPtr = gen.emitBitcast(dataMem, "i8*", "i8**");

    // Store each pointer element
    for (let i = 0; i < arrExpr.elements.length; i++) {
      const elemValue =
        i === 0 && firstElemValue
          ? firstElemValue
          : gen.generateExpression(arrExpr.elements[i], params);
      const elemCast = gen.emitBitcast(elemValue, gen.getVariableType(elemValue) || "i8*", "i8*");
      const elemPtr = gen.nextTemp();
      gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
      gen.emitStore("i8*", elemCast, elemPtr);
    }

    // Store data pointer in array struct (field 0) - cast i8** to i8*
    const dataPtrField = gen.nextTemp();
    gen.emit(
      `${dataPtrField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
    );
    const dataPtrCast = gen.emitBitcast(dataPtr, "i8**", "i8*");
    gen.emitStore("i8*", dataPtrCast, dataPtrField);

    // Store length in array struct (field 1)
    const lenField = gen.nextTemp();
    gen.emit(
      `${lenField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 1`,
    );
    gen.emitStore("i32", `${length}`, lenField);

    // Store capacity in array struct (field 2)
    const capField = gen.nextTemp();
    gen.emit(
      `${capField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 2`,
    );
    gen.emitStore("i32", `${length}`, capField);

    gen.setVariableType(arrayPtr, "%ObjectArray*");
    return arrayPtr;
  } else {
    // Generate numeric array - allocate on HEAP, not stack
    // Compute sizeof(%Array) dynamically for portability
    const sizePtr = gen.nextTemp();
    gen.emit(`${sizePtr} = getelementptr %Array, %Array* null, i32 1`);
    const structSize = gen.nextTemp();
    gen.emit(`${structSize} = ptrtoint %Array* ${sizePtr} to i64`);
    const arrayMem = gen.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
    const arrayPtr = gen.emitBitcast(arrayMem, "i8*", "%Array*");

    // Allocate data array on heap (double* with length elements)
    // GC_malloc_atomic for numeric array (no pointers inside)
    const dataCount = length === 0 ? 1 : length; // Allocate at least 1 element
    const dataSize = gen.nextTemp();
    gen.emit(`${dataSize} = mul i64 ${dataCount}, 8`);
    const dataMem = gen.emitCall("i8*", "@cs_arena_alloc", `i64 ${dataSize}`);
    const dataPtr = gen.emitBitcast(dataMem, "i8*", "double*");

    // Store each element
    for (let i = 0; i < arrExpr.elements.length; i++) {
      const elemValue =
        i === 0 && firstElemValue
          ? firstElemValue
          : gen.generateExpression(arrExpr.elements[i], params);
      const dblElem = gen.ensureDouble(elemValue);
      const elemPtr = gen.nextTemp();
      gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${i}`);
      gen.emitStore("double", dblElem, elemPtr);
    }

    // Store data pointer in array struct (field 0)
    const dataPtrField = gen.nextTemp();
    gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    gen.emitStore("double*", dataPtr, dataPtrField);

    // Store length in array struct (field 1)
    const lenField = gen.nextTemp();
    gen.emit(`${lenField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    gen.emitStore("i32", `${length}`, lenField);

    // Store capacity in array struct (field 2)
    const capField = gen.nextTemp();
    gen.emit(`${capField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
    gen.emitStore("i32", `${length}`, capField);

    gen.setVariableType(arrayPtr, "%Array*");
    return arrayPtr;
  }
}

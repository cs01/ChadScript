import { Expression } from '../../../../ast/types.js';

interface ExprBase { type: string; }
interface ArrayExpr { type: string; elements: Expression[]; }
interface VariableExpr { type: string; name: string; }
interface MethodCallExpr { type: string; object: Expression; method: string; }
interface CallExpr { type: string; name: string; }

interface ArrayLiteralContext {
  nextTemp(): string;
  emit(instruction: string): void;
  getVariableType(name: string): string | undefined;
  setVariableType(name: string, type: string): void;
  generateExpression(expr: Expression, params: string[]): string;
  expectedArrayElementType: string | null;
}

/**
 * Array literal generation
 * Handles creation of numeric, string, and pointer arrays
 */
export function generateArrayLiteral(
  gen: ArrayLiteralContext,
  expr: Expression,
  params: string[]
): string {
  const e = expr as ExprBase;
  if (e.type !== 'array') {
    throw new Error('Expected array literal');
  }

  const arrExpr = expr as ArrayExpr;
  const length = arrExpr.elements.length;

  // Determine if this is a string array:
  // 1. All elements are strings, OR
  // 2. Empty array with expectedArrayElementType='string' from context
  let isStringArray = false;
  if (length > 0) {
    let allStrings = true;
    for (let i = 0; i < arrExpr.elements.length; i++) {
      const el = arrExpr.elements[i] as ExprBase;
      if (el.type !== 'string') {
        allStrings = false;
        break;
      }
    }
    isStringArray = allStrings;
  }
  if (length === 0 && gen.expectedArrayElementType === 'string') {
    isStringArray = true;
  }

  let isPointerArray = false;
  if (length === 0 && gen.expectedArrayElementType === 'pointer') {
    isPointerArray = true;
  }
  let firstElemValue: string | null = null;
  if (length > 0 && !isStringArray) {
    firstElemValue = gen.generateExpression(arrExpr.elements[0], params);
    const firstElemType = gen.getVariableType(firstElemValue);
    if (firstElemType === 'i8*') {
      isStringArray = true;
    } else if (firstElemType && firstElemType !== 'double' && firstElemType.indexOf('*') !== -1) {
      isPointerArray = true;
    }
    if (!isPointerArray && !isStringArray) {
      for (let i = 0; i < arrExpr.elements.length; i++) {
        const elem = arrExpr.elements[i];
        const el = elem as ExprBase;
        if (el.type === 'variable') {
          const varExpr = elem as VariableExpr;
          const varName = varExpr.name;
          const varType = gen.getVariableType(varName);
          if (varType && (varType.indexOf('%Promise') !== -1 || varType.indexOf('*') !== -1)) {
            isPointerArray = true;
            break;
          }
        }
        if (el.type === 'method_call') {
          const mcExpr = elem as MethodCallExpr;
          const obj = mcExpr.object;
          const objBase = obj as ExprBase;
          if (obj && objBase.type === 'variable') {
            const objVar = obj as VariableExpr;
            if (objVar.name === 'Promise') {
              isPointerArray = true;
              break;
            }
          }
        }
        if (el.type === 'call') {
          const callExpr = elem as CallExpr;
          const callName = callExpr.name;
          if (callName === 'fetch') {
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
    const arrayMem = gen.nextTemp();
    gen.emit(`${arrayMem} = call i8* @GC_malloc(i64 ${structSize})`);
    const arrayPtr = gen.nextTemp();
    gen.emit(`${arrayPtr} = bitcast i8* ${arrayMem} to %StringArray*`);

    // Allocate data array on heap (i8** with length elements)
    // GC_malloc for pointer array (GC needs to scan for string pointers)
    const dataCount = length === 0 ? 1 : length; // Allocate at least 1 element
    const dataSize = gen.nextTemp();
    gen.emit(`${dataSize} = mul i64 ${dataCount}, 8`);
    const dataMem = gen.nextTemp();
    gen.emit(`${dataMem} = call i8* @GC_malloc(i64 ${dataSize})`); // GC_malloc for pointer array
    const dataPtr = gen.nextTemp();
    gen.emit(`${dataPtr} = bitcast i8* ${dataMem} to i8**`);

    // Store each string element
    for (let i = 0; i < arrExpr.elements.length; i++) {
      const elemValue = gen.generateExpression(arrExpr.elements[i], params);
      const elemPtr = gen.nextTemp();
      gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
      gen.emit(`store i8* ${elemValue}, i8** ${elemPtr}`);
    }

    // Store data pointer in array struct (field 0)
    const dataPtrField = gen.nextTemp();
    gen.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    gen.emit(`store i8** ${dataPtr}, i8*** ${dataPtrField}`);

    // Store length in array struct (field 1)
    const lenField = gen.nextTemp();
    gen.emit(`${lenField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
    gen.emit(`store i32 ${length}, i32* ${lenField}`);

    // Store capacity in array struct (field 2)
    const capField = gen.nextTemp();
    gen.emit(`${capField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`);
    gen.emit(`store i32 ${length}, i32* ${capField}`);

    gen.setVariableType(arrayPtr, '%StringArray*');
    return arrayPtr;
  } else if (isPointerArray) {
    // Generate pointer array (for Expression[], Promise[], etc.) - uses %StringArray with i8** data
    const sizePtr = gen.nextTemp();
    gen.emit(`${sizePtr} = getelementptr %StringArray, %StringArray* null, i32 1`);
    const structSize = gen.nextTemp();
    gen.emit(`${structSize} = ptrtoint %StringArray* ${sizePtr} to i64`);
    const arrayMem = gen.nextTemp();
    gen.emit(`${arrayMem} = call i8* @GC_malloc(i64 ${structSize})`);
    const arrayPtr = gen.nextTemp();
    gen.emit(`${arrayPtr} = bitcast i8* ${arrayMem} to %StringArray*`);

    // Allocate data array on heap (i8** for pointers)
    const dataCount = length === 0 ? 1 : length;
    const dataSize = gen.nextTemp();
    gen.emit(`${dataSize} = mul i64 ${dataCount}, 8`);
    const dataMem = gen.nextTemp();
    gen.emit(`${dataMem} = call i8* @GC_malloc(i64 ${dataSize})`);
    const dataPtr = gen.nextTemp();
    gen.emit(`${dataPtr} = bitcast i8* ${dataMem} to i8**`);

    // Store each pointer element
    for (let i = 0; i < arrExpr.elements.length; i++) {
      const elemValue = (i === 0 && firstElemValue) ? firstElemValue : gen.generateExpression(arrExpr.elements[i], params);
      const elemCast = gen.nextTemp();
      gen.emit(`${elemCast} = bitcast ${gen.getVariableType(elemValue) || 'i8*'} ${elemValue} to i8*`);
      const elemPtr = gen.nextTemp();
      gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
      gen.emit(`store i8* ${elemCast}, i8** ${elemPtr}`);
    }

    // Store data pointer in array struct (field 0)
    const dataPtrField = gen.nextTemp();
    gen.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    gen.emit(`store i8** ${dataPtr}, i8*** ${dataPtrField}`);

    // Store length in array struct (field 1)
    const lenField = gen.nextTemp();
    gen.emit(`${lenField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
    gen.emit(`store i32 ${length}, i32* ${lenField}`);

    // Store capacity in array struct (field 2)
    const capField = gen.nextTemp();
    gen.emit(`${capField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`);
    gen.emit(`store i32 ${length}, i32* ${capField}`);

    gen.setVariableType(arrayPtr, '%StringArray*');
    return arrayPtr;
  } else {
    // Generate numeric array - allocate on HEAP, not stack
    // Compute sizeof(%Array) dynamically for portability
    const sizePtr = gen.nextTemp();
    gen.emit(`${sizePtr} = getelementptr %Array, %Array* null, i32 1`);
    const structSize = gen.nextTemp();
    gen.emit(`${structSize} = ptrtoint %Array* ${sizePtr} to i64`);
    const arrayMem = gen.nextTemp();
    gen.emit(`${arrayMem} = call i8* @GC_malloc(i64 ${structSize})`);
    const arrayPtr = gen.nextTemp();
    gen.emit(`${arrayPtr} = bitcast i8* ${arrayMem} to %Array*`);

    // Allocate data array on heap (double* with length elements)
    // GC_malloc_atomic for numeric array (no pointers inside)
    const dataCount = length === 0 ? 1 : length; // Allocate at least 1 element
    const dataSize = gen.nextTemp();
    gen.emit(`${dataSize} = mul i64 ${dataCount}, 8`);
    const dataMem = gen.nextTemp();
    gen.emit(`${dataMem} = call i8* @GC_malloc_atomic(i64 ${dataSize})`); // GC_malloc_atomic for numeric data
    const dataPtr = gen.nextTemp();
    gen.emit(`${dataPtr} = bitcast i8* ${dataMem} to double*`);

    // Store each element
    for (let i = 0; i < arrExpr.elements.length; i++) {
      const elemValue = (i === 0 && firstElemValue) ? firstElemValue : gen.generateExpression(arrExpr.elements[i], params);
      const elemPtr = gen.nextTemp();
      gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${i}`);
      gen.emit(`store double ${elemValue}, double* ${elemPtr}`);
    }

    // Store data pointer in array struct (field 0)
    const dataPtrField = gen.nextTemp();
    gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    gen.emit(`store double* ${dataPtr}, double** ${dataPtrField}`);

    // Store length in array struct (field 1)
    const lenField = gen.nextTemp();
    gen.emit(`${lenField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    gen.emit(`store i32 ${length}, i32* ${lenField}`);

    // Store capacity in array struct (field 2)
    const capField = gen.nextTemp();
    gen.emit(`${capField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
    gen.emit(`store i32 ${length}, i32* ${capField}`);

    gen.setVariableType(arrayPtr, '%Array*');
    return arrayPtr;
  }
}

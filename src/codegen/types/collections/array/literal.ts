import { Expression } from '../../../../ast/types.js';
import { BaseGenerator } from '../../../infrastructure/base-generator.js';

/**
 * Array literal generation
 * Handles creation of numeric, string, and pointer arrays
 */
export function generateArrayLiteral(
  gen: BaseGenerator,
  expr: Expression,
  params: string[],
  generateExpressionFn: (expr: Expression, params: string[]) => string
): string {
  if (expr.type !== 'array') {
    throw new Error('Expected array literal');
  }

  const length = expr.elements.length;

  // Determine if this is a string array:
  // 1. All elements are strings, OR
  // 2. Empty array with expectedArrayElementType='string' from context
  let isStringArray = length > 0 && expr.elements.every(elem => elem.type === 'string');
  if (length === 0 && gen.expectedArrayElementType === 'string') {
    isStringArray = true;
  }

  const isPointerArray = length > 0 && expr.elements.some(elem => {
    if (elem.type === 'variable') {
      const varName = (elem as any).name;
      const varType = gen.getVariableType(varName);
      return varType && (varType.includes('%Promise') || varType.includes('*'));
    }
    if (elem.type === 'method_call') {
      const obj = (elem as any).object;
      if (obj && obj.type === 'variable' && obj.name === 'Promise') {
        return true;
      }
    }
    return false;
  });

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
    for (let i = 0; i < expr.elements.length; i++) {
      const elemValue = generateExpressionFn(expr.elements[i], params);
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

    gen.variableTypes.set(arrayPtr, '%StringArray*');
    return arrayPtr;
  } else if (isPointerArray) {
    // Generate pointer array (for Promise[], any[], etc.) - uses %Array with i8** data
    const sizePtr = gen.nextTemp();
    gen.emit(`${sizePtr} = getelementptr %Array, %Array* null, i32 1`);
    const structSize = gen.nextTemp();
    gen.emit(`${structSize} = ptrtoint %Array* ${sizePtr} to i64`);
    const arrayMem = gen.nextTemp();
    gen.emit(`${arrayMem} = call i8* @GC_malloc(i64 ${structSize})`);
    const arrayPtr = gen.nextTemp();
    gen.emit(`${arrayPtr} = bitcast i8* ${arrayMem} to %Array*`);

    // Allocate data array on heap (i8** for pointers)
    const dataCount = length === 0 ? 1 : length;
    const dataSize = gen.nextTemp();
    gen.emit(`${dataSize} = mul i64 ${dataCount}, 8`);
    const dataMem = gen.nextTemp();
    gen.emit(`${dataMem} = call i8* @GC_malloc(i64 ${dataSize})`);
    const dataPtr = gen.nextTemp();
    gen.emit(`${dataPtr} = bitcast i8* ${dataMem} to i8**`);

    // Store each pointer element
    for (let i = 0; i < expr.elements.length; i++) {
      const elemValue = generateExpressionFn(expr.elements[i], params);
      const elemCast = gen.nextTemp();
      gen.emit(`${elemCast} = bitcast ${gen.variableTypes.get(elemValue) || 'i8*'} ${elemValue} to i8*`);
      const elemPtr = gen.nextTemp();
      gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
      gen.emit(`store i8* ${elemCast}, i8** ${elemPtr}`);
    }

    // Store data pointer in array struct (field 0) - cast i8** to double*
    const dataPtrCast = gen.nextTemp();
    gen.emit(`${dataPtrCast} = bitcast i8** ${dataPtr} to double*`);
    const dataPtrField = gen.nextTemp();
    gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    gen.emit(`store double* ${dataPtrCast}, double** ${dataPtrField}`);

    // Store length in array struct (field 1)
    const lenField = gen.nextTemp();
    gen.emit(`${lenField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    gen.emit(`store i32 ${length}, i32* ${lenField}`);

    // Store capacity in array struct (field 2)
    const capField = gen.nextTemp();
    gen.emit(`${capField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
    gen.emit(`store i32 ${length}, i32* ${capField}`);

    gen.variableTypes.set(arrayPtr, '%Array*');
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
    for (let i = 0; i < expr.elements.length; i++) {
      const elemValue = generateExpressionFn(expr.elements[i], params);
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

    gen.variableTypes.set(arrayPtr, '%Array*');
    return arrayPtr;
  }
}

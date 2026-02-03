import { Expression, MethodCallNode } from '../../../../ast/types.js';

interface ExprBase { type: string; }

interface ArrayMutatorContext {
  nextTemp(): string;
  nextLabel(prefix: string): string;
  emit(instruction: string): void;
  getVariableType(name: string): string | undefined;
  setVariableType(name: string, type: string): void;
  getDoubleSize(): string;
  generateExpression(expr: Expression, params: string[]): string;
}

/**
 * Array mutator operations (push, pop)
 */

export function generateArrayPush(
  gen: ArrayMutatorContext,
  expr: MethodCallNode,
  params: string[]
): string {
  // arr.push(value) - adds value to array and returns new length
  if (expr.args.length !== 1) {
    throw new Error('push() requires exactly 1 argument');
  }

  const arrayPtr = gen.generateExpression(expr.object, params);
  const value = gen.generateExpression(expr.args[0], params);

  // Determine if this is a string array or number array
  let isStringArray = false;
  const exprObjBase = expr.object as ExprBase;
  if (exprObjBase.type === 'variable') {
    const varName = (expr.object as { name: string }).name;
    const varType = gen.getVariableType(varName);
    isStringArray = varType === '%StringArray*';
  } else {
    // Check if the arrayPtr itself is tracked as a string array (e.g., from field access)
    const ptrType = gen.getVariableType(arrayPtr);
    isStringArray = ptrType === '%StringArray*';
  }

  if (isStringArray) {
    return generateStringArrayPush(gen, arrayPtr, value);
  }

  const valueType = gen.getVariableType(value);
  if (valueType && valueType.endsWith('*') && valueType !== 'double*') {
    return generatePointerArrayPush(gen, arrayPtr, value, valueType);
  }

  return generateIntArrayPush(gen, arrayPtr, value);
}

export function generateArrayPop(
  gen: ArrayMutatorContext,
  expr: MethodCallNode,
  params: string[]
): string {
  // arr.pop() - removes and returns last element
  if (expr.args.length !== 0) {
    throw new Error('pop() requires 0 arguments');
  }

  const arrayPtr = gen.generateExpression(expr.object, params);

  // Determine array type
  let isStringArray = false;
  let isPointerArray = false;
  const exprObjBase2 = expr.object as ExprBase;
  if (exprObjBase2.type === 'variable') {
    const varName = (expr.object as { name: string }).name;
    const varType = gen.getVariableType(varName);
    isStringArray = varType === '%StringArray*';
    isPointerArray = varType === 'i8*';
  } else {
    const ptrType = gen.getVariableType(arrayPtr);
    isStringArray = ptrType === '%StringArray*';
    isPointerArray = ptrType === 'i8*';
  }

  if (isStringArray) {
    return generateStringArrayPop(gen, arrayPtr);
  } else if (isPointerArray) {
    return generatePointerArrayPop(gen, arrayPtr);
  } else {
    return generateIntArrayPop(gen, arrayPtr);
  }
}

function generateIntArrayPop(gen: ArrayMutatorContext, arrayPtr: string): string {
  // Pop from %Array (int/boolean array)

  // Load current length
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  // Check if array is empty
  const isEmpty = gen.nextTemp();
  gen.emit(`${isEmpty} = icmp eq i32 ${currentLen}, 0`);

  const emptyLabel = gen.nextLabel('pop_empty');
  const notEmptyLabel = gen.nextLabel('pop_notempty');
  const endLabel = gen.nextLabel('pop_end');

  gen.emit(`br i1 ${isEmpty}, label %${emptyLabel}, label %${notEmptyLabel}`);

  // Empty case - return 0.0
  gen.emit(`${emptyLabel}:`);
  gen.emit(`br label %${endLabel}`);

  // Not empty - pop element
  gen.emit(`${notEmptyLabel}:`);

  // Calculate index of last element (length - 1)
  const lastIndex = gen.nextTemp();
  gen.emit(`${lastIndex} = sub i32 ${currentLen}, 1`);

  // Get data pointer
  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

  // Load last element
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${lastIndex}`);
  const lastElem = gen.nextTemp();
  gen.emit(`${lastElem} = load double, double* ${elemPtr}`);

  // Decrement length
  gen.emit(`store i32 ${lastIndex}, i32* ${lenPtr}`);

  gen.emit(`br label %${endLabel}`);

  // End - phi node to select result
  gen.emit(`${endLabel}:`);
  const result = gen.nextTemp();
  gen.emit(`${result} = phi double [ 0.0, %${emptyLabel} ], [ ${lastElem}, %${notEmptyLabel} ]`);

  return result;
}

function generateStringArrayPop(gen: ArrayMutatorContext, arrayPtr: string): string {
  // Pop from %StringArray (string array)

  // Load current length
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  // Check if array is empty
  const isEmpty = gen.nextTemp();
  gen.emit(`${isEmpty} = icmp eq i32 ${currentLen}, 0`);

  const emptyLabel = gen.nextLabel('pop_empty');
  const notEmptyLabel = gen.nextLabel('pop_notempty');
  const endLabel = gen.nextLabel('pop_end');

  gen.emit(`br i1 ${isEmpty}, label %${emptyLabel}, label %${notEmptyLabel}`);

  // Empty case - return empty string
  gen.emit(`${emptyLabel}:`);
  const emptyStr = gen.nextTemp();
  gen.emit(`${emptyStr} = call i8* @GC_malloc_atomic(i64 1)`);
  gen.emit(`store i8 0, i8* ${emptyStr}`);
  gen.emit(`br label %${endLabel}`);

  // Not empty - pop element
  gen.emit(`${notEmptyLabel}:`);

  // Calculate index of last element (length - 1)
  const lastIndex = gen.nextTemp();
  gen.emit(`${lastIndex} = sub i32 ${currentLen}, 1`);

  // Get data pointer
  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);

  // Load last element
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${lastIndex}`);
  const lastElem = gen.nextTemp();
  gen.emit(`${lastElem} = load i8*, i8** ${elemPtr}`);

  // Decrement length
  gen.emit(`store i32 ${lastIndex}, i32* ${lenPtr}`);

  gen.emit(`br label %${endLabel}`);

  // End - phi node to select result
  gen.emit(`${endLabel}:`);
  const result = gen.nextTemp();
  gen.emit(`${result} = phi i8* [ ${emptyStr}, %${emptyLabel} ], [ ${lastElem}, %${notEmptyLabel} ]`);
  gen.setVariableType(result, 'i8*');

  return result;
}

function generatePointerArrayPop(gen: ArrayMutatorContext, arrayPtr: string): string {
  const castPtr = gen.nextTemp();
  gen.emit(`${castPtr} = bitcast i8* ${arrayPtr} to %Array*`);

  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${castPtr}, i32 0, i32 1`);
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  const isEmpty = gen.nextTemp();
  gen.emit(`${isEmpty} = icmp eq i32 ${currentLen}, 0`);

  const emptyLabel = gen.nextLabel('pop_empty');
  const notEmptyLabel = gen.nextLabel('pop_notempty');
  const endLabel = gen.nextLabel('pop_end');

  gen.emit(`br i1 ${isEmpty}, label %${emptyLabel}, label %${notEmptyLabel}`);

  gen.emit(`${emptyLabel}:`);
  const nullPtr = gen.nextTemp();
  gen.emit(`${nullPtr} = inttoptr i64 0 to i8*`);
  gen.emit(`br label %${endLabel}`);

  gen.emit(`${notEmptyLabel}:`);

  const lastIndex = gen.nextTemp();
  gen.emit(`${lastIndex} = sub i32 ${currentLen}, 1`);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${castPtr}, i32 0, i32 0`);
  const dataPtrRaw = gen.nextTemp();
  gen.emit(`${dataPtrRaw} = load double*, double** ${dataPtrField}`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = bitcast double* ${dataPtrRaw} to i8**`);

  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${lastIndex}`);
  const lastElem = gen.nextTemp();
  gen.emit(`${lastElem} = load i8*, i8** ${elemPtr}`);

  gen.emit(`store i32 ${lastIndex}, i32* ${lenPtr}`);

  gen.emit(`br label %${endLabel}`);

  gen.emit(`${endLabel}:`);
  const result = gen.nextTemp();
  gen.emit(`${result} = phi i8* [ ${nullPtr}, %${emptyLabel} ], [ ${lastElem}, %${notEmptyLabel} ]`);
  gen.setVariableType(result, 'i8*');

  return result;
}

function generateIntArrayPush(gen: ArrayMutatorContext, arrayPtr: string, value: string): string {
  // Push to %Array (int/boolean array)

  // Load current length
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  // Load current capacity
  const capPtr = gen.nextTemp();
  gen.emit(`${capPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
  const currentCap = gen.nextTemp();
  gen.emit(`${currentCap} = load i32, i32* ${capPtr}`);

  // Check if we need to resize (length == capacity)
  const needResize = gen.nextTemp();
  gen.emit(`${needResize} = icmp eq i32 ${currentLen}, ${currentCap}`);

  // Create labels for resize and continue paths
  const resizeLabel = gen.nextLabel('resize');
  const continueLabel = gen.nextLabel('continue');

  gen.emit(`br i1 ${needResize}, label %${resizeLabel}, label %${continueLabel}`);

  // Resize block
  gen.emit(`${resizeLabel}:`);
  // Handle case where currentCap is 0 - set to 2, otherwise double it
  const isZero = gen.nextTemp();
  gen.emit(`${isZero} = icmp eq i32 ${currentCap}, 0`);
  const doubled = gen.nextTemp();
  gen.emit(`${doubled} = mul i32 ${currentCap}, 2`);
  const newCap = gen.nextTemp();
  gen.emit(`${newCap} = select i1 ${isZero}, i32 2, i32 ${doubled}`);

  // Allocate new data array with GC_malloc_atomic for zero-initialized numeric memory
  const newCapI64 = gen.nextTemp();
  gen.emit(`${newCapI64} = zext i32 ${newCap} to i64`);
  const newMemSize = gen.nextTemp();
  gen.emit(`${newMemSize} = mul i64 ${newCapI64}, 8`);
  const newMem = gen.nextTemp();
  gen.emit(`${newMem} = call i8* @GC_malloc_atomic(i64 ${newMemSize})`); // GC_malloc_atomic for numeric data
  const newDataPtr = gen.nextTemp();
  gen.emit(`${newDataPtr} = bitcast i8* ${newMem} to double*`);

  // Copy old data to new array
  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const oldDataPtr = gen.nextTemp();
  gen.emit(`${oldDataPtr} = load double*, double** ${dataPtrField}`);

  const oldDataI8 = gen.nextTemp();
  gen.emit(`${oldDataI8} = bitcast double* ${oldDataPtr} to i8*`);
  const newDataI8 = gen.nextTemp();
  gen.emit(`${newDataI8} = bitcast double* ${newDataPtr} to i8*`);
  // Compute copy size dynamically based on double size
  const doubleSize = gen.getDoubleSize();
  const currentLenI64 = gen.nextTemp();
  gen.emit(`${currentLenI64} = zext i32 ${currentLen} to i64`);
  const copySizeI64 = gen.nextTemp();
  gen.emit(`${copySizeI64} = mul i64 ${currentLenI64}, ${doubleSize}`);
  gen.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySizeI64}, i1 false)`);

  // Update pointer (GC will free old data)
  gen.emit(`store double* ${newDataPtr}, double** ${dataPtrField}`);

  // Update capacity
  gen.emit(`store i32 ${newCap}, i32* ${capPtr}`);

  gen.emit(`br label %${continueLabel}`);

  // Continue block
  gen.emit(`${continueLabel}:`);

  // Get current data pointer (may have been updated)
  const dataPtrField2 = gen.nextTemp();
  gen.emit(`${dataPtrField2} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load double*, double** ${dataPtrField2}`);

  // Store value at current length index
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${currentLen}`);
  gen.emit(`store double ${value}, double* ${elemPtr}`);

  // Increment length
  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = add i32 ${currentLen}, 1`);
  gen.emit(`store i32 ${newLen}, i32* ${lenPtr}`);

  // Return new length as double (JavaScript semantics)
  const newLenDouble = gen.nextTemp();
  gen.emit(`${newLenDouble} = sitofp i32 ${newLen} to double`);
  gen.setVariableType(newLenDouble, 'double');
  return newLenDouble;
}

function generateStringArrayPush(gen: ArrayMutatorContext, arrayPtr: string, value: string): string {
  // Push to %StringArray (string array)

  // Load current length
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  // Load current capacity
  const capPtr = gen.nextTemp();
  gen.emit(`${capPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`);
  const currentCap = gen.nextTemp();
  gen.emit(`${currentCap} = load i32, i32* ${capPtr}`);

  // Check if we need to resize (length == capacity)
  const needResize = gen.nextTemp();
  gen.emit(`${needResize} = icmp eq i32 ${currentLen}, ${currentCap}`);

  // Create labels for resize and continue paths
  const resizeLabel = gen.nextLabel('resize');
  const continueLabel = gen.nextLabel('continue');

  gen.emit(`br i1 ${needResize}, label %${resizeLabel}, label %${continueLabel}`);

  // Resize block
  gen.emit(`${resizeLabel}:`);
  // Handle case where currentCap is 0 - set to 2, otherwise double it
  const isZero = gen.nextTemp();
  gen.emit(`${isZero} = icmp eq i32 ${currentCap}, 0`);
  const doubled = gen.nextTemp();
  gen.emit(`${doubled} = mul i32 ${currentCap}, 2`);
  const newCap = gen.nextTemp();
  gen.emit(`${newCap} = select i1 ${isZero}, i32 2, i32 ${doubled}`);

  // Allocate new data array (i8** - array of string pointers) with GC_malloc (contains pointers)
  const newCapI64 = gen.nextTemp();
  gen.emit(`${newCapI64} = zext i32 ${newCap} to i64`);
  const newMemSize = gen.nextTemp();
  gen.emit(`${newMemSize} = mul i64 ${newCapI64}, 8`);
  const newMem = gen.nextTemp();
  gen.emit(`${newMem} = call i8* @GC_malloc(i64 ${newMemSize})`); // GC_malloc for pointer array
  const newDataPtr = gen.nextTemp();
  gen.emit(`${newDataPtr} = bitcast i8* ${newMem} to i8**`);

  // Copy old data to new array
  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
  const oldDataPtr = gen.nextTemp();
  gen.emit(`${oldDataPtr} = load i8**, i8*** ${dataPtrField}`);

  const oldDataI8 = gen.nextTemp();
  gen.emit(`${oldDataI8} = bitcast i8** ${oldDataPtr} to i8*`);
  const newDataI8 = gen.nextTemp();
  gen.emit(`${newDataI8} = bitcast i8** ${newDataPtr} to i8*`);
  const copySize = gen.nextTemp();
  gen.emit(`${copySize} = mul i32 ${currentLen}, 8`); // 8 bytes per pointer
  const copySizeI64 = gen.nextTemp();
  gen.emit(`${copySizeI64} = zext i32 ${copySize} to i64`);
  gen.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySizeI64}, i1 false)`);

  // Update pointer (GC will free old data)
  gen.emit(`store i8** ${newDataPtr}, i8*** ${dataPtrField}`);

  // Update capacity
  gen.emit(`store i32 ${newCap}, i32* ${capPtr}`);

  gen.emit(`br label %${continueLabel}`);

  // Continue block
  gen.emit(`${continueLabel}:`);

  // Get current data pointer (may have been updated)
  const dataPtrField2 = gen.nextTemp();
  gen.emit(`${dataPtrField2} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField2}`);

  // Store value at current length index
  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${currentLen}`);
  gen.emit(`store i8* ${value}, i8** ${elemPtr}`);

  // Increment length
  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = add i32 ${currentLen}, 1`);
  gen.emit(`store i32 ${newLen}, i32* ${lenPtr}`);

  // Return new length as double (JavaScript semantics)
  const newLenDouble = gen.nextTemp();
  gen.emit(`${newLenDouble} = sitofp i32 ${newLen} to double`);
  gen.setVariableType(newLenDouble, 'double');
  return newLenDouble;
}

function generatePointerArrayPush(gen: ArrayMutatorContext, arrayPtr: string, value: string, valueType: string): string {
  const lenPtr = gen.nextTemp();
  gen.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
  const currentLen = gen.nextTemp();
  gen.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

  const capPtr = gen.nextTemp();
  gen.emit(`${capPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
  const currentCap = gen.nextTemp();
  gen.emit(`${currentCap} = load i32, i32* ${capPtr}`);

  const needResize = gen.nextTemp();
  gen.emit(`${needResize} = icmp eq i32 ${currentLen}, ${currentCap}`);

  const resizeLabel = gen.nextLabel('resize');
  const continueLabel = gen.nextLabel('continue');

  gen.emit(`br i1 ${needResize}, label %${resizeLabel}, label %${continueLabel}`);

  gen.emit(`${resizeLabel}:`);
  const isZero = gen.nextTemp();
  gen.emit(`${isZero} = icmp eq i32 ${currentCap}, 0`);
  const doubled = gen.nextTemp();
  gen.emit(`${doubled} = mul i32 ${currentCap}, 2`);
  const newCap = gen.nextTemp();
  gen.emit(`${newCap} = select i1 ${isZero}, i32 2, i32 ${doubled}`);

  const newCapI64 = gen.nextTemp();
  gen.emit(`${newCapI64} = zext i32 ${newCap} to i64`);
  const newMemSize = gen.nextTemp();
  gen.emit(`${newMemSize} = mul i64 ${newCapI64}, 8`);
  const newMem = gen.nextTemp();
  gen.emit(`${newMem} = call i8* @GC_malloc(i64 ${newMemSize})`);
  const newDataPtr = gen.nextTemp();
  gen.emit(`${newDataPtr} = bitcast i8* ${newMem} to i8**`);

  const dataPtrField = gen.nextTemp();
  gen.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const oldDataPtrRaw = gen.nextTemp();
  gen.emit(`${oldDataPtrRaw} = load double*, double** ${dataPtrField}`);
  const oldDataPtr = gen.nextTemp();
  gen.emit(`${oldDataPtr} = bitcast double* ${oldDataPtrRaw} to i8**`);

  const oldDataI8 = gen.nextTemp();
  gen.emit(`${oldDataI8} = bitcast i8** ${oldDataPtr} to i8*`);
  const newDataI8 = gen.nextTemp();
  gen.emit(`${newDataI8} = bitcast i8** ${newDataPtr} to i8*`);
  const copySize = gen.nextTemp();
  gen.emit(`${copySize} = mul i32 ${currentLen}, 8`);
  const copySizeI64 = gen.nextTemp();
  gen.emit(`${copySizeI64} = zext i32 ${copySize} to i64`);
  gen.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySizeI64}, i1 false)`);

  const newDataPtrAsDouble = gen.nextTemp();
  gen.emit(`${newDataPtrAsDouble} = bitcast i8** ${newDataPtr} to double*`);
  gen.emit(`store double* ${newDataPtrAsDouble}, double** ${dataPtrField}`);

  gen.emit(`store i32 ${newCap}, i32* ${capPtr}`);

  gen.emit(`br label %${continueLabel}`);

  gen.emit(`${continueLabel}:`);

  const dataPtrField2 = gen.nextTemp();
  gen.emit(`${dataPtrField2} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
  const dataPtrRaw = gen.nextTemp();
  gen.emit(`${dataPtrRaw} = load double*, double** ${dataPtrField2}`);
  const dataPtr = gen.nextTemp();
  gen.emit(`${dataPtr} = bitcast double* ${dataPtrRaw} to i8**`);

  const elemPtr = gen.nextTemp();
  gen.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${currentLen}`);
  const valueAsI8 = gen.nextTemp();
  gen.emit(`${valueAsI8} = bitcast ${valueType} ${value} to i8*`);
  gen.emit(`store i8* ${valueAsI8}, i8** ${elemPtr}`);

  const newLen = gen.nextTemp();
  gen.emit(`${newLen} = add i32 ${currentLen}, 1`);
  gen.emit(`store i32 ${newLen}, i32* ${lenPtr}`);

  const newLenDouble = gen.nextTemp();
  gen.emit(`${newLenDouble} = sitofp i32 ${newLen} to double`);
  gen.setVariableType(newLenDouble, 'double');
  return newLenDouble;
}

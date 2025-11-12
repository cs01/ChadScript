import { Expression, MethodCallNode } from '../../ast/types.js';
import { BaseGenerator } from './base-generator.js';

// ============================================
// ARRAY GENERATOR - Array operations
// ============================================

export class ArrayGenerator extends BaseGenerator {
  // Generate delegate for expressions (set by LLVMGenerator)
  generateExpression!: (expr: Expression, params: string[]) => string;

  constructor() {
    super();
  }

  generateArrayLiteral(expr: Expression, params: string[]): string {
    if (expr.type !== 'array') {
      throw new Error('Expected array literal');
    }

    const length = expr.elements.length;

    // Determine if this is a string array:
    // 1. All elements are strings, OR
    // 2. Empty array with expectedArrayElementType='string' from context
    let isStringArray = length > 0 && expr.elements.every(elem => elem.type === 'string');
    if (length === 0 && this.expectedArrayElementType === 'string') {
      isStringArray = true;
    }

    if (isStringArray) {
      // Generate string array - allocate on HEAP, not stack
      // Compute sizeof(%StringArray) dynamically for portability
      const sizePtr = this.nextTemp();
      this.emit(`${sizePtr} = getelementptr %StringArray, %StringArray* null, i32 1`);
      const structSize = this.nextTemp();
      this.emit(`${structSize} = ptrtoint %StringArray* ${sizePtr} to i64`);
      const arrayMem = this.nextTemp();
      this.emit(`${arrayMem} = call i8* @malloc(i64 ${structSize})`);
      const arrayPtr = this.nextTemp();
      this.emit(`${arrayPtr} = bitcast i8* ${arrayMem} to %StringArray*`);

      // Allocate data array on heap (i8** with length elements)
      // Use calloc for zero-initialized memory to prevent garbage pointers
      const dataCount = length === 0 ? 1 : length; // Allocate at least 1 element
      const dataMem = this.nextTemp();
      this.emit(`${dataMem} = call i8* @calloc(i64 ${dataCount}, i64 8)`); // calloc(count, 8 bytes per i8*)
      const dataPtr = this.nextTemp();
      this.emit(`${dataPtr} = bitcast i8* ${dataMem} to i8**`);

      // Store each string element
      for (let i = 0; i < expr.elements.length; i++) {
        const elemValue = this.generateExpression(expr.elements[i], params);
        const elemPtr = this.nextTemp();
        this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
        this.emit(`store i8* ${elemValue}, i8** ${elemPtr}`);
      }

      // Store data pointer in array struct (field 0)
      const dataPtrField = this.nextTemp();
      this.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
      this.emit(`store i8** ${dataPtr}, i8*** ${dataPtrField}`);

      // Store length in array struct (field 1)
      const lenField = this.nextTemp();
      this.emit(`${lenField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
      this.emit(`store i32 ${length}, i32* ${lenField}`);

      // Store capacity in array struct (field 2)
      const capField = this.nextTemp();
      this.emit(`${capField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`);
      this.emit(`store i32 ${length}, i32* ${capField}`);

      return arrayPtr;
    } else {
      // Generate numeric array - allocate on HEAP, not stack
      // Compute sizeof(%Array) dynamically for portability
      const sizePtr = this.nextTemp();
      this.emit(`${sizePtr} = getelementptr %Array, %Array* null, i32 1`);
      const structSize = this.nextTemp();
      this.emit(`${structSize} = ptrtoint %Array* ${sizePtr} to i64`);
      const arrayMem = this.nextTemp();
      this.emit(`${arrayMem} = call i8* @malloc(i64 ${structSize})`);
      const arrayPtr = this.nextTemp();
      this.emit(`${arrayPtr} = bitcast i8* ${arrayMem} to %Array*`);

      // Allocate data array on heap (i32* with length elements)
      // Use calloc for zero-initialized memory to prevent garbage data
      const dataCount = length === 0 ? 1 : length; // Allocate at least 1 element
      const dataMem = this.nextTemp();
      this.emit(`${dataMem} = call i8* @calloc(i64 ${dataCount}, i64 4)`); // calloc(count, 4 bytes per i32)
      const dataPtr = this.nextTemp();
      this.emit(`${dataPtr} = bitcast i8* ${dataMem} to i32*`);

      // Store each element
      for (let i = 0; i < expr.elements.length; i++) {
        const elemValue = this.generateExpression(expr.elements[i], params);
        const elemPtr = this.nextTemp();
        this.emit(`${elemPtr} = getelementptr inbounds i32, i32* ${dataPtr}, i32 ${i}`);
        this.emit(`store i32 ${elemValue}, i32* ${elemPtr}`);
      }

      // Store data pointer in array struct (field 0)
      const dataPtrField = this.nextTemp();
      this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
      this.emit(`store i32* ${dataPtr}, i32** ${dataPtrField}`);

      // Store length in array struct (field 1)
      const lenField = this.nextTemp();
      this.emit(`${lenField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
      this.emit(`store i32 ${length}, i32* ${lenField}`);

      // Store capacity in array struct (field 2)
      const capField = this.nextTemp();
      this.emit(`${capField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
      this.emit(`store i32 ${length}, i32* ${capField}`);

      return arrayPtr;
    }
  }

  generateArrayPush(expr: MethodCallNode, params: string[]): string {
    // arr.push(value) - adds value to array and returns new length
    if (expr.args.length !== 1) {
      throw new Error('push() requires exactly 1 argument');
    }

    const arrayPtr = this.generateExpression(expr.object, params);
    const value = this.generateExpression(expr.args[0], params);

    // Determine if this is a string array or number array
    let isStringArray = false;
    if (expr.object.type === 'variable') {
      const varName = (expr.object as any).name;
      isStringArray = this.stringArrayVariables.has(varName);
    } else {
      // Check if the arrayPtr itself is tracked as a string array (e.g., from field access)
      isStringArray = this.stringArrayVariables.has(arrayPtr);
    }

    if (isStringArray) {
      return this.generateStringArrayPush(arrayPtr, value);
    } else {
      return this.generateIntArrayPush(arrayPtr, value);
    }
  }

  private generateIntArrayPush(arrayPtr: string, value: string): string {
    // Push to %Array (int/boolean array)

    // Load current length
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const currentLen = this.nextTemp();
    this.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

    // Load current capacity
    const capPtr = this.nextTemp();
    this.emit(`${capPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
    const currentCap = this.nextTemp();
    this.emit(`${currentCap} = load i32, i32* ${capPtr}`);

    // Check if we need to resize (length == capacity)
    const needResize = this.nextTemp();
    this.emit(`${needResize} = icmp eq i32 ${currentLen}, ${currentCap}`);

    // Create labels for resize and continue paths
    const resizeLabel = this.nextLabel('resize');
    const continueLabel = this.nextLabel('continue');

    this.emit(`br i1 ${needResize}, label %${resizeLabel}, label %${continueLabel}`);

    // Resize block
    this.emit(`${resizeLabel}:`);
    // Handle case where currentCap is 0 - set to 2, otherwise double it
    const isZero = this.nextTemp();
    this.emit(`${isZero} = icmp eq i32 ${currentCap}, 0`);
    const doubled = this.nextTemp();
    this.emit(`${doubled} = mul i32 ${currentCap}, 2`);
    const newCap = this.nextTemp();
    this.emit(`${newCap} = select i1 ${isZero}, i32 2, i32 ${doubled}`);

    // Allocate new data array with calloc for zero-initialized memory
    const newCapI64 = this.nextTemp();
    this.emit(`${newCapI64} = zext i32 ${newCap} to i64`);
    const newMem = this.nextTemp();
    this.emit(`${newMem} = call i8* @calloc(i64 ${newCapI64}, i64 4)`); // calloc(count, 4 bytes per i32)
    const newDataPtr = this.nextTemp();
    this.emit(`${newDataPtr} = bitcast i8* ${newMem} to i32*`);

    // Copy old data to new array
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const oldDataPtr = this.nextTemp();
    this.emit(`${oldDataPtr} = load i32*, i32** ${dataPtrField}`);

    const oldDataI8 = this.nextTemp();
    this.emit(`${oldDataI8} = bitcast i32* ${oldDataPtr} to i8*`);
    const newDataI8 = this.nextTemp();
    this.emit(`${newDataI8} = bitcast i32* ${newDataPtr} to i8*`);
    const copySize = this.nextTemp();
    this.emit(`${copySize} = mul i32 ${currentLen}, 4`);
    const copySizeI64 = this.nextTemp();
    this.emit(`${copySizeI64} = zext i32 ${copySize} to i64`);
    this.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySizeI64}, i1 false)`);

    // Free old data and update pointer
    this.emit(`call void @free(i8* ${oldDataI8})`);
    this.emit(`store i32* ${newDataPtr}, i32** ${dataPtrField}`);

    // Update capacity
    this.emit(`store i32 ${newCap}, i32* ${capPtr}`);

    this.emit(`br label %${continueLabel}`);

    // Continue block
    this.emit(`${continueLabel}:`);

    // Get current data pointer (may have been updated)
    const dataPtrField2 = this.nextTemp();
    this.emit(`${dataPtrField2} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i32*, i32** ${dataPtrField2}`);

    // Store value at current length index
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i32, i32* ${dataPtr}, i32 ${currentLen}`);
    this.emit(`store i32 ${value}, i32* ${elemPtr}`);

    // Increment length
    const newLen = this.nextTemp();
    this.emit(`${newLen} = add i32 ${currentLen}, 1`);
    this.emit(`store i32 ${newLen}, i32* ${lenPtr}`);

    // Return new length
    return newLen;
  }

  private generateStringArrayPush(arrayPtr: string, value: string): string {
    // Push to %StringArray (string array)

    // Load current length
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
    const currentLen = this.nextTemp();
    this.emit(`${currentLen} = load i32, i32* ${lenPtr}`);

    // Load current capacity
    const capPtr = this.nextTemp();
    this.emit(`${capPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`);
    const currentCap = this.nextTemp();
    this.emit(`${currentCap} = load i32, i32* ${capPtr}`);

    // Check if we need to resize (length == capacity)
    const needResize = this.nextTemp();
    this.emit(`${needResize} = icmp eq i32 ${currentLen}, ${currentCap}`);

    // Create labels for resize and continue paths
    const resizeLabel = this.nextLabel('resize');
    const continueLabel = this.nextLabel('continue');

    this.emit(`br i1 ${needResize}, label %${resizeLabel}, label %${continueLabel}`);

    // Resize block
    this.emit(`${resizeLabel}:`);
    // Handle case where currentCap is 0 - set to 2, otherwise double it
    const isZero = this.nextTemp();
    this.emit(`${isZero} = icmp eq i32 ${currentCap}, 0`);
    const doubled = this.nextTemp();
    this.emit(`${doubled} = mul i32 ${currentCap}, 2`);
    const newCap = this.nextTemp();
    this.emit(`${newCap} = select i1 ${isZero}, i32 2, i32 ${doubled}`);

    // Allocate new data array (i8** - array of string pointers) with calloc for zero-initialized memory
    const newCapI64 = this.nextTemp();
    this.emit(`${newCapI64} = zext i32 ${newCap} to i64`);
    const newMem = this.nextTemp();
    this.emit(`${newMem} = call i8* @calloc(i64 ${newCapI64}, i64 8)`); // calloc(count, 8 bytes per i8*)
    const newDataPtr = this.nextTemp();
    this.emit(`${newDataPtr} = bitcast i8* ${newMem} to i8**`);

    // Copy old data to new array
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    const oldDataPtr = this.nextTemp();
    this.emit(`${oldDataPtr} = load i8**, i8*** ${dataPtrField}`);

    const oldDataI8 = this.nextTemp();
    this.emit(`${oldDataI8} = bitcast i8** ${oldDataPtr} to i8*`);
    const newDataI8 = this.nextTemp();
    this.emit(`${newDataI8} = bitcast i8** ${newDataPtr} to i8*`);
    const copySize = this.nextTemp();
    this.emit(`${copySize} = mul i32 ${currentLen}, 8`); // 8 bytes per pointer
    const copySizeI64 = this.nextTemp();
    this.emit(`${copySizeI64} = zext i32 ${copySize} to i64`);
    this.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySizeI64}, i1 false)`);

    // Free old data and update pointer
    this.emit(`call void @free(i8* ${oldDataI8})`);
    this.emit(`store i8** ${newDataPtr}, i8*** ${dataPtrField}`);

    // Update capacity
    this.emit(`store i32 ${newCap}, i32* ${capPtr}`);

    this.emit(`br label %${continueLabel}`);

    // Continue block
    this.emit(`${continueLabel}:`);

    // Get current data pointer (may have been updated)
    const dataPtrField2 = this.nextTemp();
    this.emit(`${dataPtrField2} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField2}`);

    // Store value at current length index
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${currentLen}`);
    this.emit(`store i8* ${value}, i8** ${elemPtr}`);

    // Increment length
    const newLen = this.nextTemp();
    this.emit(`${newLen} = add i32 ${currentLen}, 1`);
    this.emit(`store i32 ${newLen}, i32* ${lenPtr}`);

    // Return new length
    return newLen;
  }

  generateArrayFind(expr: MethodCallNode, params: string[]): string {
    // arr.find(predicateFn) - returns first element where predicate returns truthy, or 0 if not found
    // Accepts a variable reference to a function that takes (element) and returns boolean-ish
    if (expr.args.length !== 1) {
      throw new Error('find() requires exactly 1 argument (predicate function)');
    }

    // Get the function name from the argument
    const predicateArg = expr.args[0];
    let predicateFn: string;

    if (predicateArg.type === 'variable') {
      predicateFn = predicateArg.name;
    } else if ((predicateArg as any).type === 'arrow_function') {
      // Inline function - generate it and get the name
      predicateFn = this.generateExpression(predicateArg, params);
    } else {
      throw new Error('find() argument must be a function name or inline function');
    }

    const arrayPtr = this.generateExpression(expr.object, params);

    // Load array length
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    // Load data pointer
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i32*, i32** ${dataPtrField}`);

    // Loop setup
    const loopLabel = this.nextLabel('find_loop');
    const checkLabel = this.nextLabel('find_check');
    const bodyLabel = this.nextLabel('find_body');
    const foundLabel = this.nextLabel('find_found');
    const endLabel = this.nextLabel('find_end');

    // Initialize loop counter
    const counterPtr = this.nextTemp();
    this.emit(`${counterPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${counterPtr}`);

    // Result variable (will hold found element or 0)
    const resultPtr = this.nextTemp();
    this.emit(`${resultPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${resultPtr}`);

    this.emit(`br label %${checkLabel}`);

    // Check condition
    this.emit(`${checkLabel}:`);
    const counter = this.nextTemp();
    this.emit(`${counter} = load i32, i32* ${counterPtr}`);
    const cond = this.nextTemp();
    this.emit(`${cond} = icmp slt i32 ${counter}, ${length}`);
    this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

    // Loop body
    this.emit(`${bodyLabel}:`);

    // Load current element
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i32, i32* ${dataPtr}, i32 ${counter}`);
    const elem = this.nextTemp();
    this.emit(`${elem} = load i32, i32* ${elemPtr}`);

    // Call predicate function
    const predicateResult = this.nextTemp();
    this.emit(`${predicateResult} = call i32 @${predicateFn}(i32 ${elem})`);

    // Check if predicate returned truthy
    const isTruthy = this.nextTemp();
    this.emit(`${isTruthy} = icmp ne i32 ${predicateResult}, 0`);
    this.emit(`br i1 ${isTruthy}, label %${foundLabel}, label %${loopLabel}`);

    // Found - store element and exit
    this.emit(`${foundLabel}:`);
    this.emit(`store i32 ${elem}, i32* ${resultPtr}`);
    this.emit(`br label %${endLabel}`);

    // Continue loop
    this.emit(`${loopLabel}:`);
    const nextCounter = this.nextTemp();
    this.emit(`${nextCounter} = add i32 ${counter}, 1`);
    this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
    this.emit(`br label %${checkLabel}`);

    // End
    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = load i32, i32* ${resultPtr}`);
    return result;
  }

  generateArraySome(expr: MethodCallNode, params: string[]): string {
    // arr.some(predicateFn) - returns 1 if any element satisfies predicate, 0 otherwise
    if (expr.args.length !== 1) {
      throw new Error('some() requires exactly 1 argument (predicate function)');
    }

    const predicateArg = expr.args[0];
    let predicateFn: string;

    if (predicateArg.type === 'variable') {
      predicateFn = predicateArg.name;
    } else if ((predicateArg as any).type === 'arrow_function') {
      // Inline function - generate it and get the name
      predicateFn = this.generateExpression(predicateArg, params);
    } else {
      throw new Error('some() argument must be a function name or inline function');
    }

    const arrayPtr = this.generateExpression(expr.object, params);

    // Load array length
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    // Load data pointer
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i32*, i32** ${dataPtrField}`);

    // Loop setup
    const loopLabel = this.nextLabel('some_loop');
    const checkLabel = this.nextLabel('some_check');
    const bodyLabel = this.nextLabel('some_body');
    const foundLabel = this.nextLabel('some_found');
    const endLabel = this.nextLabel('some_end');

    // Initialize loop counter
    const counterPtr = this.nextTemp();
    this.emit(`${counterPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${counterPtr}`);

    // Result variable
    const resultPtr = this.nextTemp();
    this.emit(`${resultPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${resultPtr}`);

    this.emit(`br label %${checkLabel}`);

    // Check condition
    this.emit(`${checkLabel}:`);
    const counter = this.nextTemp();
    this.emit(`${counter} = load i32, i32* ${counterPtr}`);
    const cond = this.nextTemp();
    this.emit(`${cond} = icmp slt i32 ${counter}, ${length}`);
    this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

    // Loop body
    this.emit(`${bodyLabel}:`);

    // Load current element
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i32, i32* ${dataPtr}, i32 ${counter}`);
    const elem = this.nextTemp();
    this.emit(`${elem} = load i32, i32* ${elemPtr}`);

    // Call predicate function
    const predicateResult = this.nextTemp();
    this.emit(`${predicateResult} = call i32 @${predicateFn}(i32 ${elem})`);

    // Check if predicate returned truthy
    const isTruthy = this.nextTemp();
    this.emit(`${isTruthy} = icmp ne i32 ${predicateResult}, 0`);
    this.emit(`br i1 ${isTruthy}, label %${foundLabel}, label %${loopLabel}`);

    // Found - return 1
    this.emit(`${foundLabel}:`);
    this.emit(`store i32 1, i32* ${resultPtr}`);
    this.emit(`br label %${endLabel}`);

    // Continue loop
    this.emit(`${loopLabel}:`);
    const nextCounter = this.nextTemp();
    this.emit(`${nextCounter} = add i32 ${counter}, 1`);
    this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
    this.emit(`br label %${checkLabel}`);

    // End
    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = load i32, i32* ${resultPtr}`);
    return result;
  }

  generateArrayFilter(expr: MethodCallNode, params: string[]): string {
    // arr.filter(predicateFn) - returns new array with elements that satisfy predicate
    if (expr.args.length !== 1) {
      throw new Error('filter() requires exactly 1 argument (predicate function)');
    }

    const predicateArg = expr.args[0];
    let predicateFn: string;

    if (predicateArg.type === 'variable') {
      predicateFn = predicateArg.name;
    } else if ((predicateArg as any).type === 'arrow_function') {
      // Inline function - generate it and get the name
      predicateFn = this.generateExpression(predicateArg, params);
    } else {
      throw new Error('filter() argument must be a function name or inline function');
    }

    const arrayPtr = this.generateExpression(expr.object, params);

    // Load array length
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    // Load data pointer
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i32*, i32** ${dataPtrField}`);

    // Create new array for result (allocate with same capacity as input)
    const resultArrayPtr = this.nextTemp();
    this.emit(`${resultArrayPtr} = alloca %Array`);

    // Allocate data array on heap
    const dataSize = this.nextTemp();
    this.emit(`${dataSize} = mul i32 ${length}, 4`); // 4 bytes per i32
    const dataSizeI64 = this.nextTemp();
    this.emit(`${dataSizeI64} = zext i32 ${dataSize} to i64`);
    const dataMem = this.nextTemp();
    this.emit(`${dataMem} = call i8* @malloc(i64 ${dataSizeI64})`);
    const resultDataPtr = this.nextTemp();
    this.emit(`${resultDataPtr} = bitcast i8* ${dataMem} to i32*`);

    // Store data pointer in result array struct
    const resultDataPtrField = this.nextTemp();
    this.emit(`${resultDataPtrField} = getelementptr inbounds %Array, %Array* ${resultArrayPtr}, i32 0, i32 0`);
    this.emit(`store i32* ${resultDataPtr}, i32** ${resultDataPtrField}`);

    // Initialize length to 0
    const resultLenField = this.nextTemp();
    this.emit(`${resultLenField} = getelementptr inbounds %Array, %Array* ${resultArrayPtr}, i32 0, i32 1`);
    this.emit(`store i32 0, i32* ${resultLenField}`);

    // Set capacity
    const resultCapField = this.nextTemp();
    this.emit(`${resultCapField} = getelementptr inbounds %Array, %Array* ${resultArrayPtr}, i32 0, i32 2`);
    this.emit(`store i32 ${length}, i32* ${resultCapField}`);

    // Loop through original array
    const loopLabel = this.nextLabel('filter_loop');
    const checkLabel = this.nextLabel('filter_check');
    const bodyLabel = this.nextLabel('filter_body');
    const addLabel = this.nextLabel('filter_add');
    const endLabel = this.nextLabel('filter_end');

    // Initialize loop counter
    const counterPtr = this.nextTemp();
    this.emit(`${counterPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${counterPtr}`);

    this.emit(`br label %${checkLabel}`);

    // Check condition
    this.emit(`${checkLabel}:`);
    const counter = this.nextTemp();
    this.emit(`${counter} = load i32, i32* ${counterPtr}`);
    const cond = this.nextTemp();
    this.emit(`${cond} = icmp slt i32 ${counter}, ${length}`);
    this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

    // Loop body
    this.emit(`${bodyLabel}:`);

    // Load current element
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i32, i32* ${dataPtr}, i32 ${counter}`);
    const elem = this.nextTemp();
    this.emit(`${elem} = load i32, i32* ${elemPtr}`);

    // Call predicate function
    const predicateResult = this.nextTemp();
    this.emit(`${predicateResult} = call i32 @${predicateFn}(i32 ${elem})`);

    // Check if predicate returned truthy
    const isTruthy = this.nextTemp();
    this.emit(`${isTruthy} = icmp ne i32 ${predicateResult}, 0`);
    this.emit(`br i1 ${isTruthy}, label %${addLabel}, label %${loopLabel}`);

    // Add element to result array
    this.emit(`${addLabel}:`);
    const currentLen = this.nextTemp();
    this.emit(`${currentLen} = load i32, i32* ${resultLenField}`);

    const resultElemPtr = this.nextTemp();
    this.emit(`${resultElemPtr} = getelementptr inbounds i32, i32* ${resultDataPtr}, i32 ${currentLen}`);
    this.emit(`store i32 ${elem}, i32* ${resultElemPtr}`);

    const newLen = this.nextTemp();
    this.emit(`${newLen} = add i32 ${currentLen}, 1`);
    this.emit(`store i32 ${newLen}, i32* ${resultLenField}`);
    this.emit(`br label %${loopLabel}`);

    // Continue loop
    this.emit(`${loopLabel}:`);
    const nextCounter = this.nextTemp();
    this.emit(`${nextCounter} = add i32 ${counter}, 1`);
    this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
    this.emit(`br label %${checkLabel}`);

    // End
    this.emit(`${endLabel}:`);
    return resultArrayPtr;
  }

  generateArrayForEach(expr: MethodCallNode, params: string[]): string {
    // arr.forEach(callbackFn) - calls function for each element, returns 0
    if (expr.args.length !== 1) {
      throw new Error('forEach() requires exactly 1 argument (callback function)');
    }

    const callbackArg = expr.args[0];
    let callbackFn: string;

    if (callbackArg.type === 'variable') {
      callbackFn = callbackArg.name;
    } else if ((callbackArg as any).type === 'arrow_function') {
      // Inline function - generate it and get the name
      callbackFn = this.generateExpression(callbackArg, params);
    } else {
      throw new Error('forEach() argument must be a function name or inline function');
    }

    const arrayPtr = this.generateExpression(expr.object, params);

    // Load array length
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    // Load data pointer
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i32*, i32** ${dataPtrField}`);

    // Loop setup
    const loopLabel = this.nextLabel('foreach_loop');
    const checkLabel = this.nextLabel('foreach_check');
    const bodyLabel = this.nextLabel('foreach_body');
    const endLabel = this.nextLabel('foreach_end');

    // Initialize loop counter
    const counterPtr = this.nextTemp();
    this.emit(`${counterPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${counterPtr}`);

    this.emit(`br label %${checkLabel}`);

    // Check condition
    this.emit(`${checkLabel}:`);
    const counter = this.nextTemp();
    this.emit(`${counter} = load i32, i32* ${counterPtr}`);
    const cond = this.nextTemp();
    this.emit(`${cond} = icmp slt i32 ${counter}, ${length}`);
    this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

    // Loop body
    this.emit(`${bodyLabel}:`);

    // Load current element
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i32, i32* ${dataPtr}, i32 ${counter}`);
    const elem = this.nextTemp();
    this.emit(`${elem} = load i32, i32* ${elemPtr}`);

    // Call callback function (discard return value)
    const callResult = this.nextTemp();
    this.emit(`${callResult} = call i32 @${callbackFn}(i32 ${elem})`);

    // Continue loop
    const nextCounter = this.nextTemp();
    this.emit(`${nextCounter} = add i32 ${counter}, 1`);
    this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
    this.emit(`br label %${checkLabel}`);

    // End - forEach returns 0 (undefined-ish)
    this.emit(`${endLabel}:`);
    return '0';
  }

  generateArrayMap(expr: MethodCallNode, params: string[]): string {
    // arr.map(callbackFn) - returns new array with transformed elements
    if (expr.args.length !== 1) {
      throw new Error('map() requires exactly 1 argument (callback function)');
    }

    const callbackArg = expr.args[0];
    let callbackFn: string;

    if (callbackArg.type === 'variable') {
      callbackFn = callbackArg.name;
    } else if ((callbackArg as any).type === 'arrow_function') {
      // Inline function - generate it and get the name
      callbackFn = this.generateExpression(callbackArg, params);
    } else {
      throw new Error('map() argument must be a function name or inline function');
    }

    const arrayPtr = this.generateExpression(expr.object, params);

    // Load array length
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    // Load data pointer
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i32*, i32** ${dataPtrField}`);

    // Create result array with same length
    const resultArrayPtr = this.nextTemp();
    this.emit(`${resultArrayPtr} = alloca %Array`);

    // Allocate data for result array
    const resultSize = this.nextTemp();
    this.emit(`${resultSize} = mul i32 ${length}, 4`);
    const resultSizeI64 = this.nextTemp();
    this.emit(`${resultSizeI64} = zext i32 ${resultSize} to i64`);
    const resultMem = this.nextTemp();
    this.emit(`${resultMem} = call i8* @malloc(i64 ${resultSizeI64})`);
    const resultDataPtr = this.nextTemp();
    this.emit(`${resultDataPtr} = bitcast i8* ${resultMem} to i32*`);

    // Store data pointer in result array struct
    const resultDataPtrField = this.nextTemp();
    this.emit(`${resultDataPtrField} = getelementptr inbounds %Array, %Array* ${resultArrayPtr}, i32 0, i32 0`);
    this.emit(`store i32* ${resultDataPtr}, i32** ${resultDataPtrField}`);

    // Store length in result array struct
    const resultLenField = this.nextTemp();
    this.emit(`${resultLenField} = getelementptr inbounds %Array, %Array* ${resultArrayPtr}, i32 0, i32 1`);
    this.emit(`store i32 ${length}, i32* ${resultLenField}`);

    // Store capacity in result array struct
    const resultCapField = this.nextTemp();
    this.emit(`${resultCapField} = getelementptr inbounds %Array, %Array* ${resultArrayPtr}, i32 0, i32 2`);
    this.emit(`store i32 ${length}, i32* ${resultCapField}`);

    // Loop setup
    const counterPtr = this.nextTemp();
    this.emit(`${counterPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${counterPtr}`);

    const loopLabel = this.nextLabel('map_loop');
    const checkLabel = this.nextLabel('map_check');
    const bodyLabel = this.nextLabel('map_body');
    const endLabel = this.nextLabel('map_end');

    this.emit(`br label %${checkLabel}`);

    // Check condition
    this.emit(`${checkLabel}:`);
    const counter = this.nextTemp();
    this.emit(`${counter} = load i32, i32* ${counterPtr}`);
    const cond = this.nextTemp();
    this.emit(`${cond} = icmp slt i32 ${counter}, ${length}`);
    this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

    // Loop body
    this.emit(`${bodyLabel}:`);

    // Load element
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i32, i32* ${dataPtr}, i32 ${counter}`);
    const elem = this.nextTemp();
    this.emit(`${elem} = load i32, i32* ${elemPtr}`);

    // Call callback function with element
    const result = this.nextTemp();
    this.emit(`${result} = call i32 @${callbackFn}(i32 ${elem})`);

    // Store result in result array
    const resultElemPtr = this.nextTemp();
    this.emit(`${resultElemPtr} = getelementptr inbounds i32, i32* ${resultDataPtr}, i32 ${counter}`);
    this.emit(`store i32 ${result}, i32* ${resultElemPtr}`);

    // Continue loop
    const nextCounter = this.nextTemp();
    this.emit(`${nextCounter} = add i32 ${counter}, 1`);
    this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
    this.emit(`br label %${checkLabel}`);

    // End
    this.emit(`${endLabel}:`);
    return resultArrayPtr;
  }

  generateArrayJoin(expr: MethodCallNode, params: string[]): string {
    // arr.join(separator) - returns a string (i8*)
    // For simplicity, we'll implement join with a string separator
    if (expr.args.length !== 1) {
      throw new Error('join() requires exactly 1 argument (separator)');
    }

    const arrayPtr = this.generateExpression(expr.object, params);
    const separator = this.generateExpression(expr.args[0], params);

    // Get array length
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    // Get data pointer
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i32*, i32** ${dataPtrField}`);

    // For simplicity, we'll allocate a fixed-size buffer for the result
    // In a real implementation, we'd calculate the exact size needed
    const bufferSize = 1024; // Fixed size for demo
    const resultBuffer = this.nextTemp();
    this.emit(`${resultBuffer} = call i8* @malloc(i64 ${bufferSize})`);

    // Initialize buffer with empty string
    const nullByte = this.nextTemp();
    this.emit(`${nullByte} = getelementptr inbounds i8, i8* ${resultBuffer}, i64 0`);
    this.emit(`store i8 0, i8* ${nullByte}`);

    // For now, return a simple implementation that concatenates numbers
    // A complete implementation would need sprintf or similar to convert i32 to string
    // This is a simplified placeholder
    return resultBuffer;
  }
}

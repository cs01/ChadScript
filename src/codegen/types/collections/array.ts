import { Expression, MethodCallNode, ArrowFunctionNode, VariableNode } from '../../../ast/types.js';

interface ExprBase { type: string; }

import { IGeneratorContext } from '../../infrastructure/generator-context.js';
import { generateArrayLiteral } from './array/literal.js';
import { generateArrayPush, generateArrayPop } from './array/mutators.js';

export class ArrayGenerator {
  constructor(private ctx: IGeneratorContext) {}

  private nextTemp() { return this.ctx.nextTemp(); }
  private nextLabel(prefix: string) { return this.ctx.nextLabel(prefix); }
  private emit(instruction: string) { this.ctx.emit(instruction); }

  private loadArrayMeta(arrayPtr: string): { length: string; dataPtr: string } {
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);
    return { length, dataPtr };
  }

  generateArrayLiteral(expr: Expression, params: string[]): string {
    return generateArrayLiteral(this.ctx, expr, params);
  }

  generateArrayPush(expr: MethodCallNode, params: string[]): string {
    return generateArrayPush(this.ctx, expr, params);
  }

  generateArrayPop(expr: MethodCallNode, params: string[]): string {
    return generateArrayPop(this.ctx, expr, params);
  }

  generateArrayFind(expr: MethodCallNode, params: string[]): string {
    // arr.find(predicateFn) - returns first element where predicate returns truthy, or 0 if not found
    // Accepts a variable reference to a function that takes (element) and returns boolean-ish
    if (expr.args.length !== 1) {
      throw new Error('find() requires exactly 1 argument (predicate function)');
    }

    // Get the function name from the argument
    const predicateArg = expr.args[0] as { type: string; name: string };
    let predicateFn: string;

    if (predicateArg.type === 'variable') {
      predicateFn = predicateArg.name;
    } else if (predicateArg.type === 'arrow_function') {
      // Inline function - generate it and get the name
      predicateFn = this.ctx.generateExpression(expr.args[0], params);
    } else {
      throw new Error('find() argument must be a function name or inline function');
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);
    const arrayMeta = this.loadArrayMeta(arrayPtr) as { length: string; dataPtr: string };
    const length = arrayMeta.length;
    const dataPtr = arrayMeta.dataPtr;

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

    // Result variable (will hold found element or 0.0)
    const resultPtr = this.nextTemp();
    this.emit(`${resultPtr} = alloca double`);
    this.emit(`store double 0.0, double* ${resultPtr}`);

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
    this.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${counter}`);
    const elem = this.nextTemp();
    this.emit(`${elem} = load double, double* ${elemPtr}`);

    // Call predicate function
    const predicateResult = this.nextTemp();
    this.emit(`${predicateResult} = call double @${predicateFn}(double ${elem})`);

    // Check if predicate returned truthy (non-zero)
    const isTruthy = this.nextTemp();
    this.emit(`${isTruthy} = fcmp one double ${predicateResult}, 0.0`);
    this.emit(`br i1 ${isTruthy}, label %${foundLabel}, label %${loopLabel}`);

    // Found - store element and exit
    this.emit(`${foundLabel}:`);
    this.emit(`store double ${elem}, double* ${resultPtr}`);
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
    this.emit(`${result} = load double, double* ${resultPtr}`);
    return result;
  }

  generateArraySome(expr: MethodCallNode, params: string[]): string {
    // arr.some(predicateFn) - returns 1 if any element satisfies predicate, 0 otherwise
    if (expr.args.length !== 1) {
      throw new Error('some() requires exactly 1 argument (predicate function)');
    }

    const predicateArg = expr.args[0] as { type: string; name: string };
    let predicateFn: string;

    if (predicateArg.type === 'variable') {
      predicateFn = predicateArg.name;
    } else if (predicateArg.type === 'arrow_function') {
      // Inline function - generate it and get the name
      predicateFn = this.ctx.generateExpression(expr.args[0], params);
    } else {
      throw new Error('some() argument must be a function name or inline function');
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);
    const arrayMeta = this.loadArrayMeta(arrayPtr) as { length: string; dataPtr: string };
    const length = arrayMeta.length;
    const dataPtr = arrayMeta.dataPtr;

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
    this.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${counter}`);
    const elem = this.nextTemp();
    this.emit(`${elem} = load double, double* ${elemPtr}`);

    // Call predicate function
    const predicateResult = this.nextTemp();
    this.emit(`${predicateResult} = call double @${predicateFn}(double ${elem})`);

    // Check if predicate returned truthy (non-zero)
    const isTruthy = this.nextTemp();
    this.emit(`${isTruthy} = fcmp one double ${predicateResult}, 0.0`);
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
    const resultI32 = this.nextTemp();
    this.emit(`${resultI32} = load i32, i32* ${resultPtr}`);
    const result = this.nextTemp();
    this.emit(`${result} = sitofp i32 ${resultI32} to double`);
    return result;
  }

  generateArrayEvery(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error('every() requires exactly 1 argument (predicate function)');
    }

    const predicateArg = expr.args[0];
    let predicateFn: string;

    if (predicateArg.type === 'variable') {
      predicateFn = (predicateArg as VariableNode).name;
    } else if (predicateArg.type === 'arrow_function') {
      predicateFn = this.ctx.generateExpression(predicateArg, params);
    } else {
      throw new Error('every() argument must be a function name or inline function');
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);
    const arrayMeta = this.loadArrayMeta(arrayPtr) as { length: string; dataPtr: string };
    const length = arrayMeta.length;
    const dataPtr = arrayMeta.dataPtr;

    const loopLabel = this.nextLabel('every_loop');
    const checkLabel = this.nextLabel('every_check');
    const bodyLabel = this.nextLabel('every_body');
    const failedLabel = this.nextLabel('every_failed');
    const endLabel = this.nextLabel('every_end');

    const counterPtr = this.nextTemp();
    this.emit(`${counterPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${counterPtr}`);

    const resultPtr = this.nextTemp();
    this.emit(`${resultPtr} = alloca i32`);
    this.emit(`store i32 1, i32* ${resultPtr}`);

    this.emit(`br label %${checkLabel}`);

    this.emit(`${checkLabel}:`);
    const counter = this.nextTemp();
    this.emit(`${counter} = load i32, i32* ${counterPtr}`);
    const cond = this.nextTemp();
    this.emit(`${cond} = icmp slt i32 ${counter}, ${length}`);
    this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

    this.emit(`${bodyLabel}:`);

    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${counter}`);
    const elem = this.nextTemp();
    this.emit(`${elem} = load double, double* ${elemPtr}`);

    const predicateResult = this.nextTemp();
    this.emit(`${predicateResult} = call double @${predicateFn}(double ${elem})`);

    const isFalsy = this.nextTemp();
    this.emit(`${isFalsy} = fcmp oeq double ${predicateResult}, 0.0`);
    this.emit(`br i1 ${isFalsy}, label %${failedLabel}, label %${loopLabel}`);

    this.emit(`${failedLabel}:`);
    this.emit(`store i32 0, i32* ${resultPtr}`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${loopLabel}:`);
    const nextCounter = this.nextTemp();
    this.emit(`${nextCounter} = add i32 ${counter}, 1`);
    this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
    this.emit(`br label %${checkLabel}`);

    this.emit(`${endLabel}:`);
    const resultI32 = this.nextTemp();
    this.emit(`${resultI32} = load i32, i32* ${resultPtr}`);
    const result = this.nextTemp();
    this.emit(`${result} = sitofp i32 ${resultI32} to double`);
    return result;
  }

  generateArrayFilter(expr: MethodCallNode, params: string[]): string {
    // arr.filter(predicateFn) - returns new array with elements that satisfy predicate
    if (expr.args.length !== 1) {
      throw new Error('filter() requires exactly 1 argument (predicate function)');
    }

    const predicateArg = expr.args[0] as { type: string; name: string };
    let predicateFn: string;

    if (predicateArg.type === 'variable') {
      predicateFn = predicateArg.name;
    } else if (predicateArg.type === 'arrow_function') {
      // Inline function - generate it and get the name
      predicateFn = this.ctx.generateExpression(expr.args[0], params);
    } else {
      throw new Error('filter() argument must be a function name or inline function');
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);

    // Load array length
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    // Load data pointer
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

    // Create new array for result (allocate with same capacity as input)
    const resultArrayPtr = this.nextTemp();
    this.emit(`${resultArrayPtr} = alloca %Array`);

    // Allocate data array on heap - compute size of double dynamically
    const doubleSize = 8;
    const lengthI64 = this.nextTemp();
    this.emit(`${lengthI64} = zext i32 ${length} to i64`);
    const dataSizeI64 = this.nextTemp();
    this.emit(`${dataSizeI64} = mul i64 ${lengthI64}, ${doubleSize}`);
    const dataMem = this.nextTemp();
    this.emit(`${dataMem} = call i8* @GC_malloc_atomic(i64 ${dataSizeI64})`);
    const resultDataPtr = this.nextTemp();
    this.emit(`${resultDataPtr} = bitcast i8* ${dataMem} to double*`);

    // Store data pointer in result array struct
    const resultDataPtrField = this.nextTemp();
    this.emit(`${resultDataPtrField} = getelementptr inbounds %Array, %Array* ${resultArrayPtr}, i32 0, i32 0`);
    this.emit(`store double* ${resultDataPtr}, double** ${resultDataPtrField}`);

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
    this.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${counter}`);
    const elem = this.nextTemp();
    this.emit(`${elem} = load double, double* ${elemPtr}`);

    // Call predicate function
    const predicateResult = this.nextTemp();
    this.emit(`${predicateResult} = call double @${predicateFn}(double ${elem})`);

    // Check if predicate returned truthy
    const isTruthy = this.nextTemp();
    this.emit(`${isTruthy} = fcmp one double ${predicateResult}, 0.0`);
    this.emit(`br i1 ${isTruthy}, label %${addLabel}, label %${loopLabel}`);

    // Add element to result array
    this.emit(`${addLabel}:`);
    const currentLen = this.nextTemp();
    this.emit(`${currentLen} = load i32, i32* ${resultLenField}`);

    const resultElemPtr = this.nextTemp();
    this.emit(`${resultElemPtr} = getelementptr inbounds double, double* ${resultDataPtr}, i32 ${currentLen}`);
    this.emit(`store double ${elem}, double* ${resultElemPtr}`);

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

    const callbackArg = expr.args[0] as { type: string; name: string };
    let callbackFn: string;

    if (callbackArg.type === 'variable') {
      callbackFn = callbackArg.name;
    } else if (callbackArg.type === 'arrow_function') {
      // Inline function - generate it and get the name
      callbackFn = this.ctx.generateExpression(expr.args[0], params);
    } else {
      throw new Error('forEach() argument must be a function name or inline function');
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);
    const arrayMeta = this.loadArrayMeta(arrayPtr) as { length: string; dataPtr: string };
    const length = arrayMeta.length;
    const dataPtr = arrayMeta.dataPtr;

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
    this.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${counter}`);
    const elem = this.nextTemp();
    this.emit(`${elem} = load double, double* ${elemPtr}`);

    // Call callback function (discard return value)
    const callResult = this.nextTemp();
    this.emit(`${callResult} = call double @${callbackFn}(double ${elem})`);

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

    const callbackArg = expr.args[0] as { type: string; name: string };
    let callbackFn: string;

    if (callbackArg.type === 'variable') {
      callbackFn = callbackArg.name;
    } else if (callbackArg.type === 'arrow_function') {
      // Inline function - generate it and get the name
      callbackFn = this.ctx.generateExpression(expr.args[0], params);
    } else {
      throw new Error('map() argument must be a function name or inline function');
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);

    // Load array length
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    // Load data pointer
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

    // Create result array with same length
    const resultArrayPtr = this.nextTemp();
    this.emit(`${resultArrayPtr} = alloca %Array`);

    // Allocate data for result array - compute size of double dynamically
    const doubleSize = 8;
    const lengthI64 = this.nextTemp();
    this.emit(`${lengthI64} = zext i32 ${length} to i64`);
    const resultSizeI64 = this.nextTemp();
    this.emit(`${resultSizeI64} = mul i64 ${lengthI64}, ${doubleSize}`);
    const resultMem = this.nextTemp();
    this.emit(`${resultMem} = call i8* @GC_malloc_atomic(i64 ${resultSizeI64})`);
    const resultDataPtr = this.nextTemp();
    this.emit(`${resultDataPtr} = bitcast i8* ${resultMem} to double*`);

    // Store data pointer in result array struct
    const resultDataPtrField = this.nextTemp();
    this.emit(`${resultDataPtrField} = getelementptr inbounds %Array, %Array* ${resultArrayPtr}, i32 0, i32 0`);
    this.emit(`store double* ${resultDataPtr}, double** ${resultDataPtrField}`);

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
    this.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${counter}`);
    const elem = this.nextTemp();
    this.emit(`${elem} = load double, double* ${elemPtr}`);

    // Call callback function with element
    const result = this.nextTemp();
    this.emit(`${result} = call double @${callbackFn}(double ${elem})`);

    // Store result in result array
    const resultElemPtr = this.nextTemp();
    this.emit(`${resultElemPtr} = getelementptr inbounds double, double* ${resultDataPtr}, i32 ${counter}`);
    this.emit(`store double ${result}, double* ${resultElemPtr}`);

    // Continue loop
    const nextCounter = this.nextTemp();
    this.emit(`${nextCounter} = add i32 ${counter}, 1`);
    this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
    this.emit(`br label %${checkLabel}`);

    // End
    this.emit(`${endLabel}:`);
    return resultArrayPtr;
  }

  generateArrayIncludes(expr: MethodCallNode, params: string[]): string {
    // arr.includes(value) - returns 1 if array contains value, 0 otherwise
    if (expr.args.length !== 1) {
      throw new Error('includes() requires exactly 1 argument');
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);
    const searchValue = this.ctx.generateExpression(expr.args[0], params);

    // Determine if this is a string array or number array
    let isStringArray = false;
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === 'variable') {
      const varName = (expr.object as VariableNode).name;
      const varType = this.ctx.getVariableType(varName);
      isStringArray = varType === '%StringArray*';
    } else {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      isStringArray = ptrType === '%StringArray*';
    }

    if (isStringArray) {
      return this.generateStringArrayIncludes(arrayPtr, searchValue);
    } else {
      return this.generateIntArrayIncludes(arrayPtr, searchValue);
    }
  }

  private generateIntArrayIncludes(arrayPtr: string, searchValue: string): string {
    // Search in %Array (int/boolean array)

    // Load array length
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    // Load data pointer
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

    // Loop setup
    const loopLabel = this.nextLabel('includes_loop');
    const checkLabel = this.nextLabel('includes_check');
    const bodyLabel = this.nextLabel('includes_body');
    const foundLabel = this.nextLabel('includes_found');
    const endLabel = this.nextLabel('includes_end');

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
    this.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${counter}`);
    const elem = this.nextTemp();
    this.emit(`${elem} = load double, double* ${elemPtr}`);

    // Compare with search value
    const isEqual = this.nextTemp();
    this.emit(`${isEqual} = fcmp oeq double ${elem}, ${searchValue}`);
    this.emit(`br i1 ${isEqual}, label %${foundLabel}, label %${loopLabel}`);

    // Found - return 1
    this.emit(`${foundLabel}:`);
    this.emit(`br label %${endLabel}`);

    // Continue loop
    this.emit(`${loopLabel}:`);
    const nextCounter = this.nextTemp();
    this.emit(`${nextCounter} = add i32 ${counter}, 1`);
    this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
    this.emit(`br label %${checkLabel}`);

    // End - phi node to select result (0 if not found, 1 if found)
    this.emit(`${endLabel}:`);
    const resultI32 = this.nextTemp();
    this.emit(`${resultI32} = phi i32 [ 0, %${checkLabel} ], [ 1, %${foundLabel} ]`);

    // Convert to double for compatibility
    const result = this.nextTemp();
    this.emit(`${result} = sitofp i32 ${resultI32} to double`);

    return result;
  }

  private generateStringArrayIncludes(arrayPtr: string, searchValue: string): string {
    // Search in %StringArray (string array)

    // Load array length
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    // Load data pointer
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);

    // Loop setup
    const loopLabel = this.nextLabel('includes_loop');
    const checkLabel = this.nextLabel('includes_check');
    const bodyLabel = this.nextLabel('includes_body');
    const foundLabel = this.nextLabel('includes_found');
    const endLabel = this.nextLabel('includes_end');

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
    this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${counter}`);
    const elem = this.nextTemp();
    this.emit(`${elem} = load i8*, i8** ${elemPtr}`);

    // Compare strings using strcmp
    const cmpResult = this.nextTemp();
    this.emit(`${cmpResult} = call i32 @strcmp(i8* ${elem}, i8* ${searchValue})`);
    const isEqual = this.nextTemp();
    this.emit(`${isEqual} = icmp eq i32 ${cmpResult}, 0`);
    this.emit(`br i1 ${isEqual}, label %${foundLabel}, label %${loopLabel}`);

    // Found - return 1
    this.emit(`${foundLabel}:`);
    this.emit(`br label %${endLabel}`);

    // Continue loop
    this.emit(`${loopLabel}:`);
    const nextCounter = this.nextTemp();
    this.emit(`${nextCounter} = add i32 ${counter}, 1`);
    this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
    this.emit(`br label %${checkLabel}`);

    // End - phi node to select result (0 if not found, 1 if found)
    this.emit(`${endLabel}:`);
    const resultI32 = this.nextTemp();
    this.emit(`${resultI32} = phi i32 [ 0, %${checkLabel} ], [ 1, %${foundLabel} ]`);

    // Convert to double for compatibility
    const result = this.nextTemp();
    this.emit(`${result} = sitofp i32 ${resultI32} to double`);

    return result;
  }

  generateArrayJoin(expr: MethodCallNode, params: string[]): string {
    // arr.join(separator) - returns a string (i8*)
    // For simplicity, we'll implement join with a string separator
    if (expr.args.length !== 1) {
      throw new Error('join() requires exactly 1 argument (separator)');
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);
    const separator = this.ctx.generateExpression(expr.args[0], params);

    // Get array length
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    // Get data pointer
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

    // For simplicity, we'll allocate a fixed-size buffer for the result
    // In a real implementation, we'd calculate the exact size needed
    const bufferSize = 1024; // Fixed size for demo
    const resultBuffer = this.nextTemp();
    this.emit(`${resultBuffer} = call i8* @GC_malloc_atomic(i64 ${bufferSize})`);

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

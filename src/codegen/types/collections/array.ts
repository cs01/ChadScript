import { Expression, MethodCallNode, VariableNode } from '../../../ast/types.js';

interface ExprBase { type: string; }

import { IGeneratorContext } from '../../infrastructure/generator-context.js';
import { generateArrayLiteral } from './array/literal.js';
import { generateArrayPush, generateArrayPop } from './array/mutators.js';

export class ArrayGenerator {
  constructor(private ctx: IGeneratorContext) {}

  private nextTemp(): string { return this.ctx.nextTemp(); }
  private nextLabel(prefix: string): string { return this.ctx.nextLabel(prefix); }
  private emit(instruction: string): void { this.ctx.emit(instruction); }

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
    if (expr.args.length !== 1) {
      throw new Error('find() requires exactly 1 argument (predicate function)');
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);

    let isStringArray = false;
    let isObjectArray = false;
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === 'variable') {
      const varName = (expr.object as VariableNode).name;
      const varType = this.ctx.getVariableType(varName);
      isStringArray = varType === '%StringArray*';
      isObjectArray = this.ctx.symbolTable.isObjectArray(varName);
    } else if (exprObjBase.type === 'member_access') {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      isStringArray = ptrType === '%StringArray*';
      if (!isStringArray && ptrType && ptrType.indexOf('*') !== -1 && ptrType !== '%Array*') {
        isObjectArray = true;
      }
    } else {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      isStringArray = ptrType === '%StringArray*';
    }

    const predicateArg = expr.args[0];
    let predicateFn: string;

    if (predicateArg.type === 'variable') {
      predicateFn = (predicateArg as VariableNode).name;
    } else if (predicateArg.type === 'arrow_function') {
      if (isStringArray || isObjectArray) {
        this.ctx.expectedCallbackParamType = 'string';
      }
      predicateFn = this.ctx.generateExpression(predicateArg, params);
      this.ctx.expectedCallbackParamType = null;
    } else {
      throw new Error('find() argument must be a function name or inline function');
    }

    if (isStringArray || isObjectArray) {
      return this.generateStringArrayFind(arrayPtr, predicateFn);
    }
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

  private generateStringArrayFind(arrayPtr: string, predicateFn: string): string {
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);

    const loopLabel = this.nextLabel('find_loop');
    const checkLabel = this.nextLabel('find_check');
    const bodyLabel = this.nextLabel('find_body');
    const foundLabel = this.nextLabel('find_found');
    const endLabel = this.nextLabel('find_end');

    const counterPtr = this.nextTemp();
    this.emit(`${counterPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${counterPtr}`);

    const resultPtr = this.nextTemp();
    this.emit(`${resultPtr} = alloca i8*`);
    this.emit(`store i8* null, i8** ${resultPtr}`);

    this.emit(`br label %${checkLabel}`);

    this.emit(`${checkLabel}:`);
    const counter = this.nextTemp();
    this.emit(`${counter} = load i32, i32* ${counterPtr}`);
    const cond = this.nextTemp();
    this.emit(`${cond} = icmp slt i32 ${counter}, ${length}`);
    this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

    this.emit(`${bodyLabel}:`);

    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${counter}`);
    const elem = this.nextTemp();
    this.emit(`${elem} = load i8*, i8** ${elemPtr}`);

    const predicateResult = this.nextTemp();
    this.emit(`${predicateResult} = call double @${predicateFn}(i8* ${elem})`);

    const isTruthy = this.nextTemp();
    this.emit(`${isTruthy} = fcmp one double ${predicateResult}, 0.0`);
    this.emit(`br i1 ${isTruthy}, label %${foundLabel}, label %${loopLabel}`);

    this.emit(`${foundLabel}:`);
    this.emit(`store i8* ${elem}, i8** ${resultPtr}`);
    this.emit(`br label %${endLabel}`);

    this.emit(`${loopLabel}:`);
    const nextCounter = this.nextTemp();
    this.emit(`${nextCounter} = add i32 ${counter}, 1`);
    this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
    this.emit(`br label %${checkLabel}`);

    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = load i8*, i8** ${resultPtr}`);
    this.ctx.setVariableType(result, 'i8*');
    return result;
  }

  generateArraySome(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error('some() requires exactly 1 argument (predicate function)');
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);

    let isStringArray = false;
    let isObjectArray = false;
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === 'variable') {
      const varName = (expr.object as VariableNode).name;
      const varType = this.ctx.getVariableType(varName);
      isStringArray = varType === '%StringArray*';
      isObjectArray = this.ctx.symbolTable.isObjectArray(varName);
    } else if (exprObjBase.type === 'member_access') {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      isStringArray = ptrType === '%StringArray*';
      if (!isStringArray && ptrType && ptrType.indexOf('*') !== -1 && ptrType !== '%Array*') {
        isObjectArray = true;
      }
    } else {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      isStringArray = ptrType === '%StringArray*';
    }

    const predicateArg = expr.args[0];
    let predicateFn: string;

    if (predicateArg.type === 'variable') {
      predicateFn = (predicateArg as VariableNode).name;
    } else if (predicateArg.type === 'arrow_function') {
      if (isStringArray || isObjectArray) {
        this.ctx.expectedCallbackParamType = 'string';
      }
      predicateFn = this.ctx.generateExpression(predicateArg, params);
      this.ctx.expectedCallbackParamType = null;
    } else {
      throw new Error('some() argument must be a function name or inline function');
    }

    if (isStringArray || isObjectArray) {
      return this.generateStringArraySome(arrayPtr, predicateFn);
    }

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

  private generateStringArraySome(arrayPtr: string, predicateFn: string): string {
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);

    const loopLabel = this.nextLabel('some_loop');
    const checkLabel = this.nextLabel('some_check');
    const bodyLabel = this.nextLabel('some_body');
    const foundLabel = this.nextLabel('some_found');
    const endLabel = this.nextLabel('some_end');

    const counterPtr = this.nextTemp();
    this.emit(`${counterPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${counterPtr}`);

    const resultPtr = this.nextTemp();
    this.emit(`${resultPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${resultPtr}`);

    this.emit(`br label %${checkLabel}`);

    this.emit(`${checkLabel}:`);
    const counter = this.nextTemp();
    this.emit(`${counter} = load i32, i32* ${counterPtr}`);
    const cond = this.nextTemp();
    this.emit(`${cond} = icmp slt i32 ${counter}, ${length}`);
    this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

    this.emit(`${bodyLabel}:`);

    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${counter}`);
    const elem = this.nextTemp();
    this.emit(`${elem} = load i8*, i8** ${elemPtr}`);

    const predicateResult = this.nextTemp();
    this.emit(`${predicateResult} = call double @${predicateFn}(i8* ${elem})`);

    const isTruthy = this.nextTemp();
    this.emit(`${isTruthy} = fcmp one double ${predicateResult}, 0.0`);
    this.emit(`br i1 ${isTruthy}, label %${foundLabel}, label %${loopLabel}`);

    this.emit(`${foundLabel}:`);
    this.emit(`store i32 1, i32* ${resultPtr}`);
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

  generateArrayEvery(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error('every() requires exactly 1 argument (predicate function)');
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);

    let isStringArray = false;
    let isObjectArray = false;
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === 'variable') {
      const varName = (expr.object as VariableNode).name;
      const varType = this.ctx.getVariableType(varName);
      isStringArray = varType === '%StringArray*';
      isObjectArray = this.ctx.symbolTable.isObjectArray(varName);
    } else if (exprObjBase.type === 'member_access') {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      isStringArray = ptrType === '%StringArray*';
      if (!isStringArray && ptrType && ptrType.indexOf('*') !== -1 && ptrType !== '%Array*') {
        isObjectArray = true;
      }
    } else {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      isStringArray = ptrType === '%StringArray*';
    }

    const predicateArg = expr.args[0];
    let predicateFn: string;

    if (predicateArg.type === 'variable') {
      predicateFn = (predicateArg as VariableNode).name;
    } else if (predicateArg.type === 'arrow_function') {
      if (isStringArray || isObjectArray) {
        this.ctx.expectedCallbackParamType = 'string';
      }
      predicateFn = this.ctx.generateExpression(predicateArg, params);
      this.ctx.expectedCallbackParamType = null;
    } else {
      throw new Error('every() argument must be a function name or inline function');
    }

    if (isStringArray || isObjectArray) {
      return this.generateStringArrayEvery(arrayPtr, predicateFn);
    }

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

  private generateStringArrayEvery(arrayPtr: string, predicateFn: string): string {
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);

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
    this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${counter}`);
    const elem = this.nextTemp();
    this.emit(`${elem} = load i8*, i8** ${elemPtr}`);

    const predicateResult = this.nextTemp();
    this.emit(`${predicateResult} = call double @${predicateFn}(i8* ${elem})`);

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
    if (expr.args.length !== 1) {
      throw new Error('filter() requires exactly 1 argument (predicate function)');
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);

    let isStringArray = false;
    let isObjectArray = false;
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === 'variable') {
      const varName = (expr.object as VariableNode).name;
      const varType = this.ctx.getVariableType(varName);
      isStringArray = varType === '%StringArray*';
      isObjectArray = this.ctx.symbolTable.isObjectArray(varName);
    } else if (exprObjBase.type === 'member_access') {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      isStringArray = ptrType === '%StringArray*';
      if (!isStringArray && ptrType && ptrType.indexOf('*') !== -1 && ptrType !== '%Array*') {
        isObjectArray = true;
      }
    } else {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      isStringArray = ptrType === '%StringArray*';
    }

    const predicateArg = expr.args[0];
    let predicateFn: string;

    if (predicateArg.type === 'variable') {
      predicateFn = (predicateArg as VariableNode).name;
    } else if (predicateArg.type === 'arrow_function') {
      if (isStringArray || isObjectArray) {
        this.ctx.expectedCallbackParamType = 'string';
      }
      predicateFn = this.ctx.generateExpression(predicateArg, params);
      this.ctx.expectedCallbackParamType = null;
    } else {
      throw new Error('filter() argument must be a function name or inline function');
    }

    if (isStringArray || isObjectArray) {
      return this.generateStringArrayFilter(arrayPtr, predicateFn);
    }

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

  private generateStringArrayFilter(arrayPtr: string, predicateFn: string): string {
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);

    const resultArrayPtr = this.nextTemp();
    this.emit(`${resultArrayPtr} = alloca %StringArray`);

    const ptrSize = 8;
    const lengthI64 = this.nextTemp();
    this.emit(`${lengthI64} = zext i32 ${length} to i64`);
    const dataSizeI64 = this.nextTemp();
    this.emit(`${dataSizeI64} = mul i64 ${lengthI64}, ${ptrSize}`);
    const dataMem = this.nextTemp();
    this.emit(`${dataMem} = call i8* @GC_malloc(i64 ${dataSizeI64})`);
    const resultDataPtr = this.nextTemp();
    this.emit(`${resultDataPtr} = bitcast i8* ${dataMem} to i8**`);

    const resultDataPtrField = this.nextTemp();
    this.emit(`${resultDataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${resultArrayPtr}, i32 0, i32 0`);
    this.emit(`store i8** ${resultDataPtr}, i8*** ${resultDataPtrField}`);

    const resultLenField = this.nextTemp();
    this.emit(`${resultLenField} = getelementptr inbounds %StringArray, %StringArray* ${resultArrayPtr}, i32 0, i32 1`);
    this.emit(`store i32 0, i32* ${resultLenField}`);

    const resultCapField = this.nextTemp();
    this.emit(`${resultCapField} = getelementptr inbounds %StringArray, %StringArray* ${resultArrayPtr}, i32 0, i32 2`);
    this.emit(`store i32 ${length}, i32* ${resultCapField}`);

    const loopLabel = this.nextLabel('filter_loop');
    const checkLabel = this.nextLabel('filter_check');
    const bodyLabel = this.nextLabel('filter_body');
    const addLabel = this.nextLabel('filter_add');
    const endLabel = this.nextLabel('filter_end');

    const counterPtr = this.nextTemp();
    this.emit(`${counterPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${counterPtr}`);

    this.emit(`br label %${checkLabel}`);

    this.emit(`${checkLabel}:`);
    const counter = this.nextTemp();
    this.emit(`${counter} = load i32, i32* ${counterPtr}`);
    const cond = this.nextTemp();
    this.emit(`${cond} = icmp slt i32 ${counter}, ${length}`);
    this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

    this.emit(`${bodyLabel}:`);

    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${counter}`);
    const elem = this.nextTemp();
    this.emit(`${elem} = load i8*, i8** ${elemPtr}`);

    const predicateResult = this.nextTemp();
    this.emit(`${predicateResult} = call double @${predicateFn}(i8* ${elem})`);

    const isTruthy = this.nextTemp();
    this.emit(`${isTruthy} = fcmp one double ${predicateResult}, 0.0`);
    this.emit(`br i1 ${isTruthy}, label %${addLabel}, label %${loopLabel}`);

    this.emit(`${addLabel}:`);
    const currentLen = this.nextTemp();
    this.emit(`${currentLen} = load i32, i32* ${resultLenField}`);

    const resultElemPtr = this.nextTemp();
    this.emit(`${resultElemPtr} = getelementptr inbounds i8*, i8** ${resultDataPtr}, i32 ${currentLen}`);
    this.emit(`store i8* ${elem}, i8** ${resultElemPtr}`);

    const newLen = this.nextTemp();
    this.emit(`${newLen} = add i32 ${currentLen}, 1`);
    this.emit(`store i32 ${newLen}, i32* ${resultLenField}`);
    this.emit(`br label %${loopLabel}`);

    this.emit(`${loopLabel}:`);
    const nextCounter = this.nextTemp();
    this.emit(`${nextCounter} = add i32 ${counter}, 1`);
    this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
    this.emit(`br label %${checkLabel}`);

    this.emit(`${endLabel}:`);
    this.ctx.setVariableType(resultArrayPtr, '%StringArray*');
    return resultArrayPtr;
  }

  generateArrayForEach(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error('forEach() requires exactly 1 argument (callback function)');
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);

    let isStringArray = false;
    let isObjectArray = false;
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === 'variable') {
      const varName = (expr.object as VariableNode).name;
      const varType = this.ctx.getVariableType(varName);
      isStringArray = varType === '%StringArray*';
      isObjectArray = this.ctx.symbolTable.isObjectArray(varName);
    } else if (exprObjBase.type === 'member_access') {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      isStringArray = ptrType === '%StringArray*';
      if (!isStringArray && ptrType && ptrType.indexOf('*') !== -1 && ptrType !== '%Array*') {
        isObjectArray = true;
      }
    } else {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      isStringArray = ptrType === '%StringArray*';
    }

    const callbackArg = expr.args[0];
    let callbackFn: string;

    if (callbackArg.type === 'variable') {
      callbackFn = (callbackArg as VariableNode).name;
    } else if (callbackArg.type === 'arrow_function') {
      if (isStringArray || isObjectArray) {
        this.ctx.expectedCallbackParamType = 'string';
      }
      callbackFn = this.ctx.generateExpression(callbackArg, params);
      this.ctx.expectedCallbackParamType = null;
    } else {
      throw new Error('forEach() argument must be a function name or inline function');
    }

    if (isStringArray || isObjectArray) {
      return this.generateStringArrayForEach(arrayPtr, callbackFn);
    }

    const arrayMeta = this.loadArrayMeta(arrayPtr) as { length: string; dataPtr: string };
    const length = arrayMeta.length;
    const dataPtr = arrayMeta.dataPtr;

    // Loop setup
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

  private generateStringArrayForEach(arrayPtr: string, callbackFn: string): string {
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);

    const checkLabel = this.nextLabel('foreach_check');
    const bodyLabel = this.nextLabel('foreach_body');
    const endLabel = this.nextLabel('foreach_end');

    const counterPtr = this.nextTemp();
    this.emit(`${counterPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${counterPtr}`);

    this.emit(`br label %${checkLabel}`);

    this.emit(`${checkLabel}:`);
    const counter = this.nextTemp();
    this.emit(`${counter} = load i32, i32* ${counterPtr}`);
    const cond = this.nextTemp();
    this.emit(`${cond} = icmp slt i32 ${counter}, ${length}`);
    this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

    this.emit(`${bodyLabel}:`);

    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${counter}`);
    const elem = this.nextTemp();
    this.emit(`${elem} = load i8*, i8** ${elemPtr}`);

    const callResult = this.nextTemp();
    this.emit(`${callResult} = call double @${callbackFn}(i8* ${elem})`);

    const nextCounter = this.nextTemp();
    this.emit(`${nextCounter} = add i32 ${counter}, 1`);
    this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
    this.emit(`br label %${checkLabel}`);

    this.emit(`${endLabel}:`);
    return '0';
  }

  generateArrayMap(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error('map() requires exactly 1 argument (callback function)');
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);

    let isStringArray = false;
    let isObjectArray = false;
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === 'variable') {
      const varName = (expr.object as VariableNode).name;
      const varType = this.ctx.getVariableType(varName);
      isStringArray = varType === '%StringArray*';
      isObjectArray = this.ctx.symbolTable.isObjectArray(varName);
    } else if (exprObjBase.type === 'member_access') {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      isStringArray = ptrType === '%StringArray*';
      if (!isStringArray && ptrType && ptrType.indexOf('*') !== -1 && ptrType !== '%Array*') {
        isObjectArray = true;
      }
    } else {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      isStringArray = ptrType === '%StringArray*';
    }

    const callbackArg = expr.args[0];
    let callbackFn: string;

    if (callbackArg.type === 'variable') {
      callbackFn = (callbackArg as VariableNode).name;
    } else if (callbackArg.type === 'arrow_function') {
      if (isStringArray || isObjectArray) {
        this.ctx.expectedCallbackParamType = 'string';
      }
      callbackFn = this.ctx.generateExpression(callbackArg, params);
      this.ctx.expectedCallbackParamType = null;
    } else {
      throw new Error('map() argument must be a function name or inline function');
    }

    if (isStringArray || isObjectArray) {
      return this.generateStringArrayMap(expr, params);
    }

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
    if (expr.args.length !== 1) {
      throw new Error('join() requires exactly 1 argument (separator)');
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);
    const separator = this.ctx.generateExpression(expr.args[0], params);

    let isStringArray = false;
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === 'variable') {
      const varName = (expr.object as VariableNode).name;
      const varType = this.ctx.getVariableType(varName);
      isStringArray = varType === '%StringArray*';
    } else if (exprObjBase.type === 'member_access') {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      isStringArray = ptrType === '%StringArray*';
    } else {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      isStringArray = ptrType === '%StringArray*';
    }

    if (isStringArray) {
      return this.generateStringArrayJoin(arrayPtr, separator);
    }

    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

    const bufferSize = 8192;
    const resultBuffer = this.nextTemp();
    this.emit(`${resultBuffer} = call i8* @GC_malloc_atomic(i64 ${bufferSize})`);

    const nullByte = this.nextTemp();
    this.emit(`${nullByte} = getelementptr inbounds i8, i8* ${resultBuffer}, i64 0`);
    this.emit(`store i8 0, i8* ${nullByte}`);

    this.ctx.setVariableType(resultBuffer, 'i8*');
    return resultBuffer;
  }

  private generateStringArrayJoin(arrayPtr: string, separator: string): string {
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);

    const bufferSize = 65536;
    const resultBuffer = this.nextTemp();
    this.emit(`${resultBuffer} = call i8* @GC_malloc_atomic(i64 ${bufferSize})`);

    const nullByte = this.nextTemp();
    this.emit(`${nullByte} = getelementptr inbounds i8, i8* ${resultBuffer}, i64 0`);
    this.emit(`store i8 0, i8* ${nullByte}`);

    const checkLabel = this.nextLabel('join_check');
    const bodyLabel = this.nextLabel('join_body');
    const endLabel = this.nextLabel('join_end');

    const counterPtr = this.ctx.nextAllocaReg('join_idx');
    this.emit(`${counterPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${counterPtr}`);

    this.emit(`br label %${checkLabel}`);

    this.emit(`${checkLabel}:`);
    const counter = this.nextTemp();
    this.emit(`${counter} = load i32, i32* ${counterPtr}`);
    const cond = this.nextTemp();
    this.emit(`${cond} = icmp slt i32 ${counter}, ${length}`);
    this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

    this.emit(`${bodyLabel}:`);

    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${counter}`);
    const elem = this.nextTemp();
    this.emit(`${elem} = load i8*, i8** ${elemPtr}`);

    const isNotFirst = this.nextTemp();
    this.emit(`${isNotFirst} = icmp sgt i32 ${counter}, 0`);
    const addSepLabel = this.nextLabel('join_add_sep');
    const afterSepLabel = this.nextLabel('join_after_sep');
    this.emit(`br i1 ${isNotFirst}, label %${addSepLabel}, label %${afterSepLabel}`);

    this.emit(`${addSepLabel}:`);
    const strcat1 = this.nextTemp();
    this.emit(`${strcat1} = call i8* @strcat(i8* ${resultBuffer}, i8* ${separator})`);
    this.emit(`br label %${afterSepLabel}`);

    this.emit(`${afterSepLabel}:`);
    const strcat2 = this.nextTemp();
    this.emit(`${strcat2} = call i8* @strcat(i8* ${resultBuffer}, i8* ${elem})`);

    const nextCounter = this.nextTemp();
    this.emit(`${nextCounter} = add i32 ${counter}, 1`);
    this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
    this.emit(`br label %${checkLabel}`);

    this.emit(`${endLabel}:`);
    this.ctx.setVariableType(resultBuffer, 'i8*');
    return resultBuffer;
  }

  generateStringArrayMap(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error('map() requires exactly 1 argument (callback function)');
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);

    const callbackArg = expr.args[0];
    let callbackFn: string;

    if (callbackArg.type === 'variable') {
      callbackFn = (callbackArg as VariableNode).name;
    } else if (callbackArg.type === 'arrow_function') {
      this.ctx.expectedCallbackParamType = 'string';
      this.ctx.expectedCallbackReturnType = 'string';
      callbackFn = this.ctx.generateExpression(callbackArg, params);
      this.ctx.expectedCallbackParamType = null;
      this.ctx.expectedCallbackReturnType = null;
    } else {
      throw new Error('map() argument must be a function name or inline function');
    }

    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);

    const resultArrayPtr = this.nextTemp();
    this.emit(`${resultArrayPtr} = alloca %StringArray`);

    const pointerSize = 8;
    const lengthI64 = this.nextTemp();
    this.emit(`${lengthI64} = zext i32 ${length} to i64`);
    const resultSizeI64 = this.nextTemp();
    this.emit(`${resultSizeI64} = mul i64 ${lengthI64}, ${pointerSize}`);
    const resultMem = this.nextTemp();
    this.emit(`${resultMem} = call i8* @GC_malloc(i64 ${resultSizeI64})`);
    const resultDataPtr = this.nextTemp();
    this.emit(`${resultDataPtr} = bitcast i8* ${resultMem} to i8**`);

    const resultDataPtrField = this.nextTemp();
    this.emit(`${resultDataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${resultArrayPtr}, i32 0, i32 0`);
    this.emit(`store i8** ${resultDataPtr}, i8*** ${resultDataPtrField}`);

    const resultLenField = this.nextTemp();
    this.emit(`${resultLenField} = getelementptr inbounds %StringArray, %StringArray* ${resultArrayPtr}, i32 0, i32 1`);
    this.emit(`store i32 ${length}, i32* ${resultLenField}`);

    const resultCapField = this.nextTemp();
    this.emit(`${resultCapField} = getelementptr inbounds %StringArray, %StringArray* ${resultArrayPtr}, i32 0, i32 2`);
    this.emit(`store i32 ${length}, i32* ${resultCapField}`);

    const counterPtr = this.nextTemp();
    this.emit(`${counterPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${counterPtr}`);

    const checkLabel = this.nextLabel('strmap_check');
    const bodyLabel = this.nextLabel('strmap_body');
    const endLabel = this.nextLabel('strmap_end');

    this.emit(`br label %${checkLabel}`);

    this.emit(`${checkLabel}:`);
    const counter = this.nextTemp();
    this.emit(`${counter} = load i32, i32* ${counterPtr}`);
    const cond = this.nextTemp();
    this.emit(`${cond} = icmp slt i32 ${counter}, ${length}`);
    this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

    this.emit(`${bodyLabel}:`);

    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${counter}`);
    const elem = this.nextTemp();
    this.emit(`${elem} = load i8*, i8** ${elemPtr}`);

    const result = this.nextTemp();
    this.emit(`${result} = call i8* @${callbackFn}(i8* ${elem})`);

    const resultElemPtr = this.nextTemp();
    this.emit(`${resultElemPtr} = getelementptr inbounds i8*, i8** ${resultDataPtr}, i32 ${counter}`);
    this.emit(`store i8* ${result}, i8** ${resultElemPtr}`);

    const nextCounter = this.nextTemp();
    this.emit(`${nextCounter} = add i32 ${counter}, 1`);
    this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
    this.emit(`br label %${checkLabel}`);

    this.emit(`${endLabel}:`);
    this.ctx.setVariableType(resultArrayPtr, '%StringArray*');
    return resultArrayPtr;
  }

  generateArraySlice(expr: MethodCallNode, params: string[]): string {
    const arrayPtr = this.ctx.generateExpression(expr.object, params);

    let isStringArray = false;
    let isObjectArray = false;
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === 'variable') {
      const varName = (expr.object as VariableNode).name;
      const varType = this.ctx.getVariableType(varName);
      isStringArray = varType === '%StringArray*';
      isObjectArray = this.ctx.symbolTable.isObjectArray(varName);
    } else if (exprObjBase.type === 'member_access') {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      isStringArray = ptrType === '%StringArray*';
      if (!isStringArray && ptrType && ptrType.indexOf('*') !== -1 && ptrType !== '%Array*') {
        isObjectArray = true;
      }
    } else {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      isStringArray = ptrType === '%StringArray*';
    }

    if (isStringArray || isObjectArray) {
      return this.generateStringArraySlice(arrayPtr, expr, params, isObjectArray);
    }

    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);

    let startI32 = '0';
    if (expr.args.length >= 1) {
      const startDouble = this.ctx.generateExpression(expr.args[0], params);
      startI32 = this.nextTemp();
      this.emit(`${startI32} = fptosi double ${startDouble} to i32`);
    }

    let endI32 = length;
    if (expr.args.length >= 2) {
      const endDouble = this.ctx.generateExpression(expr.args[1], params);
      endI32 = this.nextTemp();
      this.emit(`${endI32} = fptosi double ${endDouble} to i32`);
    }

    const sliceLen = this.nextTemp();
    this.emit(`${sliceLen} = sub i32 ${endI32}, ${startI32}`);

    const sizePtr = this.nextTemp();
    this.emit(`${sizePtr} = getelementptr %Array, %Array* null, i32 1`);
    const structSize = this.nextTemp();
    this.emit(`${structSize} = ptrtoint %Array* ${sizePtr} to i64`);
    const arrayMem = this.nextTemp();
    this.emit(`${arrayMem} = call i8* @GC_malloc(i64 ${structSize})`);
    const newArrayPtr = this.nextTemp();
    this.emit(`${newArrayPtr} = bitcast i8* ${arrayMem} to %Array*`);

    const sliceLenI64 = this.nextTemp();
    this.emit(`${sliceLenI64} = zext i32 ${sliceLen} to i64`);
    const dataSize = this.nextTemp();
    this.emit(`${dataSize} = mul i64 ${sliceLenI64}, 8`);
    const dataMem = this.nextTemp();
    this.emit(`${dataMem} = call i8* @GC_malloc_atomic(i64 ${dataSize})`);
    const newDataPtr = this.nextTemp();
    this.emit(`${newDataPtr} = bitcast i8* ${dataMem} to double*`);

    const srcStartPtr = this.nextTemp();
    this.emit(`${srcStartPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${startI32}`);
    const srcCast = this.nextTemp();
    this.emit(`${srcCast} = bitcast double* ${srcStartPtr} to i8*`);
    const dstCast = this.nextTemp();
    this.emit(`${dstCast} = bitcast double* ${newDataPtr} to i8*`);
    this.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${dstCast}, i8* ${srcCast}, i64 ${dataSize}, i1 false)`);

    const newDataField = this.nextTemp();
    this.emit(`${newDataField} = getelementptr inbounds %Array, %Array* ${newArrayPtr}, i32 0, i32 0`);
    this.emit(`store double* ${newDataPtr}, double** ${newDataField}`);

    const newLenField = this.nextTemp();
    this.emit(`${newLenField} = getelementptr inbounds %Array, %Array* ${newArrayPtr}, i32 0, i32 1`);
    this.emit(`store i32 ${sliceLen}, i32* ${newLenField}`);

    const newCapField = this.nextTemp();
    this.emit(`${newCapField} = getelementptr inbounds %Array, %Array* ${newArrayPtr}, i32 0, i32 2`);
    this.emit(`store i32 ${sliceLen}, i32* ${newCapField}`);

    this.ctx.setVariableType(newArrayPtr, '%Array*');
    return newArrayPtr;
  }

  private generateStringArraySlice(arrayPtr: string, expr: MethodCallNode, params: string[], isObjectArray: boolean = false): string {
    const arrType = isObjectArray ? '%ObjectArray' : '%StringArray';
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds ${arrType}, ${arrType}* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds ${arrType}, ${arrType}* ${arrayPtr}, i32 0, i32 0`);
    let dataPtr: string;
    if (isObjectArray) {
      const rawDataPtr = this.nextTemp();
      this.emit(`${rawDataPtr} = load i8*, i8** ${dataPtrField}`);
      dataPtr = this.nextTemp();
      this.emit(`${dataPtr} = bitcast i8* ${rawDataPtr} to i8**`);
    } else {
      dataPtr = this.nextTemp();
      this.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);
    }

    let startI32 = '0';
    if (expr.args.length >= 1) {
      const startDouble = this.ctx.generateExpression(expr.args[0], params);
      startI32 = this.nextTemp();
      this.emit(`${startI32} = fptosi double ${startDouble} to i32`);
    }

    let endI32 = length;
    if (expr.args.length >= 2) {
      const endDouble = this.ctx.generateExpression(expr.args[1], params);
      endI32 = this.nextTemp();
      this.emit(`${endI32} = fptosi double ${endDouble} to i32`);
    }

    const sliceLen = this.nextTemp();
    this.emit(`${sliceLen} = sub i32 ${endI32}, ${startI32}`);

    const sizePtr = this.nextTemp();
    this.emit(`${sizePtr} = getelementptr ${arrType}, ${arrType}* null, i32 1`);
    const structSize = this.nextTemp();
    this.emit(`${structSize} = ptrtoint ${arrType}* ${sizePtr} to i64`);
    const arrayMem = this.nextTemp();
    this.emit(`${arrayMem} = call i8* @GC_malloc(i64 ${structSize})`);
    const newArrayPtr = this.nextTemp();
    this.emit(`${newArrayPtr} = bitcast i8* ${arrayMem} to ${arrType}*`);

    const sliceLenI64 = this.nextTemp();
    this.emit(`${sliceLenI64} = zext i32 ${sliceLen} to i64`);
    const dataSize = this.nextTemp();
    this.emit(`${dataSize} = mul i64 ${sliceLenI64}, 8`);
    const dataMem = this.nextTemp();
    this.emit(`${dataMem} = call i8* @GC_malloc(i64 ${dataSize})`);
    const newDataPtr = this.nextTemp();
    this.emit(`${newDataPtr} = bitcast i8* ${dataMem} to i8**`);

    const srcStartPtr = this.nextTemp();
    this.emit(`${srcStartPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${startI32}`);
    const srcCast = this.nextTemp();
    this.emit(`${srcCast} = bitcast i8** ${srcStartPtr} to i8*`);
    const dstCast = this.nextTemp();
    this.emit(`${dstCast} = bitcast i8** ${newDataPtr} to i8*`);
    this.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${dstCast}, i8* ${srcCast}, i64 ${dataSize}, i1 false)`);

    const newDataField = this.nextTemp();
    this.emit(`${newDataField} = getelementptr inbounds ${arrType}, ${arrType}* ${newArrayPtr}, i32 0, i32 0`);
    if (isObjectArray) {
      const dataAsi8 = this.nextTemp();
      this.emit(`${dataAsi8} = bitcast i8** ${newDataPtr} to i8*`);
      this.emit(`store i8* ${dataAsi8}, i8** ${newDataField}`);
    } else {
      this.emit(`store i8** ${newDataPtr}, i8*** ${newDataField}`);
    }

    const newLenField = this.nextTemp();
    this.emit(`${newLenField} = getelementptr inbounds ${arrType}, ${arrType}* ${newArrayPtr}, i32 0, i32 1`);
    this.emit(`store i32 ${sliceLen}, i32* ${newLenField}`);

    const newCapField = this.nextTemp();
    this.emit(`${newCapField} = getelementptr inbounds ${arrType}, ${arrType}* ${newArrayPtr}, i32 0, i32 2`);
    this.emit(`store i32 ${sliceLen}, i32* ${newCapField}`);

    this.ctx.setVariableType(newArrayPtr, `${arrType}*`);
    return newArrayPtr;
  }

  generateArrayConcat(expr: MethodCallNode, params: string[]): string {
    const arrayPtr = this.ctx.generateExpression(expr.object, params);

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

    if (expr.args.length !== 1) {
      throw new Error('concat() requires exactly 1 argument');
    }

    const otherArrayPtr = this.ctx.generateExpression(expr.args[0], params);

    if (isStringArray) {
      return this.generateStringArrayConcat(arrayPtr, otherArrayPtr);
    }

    const lenPtr1 = this.nextTemp();
    this.emit(`${lenPtr1} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const len1 = this.nextTemp();
    this.emit(`${len1} = load i32, i32* ${lenPtr1}`);

    const lenPtr2 = this.nextTemp();
    this.emit(`${lenPtr2} = getelementptr inbounds %Array, %Array* ${otherArrayPtr}, i32 0, i32 1`);
    const len2 = this.nextTemp();
    this.emit(`${len2} = load i32, i32* ${lenPtr2}`);

    const totalLen = this.nextTemp();
    this.emit(`${totalLen} = add i32 ${len1}, ${len2}`);

    const sizePtr = this.nextTemp();
    this.emit(`${sizePtr} = getelementptr %Array, %Array* null, i32 1`);
    const structSize = this.nextTemp();
    this.emit(`${structSize} = ptrtoint %Array* ${sizePtr} to i64`);
    const arrayMem = this.nextTemp();
    this.emit(`${arrayMem} = call i8* @GC_malloc(i64 ${structSize})`);
    const newArrayPtr = this.nextTemp();
    this.emit(`${newArrayPtr} = bitcast i8* ${arrayMem} to %Array*`);

    const totalLenI64 = this.nextTemp();
    this.emit(`${totalLenI64} = zext i32 ${totalLen} to i64`);
    const dataSize = this.nextTemp();
    this.emit(`${dataSize} = mul i64 ${totalLenI64}, 8`);
    const dataMem = this.nextTemp();
    this.emit(`${dataMem} = call i8* @GC_malloc_atomic(i64 ${dataSize})`);
    const newDataPtr = this.nextTemp();
    this.emit(`${newDataPtr} = bitcast i8* ${dataMem} to double*`);

    const dataPtrField1 = this.nextTemp();
    this.emit(`${dataPtrField1} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr1 = this.nextTemp();
    this.emit(`${dataPtr1} = load double*, double** ${dataPtrField1}`);

    const len1I64 = this.nextTemp();
    this.emit(`${len1I64} = zext i32 ${len1} to i64`);
    const size1 = this.nextTemp();
    this.emit(`${size1} = mul i64 ${len1I64}, 8`);
    const src1 = this.nextTemp();
    this.emit(`${src1} = bitcast double* ${dataPtr1} to i8*`);
    const dst1 = this.nextTemp();
    this.emit(`${dst1} = bitcast double* ${newDataPtr} to i8*`);
    this.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${dst1}, i8* ${src1}, i64 ${size1}, i1 false)`);

    const dataPtrField2 = this.nextTemp();
    this.emit(`${dataPtrField2} = getelementptr inbounds %Array, %Array* ${otherArrayPtr}, i32 0, i32 0`);
    const dataPtr2 = this.nextTemp();
    this.emit(`${dataPtr2} = load double*, double** ${dataPtrField2}`);

    const len2I64 = this.nextTemp();
    this.emit(`${len2I64} = zext i32 ${len2} to i64`);
    const size2 = this.nextTemp();
    this.emit(`${size2} = mul i64 ${len2I64}, 8`);
    const src2 = this.nextTemp();
    this.emit(`${src2} = bitcast double* ${dataPtr2} to i8*`);
    const dstOffset = this.nextTemp();
    this.emit(`${dstOffset} = getelementptr inbounds double, double* ${newDataPtr}, i32 ${len1}`);
    const dst2 = this.nextTemp();
    this.emit(`${dst2} = bitcast double* ${dstOffset} to i8*`);
    this.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${dst2}, i8* ${src2}, i64 ${size2}, i1 false)`);

    const newDataField = this.nextTemp();
    this.emit(`${newDataField} = getelementptr inbounds %Array, %Array* ${newArrayPtr}, i32 0, i32 0`);
    this.emit(`store double* ${newDataPtr}, double** ${newDataField}`);

    const newLenField = this.nextTemp();
    this.emit(`${newLenField} = getelementptr inbounds %Array, %Array* ${newArrayPtr}, i32 0, i32 1`);
    this.emit(`store i32 ${totalLen}, i32* ${newLenField}`);

    const newCapField = this.nextTemp();
    this.emit(`${newCapField} = getelementptr inbounds %Array, %Array* ${newArrayPtr}, i32 0, i32 2`);
    this.emit(`store i32 ${totalLen}, i32* ${newCapField}`);

    this.ctx.setVariableType(newArrayPtr, '%Array*');
    return newArrayPtr;
  }

  private generateStringArrayConcat(arrayPtr: string, otherArrayPtr: string): string {
    const lenPtr1 = this.nextTemp();
    this.emit(`${lenPtr1} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
    const len1 = this.nextTemp();
    this.emit(`${len1} = load i32, i32* ${lenPtr1}`);

    const lenPtr2 = this.nextTemp();
    this.emit(`${lenPtr2} = getelementptr inbounds %StringArray, %StringArray* ${otherArrayPtr}, i32 0, i32 1`);
    const len2 = this.nextTemp();
    this.emit(`${len2} = load i32, i32* ${lenPtr2}`);

    const totalLen = this.nextTemp();
    this.emit(`${totalLen} = add i32 ${len1}, ${len2}`);

    const sizePtr = this.nextTemp();
    this.emit(`${sizePtr} = getelementptr %StringArray, %StringArray* null, i32 1`);
    const structSize = this.nextTemp();
    this.emit(`${structSize} = ptrtoint %StringArray* ${sizePtr} to i64`);
    const arrayMem = this.nextTemp();
    this.emit(`${arrayMem} = call i8* @GC_malloc(i64 ${structSize})`);
    const newArrayPtr = this.nextTemp();
    this.emit(`${newArrayPtr} = bitcast i8* ${arrayMem} to %StringArray*`);

    const totalLenI64 = this.nextTemp();
    this.emit(`${totalLenI64} = zext i32 ${totalLen} to i64`);
    const dataSize = this.nextTemp();
    this.emit(`${dataSize} = mul i64 ${totalLenI64}, 8`);
    const dataMem = this.nextTemp();
    this.emit(`${dataMem} = call i8* @GC_malloc(i64 ${dataSize})`);
    const newDataPtr = this.nextTemp();
    this.emit(`${newDataPtr} = bitcast i8* ${dataMem} to i8**`);

    const dataPtrField1 = this.nextTemp();
    this.emit(`${dataPtrField1} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr1 = this.nextTemp();
    this.emit(`${dataPtr1} = load i8**, i8*** ${dataPtrField1}`);

    const len1I64 = this.nextTemp();
    this.emit(`${len1I64} = zext i32 ${len1} to i64`);
    const size1 = this.nextTemp();
    this.emit(`${size1} = mul i64 ${len1I64}, 8`);
    const src1 = this.nextTemp();
    this.emit(`${src1} = bitcast i8** ${dataPtr1} to i8*`);
    const dst1 = this.nextTemp();
    this.emit(`${dst1} = bitcast i8** ${newDataPtr} to i8*`);
    this.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${dst1}, i8* ${src1}, i64 ${size1}, i1 false)`);

    const dataPtrField2 = this.nextTemp();
    this.emit(`${dataPtrField2} = getelementptr inbounds %StringArray, %StringArray* ${otherArrayPtr}, i32 0, i32 0`);
    const dataPtr2 = this.nextTemp();
    this.emit(`${dataPtr2} = load i8**, i8*** ${dataPtrField2}`);

    const len2I64 = this.nextTemp();
    this.emit(`${len2I64} = zext i32 ${len2} to i64`);
    const size2 = this.nextTemp();
    this.emit(`${size2} = mul i64 ${len2I64}, 8`);
    const src2 = this.nextTemp();
    this.emit(`${src2} = bitcast i8** ${dataPtr2} to i8*`);
    const dstOffset = this.nextTemp();
    this.emit(`${dstOffset} = getelementptr inbounds i8*, i8** ${newDataPtr}, i32 ${len1}`);
    const dst2 = this.nextTemp();
    this.emit(`${dst2} = bitcast i8** ${dstOffset} to i8*`);
    this.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${dst2}, i8* ${src2}, i64 ${size2}, i1 false)`);

    const newDataField = this.nextTemp();
    this.emit(`${newDataField} = getelementptr inbounds %StringArray, %StringArray* ${newArrayPtr}, i32 0, i32 0`);
    this.emit(`store i8** ${newDataPtr}, i8*** ${newDataField}`);

    const newLenField = this.nextTemp();
    this.emit(`${newLenField} = getelementptr inbounds %StringArray, %StringArray* ${newArrayPtr}, i32 0, i32 1`);
    this.emit(`store i32 ${totalLen}, i32* ${newLenField}`);

    const newCapField = this.nextTemp();
    this.emit(`${newCapField} = getelementptr inbounds %StringArray, %StringArray* ${newArrayPtr}, i32 0, i32 2`);
    this.emit(`store i32 ${totalLen}, i32* ${newCapField}`);

    this.ctx.setVariableType(newArrayPtr, '%StringArray*');
    return newArrayPtr;
  }
}

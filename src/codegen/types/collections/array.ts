import { Expression, MethodCallNode, VariableNode } from '../../../ast/types.js';

interface ExprBase { type: string; }
interface ArrayExpr { type: string; elements: Expression[]; }
interface VariableExpr { type: string; name: string; }
interface MethodCallExpr { type: string; object: Expression; method: string; }
interface CallExpr { type: string; name: string; }

import { IGeneratorContext } from '../../infrastructure/generator-context.js';


export class ArrayGenerator {
  constructor(private ctx: IGeneratorContext) {}

  private nextTemp(): string { return this.ctx.nextTemp(); }
  private nextLabel(prefix: string): string { return this.ctx.nextLabel(prefix); }
  private emit(instruction: string): void { this.ctx.emit(instruction); }

  private loadArrayMeta(arrayPtr: string): { length: string; dataPtr: string } {
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}, !tbaa !7`);
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load double*, double** ${dataPtrField}, !tbaa !5`);
    return { length, dataPtr };
  }

  generateArrayLiteral(expr: Expression, params: string[]): string {
    const e = expr as ExprBase;
    if (e.type !== 'array') {
      throw new Error('Expected array literal');
    }

    const arrExpr = expr as ArrayExpr;

    let hasSpread = false;
    for (let i = 0; i < arrExpr.elements.length; i++) {
      const el = arrExpr.elements[i] as ExprBase;
      if (el.type === 'spread_element' || el.type.indexOf('spread:') === 0) {
        hasSpread = true;
        break;
      }
    }
    if (hasSpread) {
      return this.generateArrayLiteralWithSpread(arrExpr, params);
    }

    const length = arrExpr.elements.length;

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
    if (length === 0 && this.ctx.getExpectedArrayElementType() === 'string') {
      isStringArray = true;
    }

    let isPointerArray = false;
    if (length === 0 && this.ctx.getExpectedArrayElementType() === 'pointer') {
      isPointerArray = true;
    }
    let firstElemValue: string | null = null;
    if (length > 0 && !isStringArray) {
      firstElemValue = this.ctx.generateExpression(arrExpr.elements[0], params);
      const firstElemType = this.ctx.getVariableType(firstElemValue);
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
            const varType = this.ctx.getVariableType(varName);
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
      const sizePtr = this.nextTemp();
      this.emit(`${sizePtr} = getelementptr %StringArray, %StringArray* null, i32 1`);
      const structSize = this.nextTemp();
      this.emit(`${structSize} = ptrtoint %StringArray* ${sizePtr} to i64`);
      const arrayMem = this.nextTemp();
      this.emit(`${arrayMem} = call i8* @GC_malloc(i64 ${structSize})`);
      const arrayPtr = this.nextTemp();
      this.emit(`${arrayPtr} = bitcast i8* ${arrayMem} to %StringArray*`);

      const dataCount = length === 0 ? 1 : length;
      const dataSize = this.nextTemp();
      this.emit(`${dataSize} = mul i64 ${dataCount}, 8`);
      const dataMem = this.nextTemp();
      this.emit(`${dataMem} = call i8* @GC_malloc(i64 ${dataSize})`);
      const dataPtr = this.nextTemp();
      this.emit(`${dataPtr} = bitcast i8* ${dataMem} to i8**`);

      for (let i = 0; i < arrExpr.elements.length; i++) {
        const elemValue = this.ctx.generateExpression(arrExpr.elements[i], params);
        const elemPtr = this.nextTemp();
        this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
        this.emit(`store i8* ${elemValue}, i8** ${elemPtr}`);
      }

      const dataPtrField = this.nextTemp();
      this.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
      this.emit(`store i8** ${dataPtr}, i8*** ${dataPtrField}`);

      const lenField = this.nextTemp();
      this.emit(`${lenField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
      this.emit(`store i32 ${length}, i32* ${lenField}`);

      const capField = this.nextTemp();
      this.emit(`${capField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`);
      this.emit(`store i32 ${length}, i32* ${capField}`);

      this.ctx.setVariableType(arrayPtr, '%StringArray*');
      return arrayPtr;
    } else if (isPointerArray) {
      const sizePtr = this.nextTemp();
      this.emit(`${sizePtr} = getelementptr %ObjectArray, %ObjectArray* null, i32 1`);
      const structSize = this.nextTemp();
      this.emit(`${structSize} = ptrtoint %ObjectArray* ${sizePtr} to i64`);
      const arrayMem = this.nextTemp();
      this.emit(`${arrayMem} = call i8* @GC_malloc(i64 ${structSize})`);
      const arrayPtr = this.nextTemp();
      this.emit(`${arrayPtr} = bitcast i8* ${arrayMem} to %ObjectArray*`);

      const dataCount = length === 0 ? 1 : length;
      const dataSize = this.nextTemp();
      this.emit(`${dataSize} = mul i64 ${dataCount}, 8`);
      const dataMem = this.nextTemp();
      this.emit(`${dataMem} = call i8* @GC_malloc(i64 ${dataSize})`);
      const dataPtr = this.nextTemp();
      this.emit(`${dataPtr} = bitcast i8* ${dataMem} to i8**`);

      for (let i = 0; i < arrExpr.elements.length; i++) {
        const elemValue = (i === 0 && firstElemValue) ? firstElemValue : this.ctx.generateExpression(arrExpr.elements[i], params);
        const elemCast = this.nextTemp();
        this.emit(`${elemCast} = bitcast ${this.ctx.getVariableType(elemValue) || 'i8*'} ${elemValue} to i8*`);
        const elemPtr = this.nextTemp();
        this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${i}`);
        this.emit(`store i8* ${elemCast}, i8** ${elemPtr}`);
      }

      const dataPtrField = this.nextTemp();
      this.emit(`${dataPtrField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`);
      const dataPtrCast = this.nextTemp();
      this.emit(`${dataPtrCast} = bitcast i8** ${dataPtr} to i8*`);
      this.emit(`store i8* ${dataPtrCast}, i8** ${dataPtrField}`);

      const lenField = this.nextTemp();
      this.emit(`${lenField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 1`);
      this.emit(`store i32 ${length}, i32* ${lenField}`);

      const capField = this.nextTemp();
      this.emit(`${capField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 2`);
      this.emit(`store i32 ${length}, i32* ${capField}`);

      this.ctx.setVariableType(arrayPtr, '%ObjectArray*');
      return arrayPtr;
    } else {
      const sizePtr = this.nextTemp();
      this.emit(`${sizePtr} = getelementptr %Array, %Array* null, i32 1`);
      const structSize = this.nextTemp();
      this.emit(`${structSize} = ptrtoint %Array* ${sizePtr} to i64`);
      const arrayMem = this.nextTemp();
      this.emit(`${arrayMem} = call i8* @GC_malloc(i64 ${structSize})`);
      const arrayPtr = this.nextTemp();
      this.emit(`${arrayPtr} = bitcast i8* ${arrayMem} to %Array*`);

      const dataCount = length === 0 ? 1 : length;
      const dataSize = this.nextTemp();
      this.emit(`${dataSize} = mul i64 ${dataCount}, 8`);
      const dataMem = this.nextTemp();
      this.emit(`${dataMem} = call i8* @GC_malloc_atomic(i64 ${dataSize})`);
      const dataPtr = this.nextTemp();
      this.emit(`${dataPtr} = bitcast i8* ${dataMem} to double*`);

      for (let i = 0; i < arrExpr.elements.length; i++) {
        const elemValue = (i === 0 && firstElemValue) ? firstElemValue : this.ctx.generateExpression(arrExpr.elements[i], params);
        const elemPtr = this.nextTemp();
        this.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${i}`);
        this.emit(`store double ${elemValue}, double* ${elemPtr}`);
      }

      const dataPtrField = this.nextTemp();
      this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
      this.emit(`store double* ${dataPtr}, double** ${dataPtrField}`);

      const lenField = this.nextTemp();
      this.emit(`${lenField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
      this.emit(`store i32 ${length}, i32* ${lenField}`);

      const capField = this.nextTemp();
      this.emit(`${capField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
      this.emit(`store i32 ${length}, i32* ${capField}`);

      this.ctx.setVariableType(arrayPtr, '%Array*');
      return arrayPtr;
    }
  }

  private generateArrayLiteralWithSpread(arrExpr: ArrayExpr, params: string[]): string {
    let isStringArray = false;
    for (let i = 0; i < arrExpr.elements.length; i++) {
      const el = arrExpr.elements[i] as ExprBase;
      if (el.type === 'string') {
        isStringArray = true;
        break;
      }
      if (el.type.indexOf('spread:') === 0) {
        const varName = el.type.substr(7);
        const varType = this.ctx.getVariableType(varName);
        if (varType === '%StringArray*') {
          isStringArray = true;
          break;
        }
      } else if (el.type === 'spread_element') {
      }
    }

    if (isStringArray) {
      return this.generateStringArrayLiteralWithSpread(arrExpr, params);
    }

    let literalCount = 0;
    for (let i = 0; i < arrExpr.elements.length; i++) {
      const el = arrExpr.elements[i] as ExprBase;
      if (el.type.indexOf('spread:') !== 0 && el.type !== 'spread_element') {
        literalCount = literalCount + 1;
      }
    }

    let totalLen = `${literalCount}`;
    for (let i = 0; i < arrExpr.elements.length; i++) {
      const el = arrExpr.elements[i] as ExprBase;
      if (el.type.indexOf('spread:') === 0) {
        const varName = el.type.substr(7);
        const alloca = this.ctx.getVariableAlloca(varName);
        const arrPtr = this.nextTemp();
        this.emit(`${arrPtr} = load %Array*, %Array** ${alloca}`);
        const meta = this.loadArrayMeta(arrPtr);
        const newTotal = this.nextTemp();
        this.emit(`${newTotal} = add i32 ${totalLen}, ${meta.length}`);
        totalLen = newTotal;
      } else if (el.type === 'spread_element') {
        const spreadArg = (arrExpr.elements[i] as { type: string; argument: Expression }).argument;
        const arrPtr = this.ctx.generateExpression(spreadArg, params);
        const meta = this.loadArrayMeta(arrPtr);
        const newTotal = this.nextTemp();
        this.emit(`${newTotal} = add i32 ${totalLen}, ${meta.length}`);
        totalLen = newTotal;
      }
    }

    const sizePtr = this.nextTemp();
    this.emit(`${sizePtr} = getelementptr %Array, %Array* null, i32 1`);
    const structSize = this.nextTemp();
    this.emit(`${structSize} = ptrtoint %Array* ${sizePtr} to i64`);
    const arrayMem = this.nextTemp();
    this.emit(`${arrayMem} = call i8* @GC_malloc(i64 ${structSize})`);
    const arrayPtr = this.nextTemp();
    this.emit(`${arrayPtr} = bitcast i8* ${arrayMem} to %Array*`);

    const totalLenI64 = this.nextTemp();
    this.emit(`${totalLenI64} = zext i32 ${totalLen} to i64`);
    const dataSize = this.nextTemp();
    this.emit(`${dataSize} = mul i64 ${totalLenI64}, 8`);
    const dataMem = this.nextTemp();
    this.emit(`${dataMem} = call i8* @GC_malloc_atomic(i64 ${dataSize})`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = bitcast i8* ${dataMem} to double*`);

    const offsetPtr = this.nextTemp();
    this.emit(`${offsetPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${offsetPtr}`);

    for (let i = 0; i < arrExpr.elements.length; i++) {
      const el = arrExpr.elements[i] as ExprBase;
      if (el.type.indexOf('spread:') === 0) {
        const varName = el.type.substr(7);
        const alloca = this.ctx.getVariableAlloca(varName);
        const srcArrPtr = this.nextTemp();
        this.emit(`${srcArrPtr} = load %Array*, %Array** ${alloca}`);
        const srcMeta = this.loadArrayMeta(srcArrPtr);

        const checkLabel = this.nextLabel('spread_check');
        const bodyLabel = this.nextLabel('spread_body');
        const endLabel = this.nextLabel('spread_end');

        const counterPtr = this.nextTemp();
        this.emit(`${counterPtr} = alloca i32`);
        this.emit(`store i32 0, i32* ${counterPtr}`);
        this.emit(`br label %${checkLabel}`);

        this.emit(`${checkLabel}:`);
        const counter = this.nextTemp();
        this.emit(`${counter} = load i32, i32* ${counterPtr}`);
        const cond = this.nextTemp();
        this.emit(`${cond} = icmp slt i32 ${counter}, ${srcMeta.length}`);
        this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

        this.emit(`${bodyLabel}:`);
        const srcElemPtr = this.nextTemp();
        this.emit(`${srcElemPtr} = getelementptr inbounds double, double* ${srcMeta.dataPtr}, i32 ${counter}`);
        const srcElem = this.nextTemp();
        this.emit(`${srcElem} = load double, double* ${srcElemPtr}`);

        const curOffset = this.nextTemp();
        this.emit(`${curOffset} = load i32, i32* ${offsetPtr}`);
        const dstElemPtr = this.nextTemp();
        this.emit(`${dstElemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${curOffset}`);
        this.emit(`store double ${srcElem}, double* ${dstElemPtr}`);

        const nextOffset = this.nextTemp();
        this.emit(`${nextOffset} = add i32 ${curOffset}, 1`);
        this.emit(`store i32 ${nextOffset}, i32* ${offsetPtr}`);
        const nextCounter = this.nextTemp();
        this.emit(`${nextCounter} = add i32 ${counter}, 1`);
        this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
        this.emit(`br label %${checkLabel}`);

        this.emit(`${endLabel}:`);
      } else if (el.type === 'spread_element') {
        const spreadArg = (arrExpr.elements[i] as { type: string; argument: Expression }).argument;
        const srcArrPtr = this.ctx.generateExpression(spreadArg, params);
        const srcMeta = this.loadArrayMeta(srcArrPtr);

        const checkLabel = this.nextLabel('spread_check');
        const bodyLabel = this.nextLabel('spread_body');
        const endLabel = this.nextLabel('spread_end');

        const counterPtr = this.nextTemp();
        this.emit(`${counterPtr} = alloca i32`);
        this.emit(`store i32 0, i32* ${counterPtr}`);
        this.emit(`br label %${checkLabel}`);

        this.emit(`${checkLabel}:`);
        const counter = this.nextTemp();
        this.emit(`${counter} = load i32, i32* ${counterPtr}`);
        const cond = this.nextTemp();
        this.emit(`${cond} = icmp slt i32 ${counter}, ${srcMeta.length}`);
        this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

        this.emit(`${bodyLabel}:`);
        const srcElemPtr = this.nextTemp();
        this.emit(`${srcElemPtr} = getelementptr inbounds double, double* ${srcMeta.dataPtr}, i32 ${counter}`);
        const srcElem = this.nextTemp();
        this.emit(`${srcElem} = load double, double* ${srcElemPtr}`);

        const curOffset = this.nextTemp();
        this.emit(`${curOffset} = load i32, i32* ${offsetPtr}`);
        const dstElemPtr = this.nextTemp();
        this.emit(`${dstElemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${curOffset}`);
        this.emit(`store double ${srcElem}, double* ${dstElemPtr}`);

        const nextOffset = this.nextTemp();
        this.emit(`${nextOffset} = add i32 ${curOffset}, 1`);
        this.emit(`store i32 ${nextOffset}, i32* ${offsetPtr}`);
        const nextCounter = this.nextTemp();
        this.emit(`${nextCounter} = add i32 ${counter}, 1`);
        this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
        this.emit(`br label %${checkLabel}`);

        this.emit(`${endLabel}:`);
      } else {
        const value = this.ctx.generateExpression(arrExpr.elements[i], params);
        const curOffset = this.nextTemp();
        this.emit(`${curOffset} = load i32, i32* ${offsetPtr}`);
        const elemPtr = this.nextTemp();
        this.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${curOffset}`);
        this.emit(`store double ${value}, double* ${elemPtr}`);
        const nextOffset = this.nextTemp();
        this.emit(`${nextOffset} = add i32 ${curOffset}, 1`);
        this.emit(`store i32 ${nextOffset}, i32* ${offsetPtr}`);
      }
    }

    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    this.emit(`store double* ${dataPtr}, double** ${dataPtrField}`);

    const lenField = this.nextTemp();
    this.emit(`${lenField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    this.emit(`store i32 ${totalLen}, i32* ${lenField}`);

    const capField = this.nextTemp();
    this.emit(`${capField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
    this.emit(`store i32 ${totalLen}, i32* ${capField}`);

    this.ctx.setVariableType(arrayPtr, '%Array*');
    return arrayPtr;
  }

  private generateStringArrayLiteralWithSpread(arrExpr: ArrayExpr, params: string[]): string {
    const spreadSources: { index: number; ptr: string }[] = [];
    const literalValues: { index: number; value: string }[] = [];

    for (let i = 0; i < arrExpr.elements.length; i++) {
      const el = arrExpr.elements[i] as ExprBase;
      if (el.type.indexOf('spread:') === 0) {
        const varName = el.type.substr(7);
        const alloca = this.ctx.getVariableAlloca(varName);
        const ptr = this.nextTemp();
        this.emit(`${ptr} = load %Array*, %Array** ${alloca}`);
        this.ctx.setVariableType(ptr, '%Array*');
        spreadSources.push({ index: i, ptr: ptr });
      } else if (el.type === 'spread_element') {
        const spreadArg = (arrExpr.elements[i] as { type: string; argument: Expression }).argument;
        const ptr = this.ctx.generateExpression(spreadArg, params);
        spreadSources.push({ index: i, ptr });
      } else {
        const value = this.ctx.generateExpression(arrExpr.elements[i], params);
        literalValues.push({ index: i, value });
      }
    }

    let totalLen = `${literalValues.length}`;
    for (const src of spreadSources) {
      const lenPtr = this.nextTemp();
      this.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${src.ptr}, i32 0, i32 1`);
      const srcLen = this.nextTemp();
      this.emit(`${srcLen} = load i32, i32* ${lenPtr}`);
      const newTotal = this.nextTemp();
      this.emit(`${newTotal} = add i32 ${totalLen}, ${srcLen}`);
      totalLen = newTotal;
    }

    const sizePtr = this.nextTemp();
    this.emit(`${sizePtr} = getelementptr %StringArray, %StringArray* null, i32 1`);
    const structSize = this.nextTemp();
    this.emit(`${structSize} = ptrtoint %StringArray* ${sizePtr} to i64`);
    const arrayMem = this.nextTemp();
    this.emit(`${arrayMem} = call i8* @GC_malloc(i64 ${structSize})`);
    const arrayPtr = this.nextTemp();
    this.emit(`${arrayPtr} = bitcast i8* ${arrayMem} to %StringArray*`);

    const totalLenI64 = this.nextTemp();
    this.emit(`${totalLenI64} = zext i32 ${totalLen} to i64`);
    const dataSize = this.nextTemp();
    this.emit(`${dataSize} = mul i64 ${totalLenI64}, 8`);
    const dataMem = this.nextTemp();
    this.emit(`${dataMem} = call i8* @GC_malloc(i64 ${dataSize})`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = bitcast i8* ${dataMem} to i8**`);

    const offsetPtr = this.nextTemp();
    this.emit(`${offsetPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${offsetPtr}`);

    let spreadIdx = 0;
    let litIdx = 0;
    for (let i = 0; i < arrExpr.elements.length; i++) {
      const el = arrExpr.elements[i] as ExprBase;
      if (el.type === 'spread_element' || el.type.indexOf('spread:') === 0) {
        const src = spreadSources[spreadIdx];
        spreadIdx++;
        const srcLenPtr = this.nextTemp();
        this.emit(`${srcLenPtr} = getelementptr inbounds %StringArray, %StringArray* ${src.ptr}, i32 0, i32 1`);
        const srcLen = this.nextTemp();
        this.emit(`${srcLen} = load i32, i32* ${srcLenPtr}, !tbaa !7`);
        const srcDataField = this.nextTemp();
        this.emit(`${srcDataField} = getelementptr inbounds %StringArray, %StringArray* ${src.ptr}, i32 0, i32 0`);
        const srcDataPtr = this.nextTemp();
        this.emit(`${srcDataPtr} = load i8**, i8*** ${srcDataField}, !tbaa !5`);

        const checkLabel = this.nextLabel('spread_check');
        const bodyLabel = this.nextLabel('spread_body');
        const endLabel = this.nextLabel('spread_end');

        const counterPtr = this.nextTemp();
        this.emit(`${counterPtr} = alloca i32`);
        this.emit(`store i32 0, i32* ${counterPtr}`);
        this.emit(`br label %${checkLabel}`);

        this.emit(`${checkLabel}:`);
        const counter = this.nextTemp();
        this.emit(`${counter} = load i32, i32* ${counterPtr}`);
        const cond = this.nextTemp();
        this.emit(`${cond} = icmp slt i32 ${counter}, ${srcLen}`);
        this.emit(`br i1 ${cond}, label %${bodyLabel}, label %${endLabel}`);

        this.emit(`${bodyLabel}:`);
        const srcElemPtr = this.nextTemp();
        this.emit(`${srcElemPtr} = getelementptr inbounds i8*, i8** ${srcDataPtr}, i32 ${counter}`);
        const srcElem = this.nextTemp();
        this.emit(`${srcElem} = load i8*, i8** ${srcElemPtr}`);

        const curOffset = this.nextTemp();
        this.emit(`${curOffset} = load i32, i32* ${offsetPtr}`);
        const dstElemPtr = this.nextTemp();
        this.emit(`${dstElemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${curOffset}`);
        this.emit(`store i8* ${srcElem}, i8** ${dstElemPtr}`);

        const nextOffset = this.nextTemp();
        this.emit(`${nextOffset} = add i32 ${curOffset}, 1`);
        this.emit(`store i32 ${nextOffset}, i32* ${offsetPtr}`);
        const nextCounter = this.nextTemp();
        this.emit(`${nextCounter} = add i32 ${counter}, 1`);
        this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
        this.emit(`br label %${checkLabel}`);

        this.emit(`${endLabel}:`);
      } else {
        const lit = literalValues[litIdx];
        litIdx++;
        const curOffset = this.nextTemp();
        this.emit(`${curOffset} = load i32, i32* ${offsetPtr}`);
        const elemPtr = this.nextTemp();
        this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${curOffset}`);
        this.emit(`store i8* ${lit.value}, i8** ${elemPtr}`);
        const nextOffset = this.nextTemp();
        this.emit(`${nextOffset} = add i32 ${curOffset}, 1`);
        this.emit(`store i32 ${nextOffset}, i32* ${offsetPtr}`);
      }
    }

    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    this.emit(`store i8** ${dataPtr}, i8*** ${dataPtrField}`);

    const lenField = this.nextTemp();
    this.emit(`${lenField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
    this.emit(`store i32 ${totalLen}, i32* ${lenField}`);

    const capField = this.nextTemp();
    this.emit(`${capField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`);
    this.emit(`store i32 ${totalLen}, i32* ${capField}`);

    this.ctx.setVariableType(arrayPtr, '%StringArray*');
    return arrayPtr;
  }

  generateArrayPush(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 1) {
      throw new Error('push() requires exactly 1 argument');
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);
    const value = this.ctx.generateExpression(expr.args[0], params);

    let isStringArray = false;
    let isObjectArray = false;
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === 'variable') {
      const varNode = expr.object as VariableNode;
      const varName = varNode.name;
      const varType = this.ctx.getVariableType(varName);
      isStringArray = varType === '%StringArray*';
      isObjectArray = varType === '%ObjectArray*';
    }
    if (!isStringArray && !isObjectArray) {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      if (ptrType === '%StringArray*') isStringArray = true;
      else if (ptrType === '%ObjectArray*') isObjectArray = true;
    }

    if (isStringArray) {
      return this.doStringArrayPush(arrayPtr, value);
    }

    if (isObjectArray) {
      const valueType = this.ctx.getVariableType(value) || 'i8*';
      return this.doObjectArrayPush(arrayPtr, value, valueType);
    }

    const valueType = this.ctx.getVariableType(value);
    if (valueType === 'i8*') {
      return this.doStringArrayPush(arrayPtr, value);
    }
    if (valueType && valueType.endsWith('*') && valueType !== 'double*') {
      return this.doObjectArrayPush(arrayPtr, value, valueType);
    }

    return this.doIntArrayPush(arrayPtr, value);
  }

  generateArrayPop(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length !== 0) {
      throw new Error('pop() requires 0 arguments');
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);

    let isStringArray = false;
    let isPointerArray = false;
    const exprObjBase2 = expr.object as ExprBase;
    if (exprObjBase2.type === 'variable') {
      const varNode = expr.object as VariableNode;
      const varName = varNode.name;
      const varType = this.ctx.getVariableType(varName);
      isStringArray = varType === '%StringArray*';
      isPointerArray = varType === 'i8*';
    }
    if (!isStringArray && !isPointerArray) {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      if (ptrType === '%StringArray*') isStringArray = true;
      else if (ptrType === 'i8*') isPointerArray = true;
    }

    if (isStringArray) {
      return this.doStringArrayPop(arrayPtr);
    } else if (isPointerArray) {
      return this.doPointerArrayPop(arrayPtr);
    } else {
      return this.doIntArrayPop(arrayPtr);
    }
  }

  private doIntArrayPush(arrayPtr: string, value: string): string {
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const currentLen = this.nextTemp();
    this.emit(`${currentLen} = load i32, i32* ${lenPtr}`);
    const capPtr = this.nextTemp();
    this.emit(`${capPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
    const currentCap = this.nextTemp();
    this.emit(`${currentCap} = load i32, i32* ${capPtr}`);
    const needResize = this.nextTemp();
    this.emit(`${needResize} = icmp eq i32 ${currentLen}, ${currentCap}`);
    const resizeLabel = this.nextLabel('resize');
    const continueLabel = this.nextLabel('continue');
    this.emit(`br i1 ${needResize}, label %${resizeLabel}, label %${continueLabel}`);
    this.emit(`${resizeLabel}:`);
    const isZero = this.nextTemp();
    this.emit(`${isZero} = icmp eq i32 ${currentCap}, 0`);
    const doubled = this.nextTemp();
    this.emit(`${doubled} = mul i32 ${currentCap}, 2`);
    const newCap = this.nextTemp();
    this.emit(`${newCap} = select i1 ${isZero}, i32 2, i32 ${doubled}`);
    const newCapI64 = this.nextTemp();
    this.emit(`${newCapI64} = zext i32 ${newCap} to i64`);
    const newMemSize = this.nextTemp();
    this.emit(`${newMemSize} = mul i64 ${newCapI64}, 8`);
    const newMem = this.nextTemp();
    this.emit(`${newMem} = call i8* @GC_malloc_atomic(i64 ${newMemSize})`);
    const newDataPtr = this.nextTemp();
    this.emit(`${newDataPtr} = bitcast i8* ${newMem} to double*`);
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const oldDataPtr = this.nextTemp();
    this.emit(`${oldDataPtr} = load double*, double** ${dataPtrField}, !tbaa !5`);
    const oldDataI8 = this.nextTemp();
    this.emit(`${oldDataI8} = bitcast double* ${oldDataPtr} to i8*`);
    const newDataI8 = this.nextTemp();
    this.emit(`${newDataI8} = bitcast double* ${newDataPtr} to i8*`);
    const doubleSize = this.ctx.getDoubleSize();
    const currentLenI64 = this.nextTemp();
    this.emit(`${currentLenI64} = zext i32 ${currentLen} to i64`);
    const copySizeI64 = this.nextTemp();
    this.emit(`${copySizeI64} = mul i64 ${currentLenI64}, ${doubleSize}`);
    this.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySizeI64}, i1 false)`);
    this.emit(`store double* ${newDataPtr}, double** ${dataPtrField}`);
    this.emit(`store i32 ${newCap}, i32* ${capPtr}`);
    this.emit(`br label %${continueLabel}`);
    this.emit(`${continueLabel}:`);
    const dataPtrField2 = this.nextTemp();
    this.emit(`${dataPtrField2} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load double*, double** ${dataPtrField2}, !tbaa !5`);
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${currentLen}`);
    this.emit(`store double ${value}, double* ${elemPtr}, !tbaa !4`);
    const newLen = this.nextTemp();
    this.emit(`${newLen} = add i32 ${currentLen}, 1`);
    this.emit(`store i32 ${newLen}, i32* ${lenPtr}`);
    const newLenDouble = this.nextTemp();
    this.emit(`${newLenDouble} = sitofp i32 ${newLen} to double`);
    this.ctx.setVariableType(newLenDouble, 'double');
    return newLenDouble;
  }

  private doStringArrayPush(arrayPtr: string, value: string): string {
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
    const currentLen = this.nextTemp();
    this.emit(`${currentLen} = load i32, i32* ${lenPtr}`);
    const capPtr = this.nextTemp();
    this.emit(`${capPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`);
    const currentCap = this.nextTemp();
    this.emit(`${currentCap} = load i32, i32* ${capPtr}`);
    const needResize = this.nextTemp();
    this.emit(`${needResize} = icmp eq i32 ${currentLen}, ${currentCap}`);
    const resizeLabel = this.nextLabel('resize');
    const continueLabel = this.nextLabel('continue');
    this.emit(`br i1 ${needResize}, label %${resizeLabel}, label %${continueLabel}`);
    this.emit(`${resizeLabel}:`);
    const isZero = this.nextTemp();
    this.emit(`${isZero} = icmp eq i32 ${currentCap}, 0`);
    const doubled = this.nextTemp();
    this.emit(`${doubled} = mul i32 ${currentCap}, 2`);
    const newCap = this.nextTemp();
    this.emit(`${newCap} = select i1 ${isZero}, i32 2, i32 ${doubled}`);
    const newCapI64 = this.nextTemp();
    this.emit(`${newCapI64} = zext i32 ${newCap} to i64`);
    const newMemSize = this.nextTemp();
    this.emit(`${newMemSize} = mul i64 ${newCapI64}, 8`);
    const newMem = this.nextTemp();
    this.emit(`${newMem} = call i8* @GC_malloc(i64 ${newMemSize})`);
    const newDataPtr = this.nextTemp();
    this.emit(`${newDataPtr} = bitcast i8* ${newMem} to i8**`);
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    const oldDataPtr = this.nextTemp();
    this.emit(`${oldDataPtr} = load i8**, i8*** ${dataPtrField}, !tbaa !5`);
    const oldDataI8 = this.nextTemp();
    this.emit(`${oldDataI8} = bitcast i8** ${oldDataPtr} to i8*`);
    const newDataI8 = this.nextTemp();
    this.emit(`${newDataI8} = bitcast i8** ${newDataPtr} to i8*`);
    const copySize = this.nextTemp();
    this.emit(`${copySize} = mul i32 ${currentLen}, 8`);
    const copySizeI64 = this.nextTemp();
    this.emit(`${copySizeI64} = zext i32 ${copySize} to i64`);
    this.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySizeI64}, i1 false)`);
    this.emit(`store i8** ${newDataPtr}, i8*** ${dataPtrField}`);
    this.emit(`store i32 ${newCap}, i32* ${capPtr}`);
    this.emit(`br label %${continueLabel}`);
    this.emit(`${continueLabel}:`);
    const dataPtrField2 = this.nextTemp();
    this.emit(`${dataPtrField2} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField2}, !tbaa !5`);
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${currentLen}`);
    this.emit(`store i8* ${value}, i8** ${elemPtr}, !tbaa !5`);
    const newLen = this.nextTemp();
    this.emit(`${newLen} = add i32 ${currentLen}, 1`);
    this.emit(`store i32 ${newLen}, i32* ${lenPtr}`);
    const newLenDouble = this.nextTemp();
    this.emit(`${newLenDouble} = sitofp i32 ${newLen} to double`);
    this.ctx.setVariableType(newLenDouble, 'double');
    return newLenDouble;
  }

  private doObjectArrayPush(arrayPtr: string, value: string, valueType: string): string {
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 1`);
    const currentLen = this.nextTemp();
    this.emit(`${currentLen} = load i32, i32* ${lenPtr}`);
    const capPtr = this.nextTemp();
    this.emit(`${capPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 2`);
    const currentCap = this.nextTemp();
    this.emit(`${currentCap} = load i32, i32* ${capPtr}`);
    const needResize = this.nextTemp();
    this.emit(`${needResize} = icmp eq i32 ${currentLen}, ${currentCap}`);
    const resizeLabel = this.nextLabel('resize');
    const continueLabel = this.nextLabel('continue');
    this.emit(`br i1 ${needResize}, label %${resizeLabel}, label %${continueLabel}`);
    this.emit(`${resizeLabel}:`);
    const isZero = this.nextTemp();
    this.emit(`${isZero} = icmp eq i32 ${currentCap}, 0`);
    const doubled = this.nextTemp();
    this.emit(`${doubled} = mul i32 ${currentCap}, 2`);
    const newCap = this.nextTemp();
    this.emit(`${newCap} = select i1 ${isZero}, i32 2, i32 ${doubled}`);
    const newCapI64 = this.nextTemp();
    this.emit(`${newCapI64} = zext i32 ${newCap} to i64`);
    const newMemSize = this.nextTemp();
    this.emit(`${newMemSize} = mul i64 ${newCapI64}, 8`);
    const newMem = this.nextTemp();
    this.emit(`${newMem} = call i8* @GC_malloc(i64 ${newMemSize})`);
    const newDataPtr = this.nextTemp();
    this.emit(`${newDataPtr} = bitcast i8* ${newMem} to i8**`);
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`);
    const oldDataPtrRaw = this.nextTemp();
    this.emit(`${oldDataPtrRaw} = load i8*, i8** ${dataPtrField}`);
    const oldDataPtr = this.nextTemp();
    this.emit(`${oldDataPtr} = bitcast i8* ${oldDataPtrRaw} to i8**`);
    const oldDataI8 = this.nextTemp();
    this.emit(`${oldDataI8} = bitcast i8** ${oldDataPtr} to i8*`);
    const newDataI8 = this.nextTemp();
    this.emit(`${newDataI8} = bitcast i8** ${newDataPtr} to i8*`);
    const copySize = this.nextTemp();
    this.emit(`${copySize} = mul i32 ${currentLen}, 8`);
    const copySizeI64 = this.nextTemp();
    this.emit(`${copySizeI64} = zext i32 ${copySize} to i64`);
    this.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySizeI64}, i1 false)`);
    const newDataPtrAsI8 = this.nextTemp();
    this.emit(`${newDataPtrAsI8} = bitcast i8** ${newDataPtr} to i8*`);
    this.emit(`store i8* ${newDataPtrAsI8}, i8** ${dataPtrField}`);
    this.emit(`store i32 ${newCap}, i32* ${capPtr}`);
    this.emit(`br label %${continueLabel}`);
    this.emit(`${continueLabel}:`);
    const dataPtrField2 = this.nextTemp();
    this.emit(`${dataPtrField2} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`);
    const dataPtrRaw = this.nextTemp();
    this.emit(`${dataPtrRaw} = load i8*, i8** ${dataPtrField2}`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = bitcast i8* ${dataPtrRaw} to i8**`);
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${currentLen}`);
    const valueAsI8 = this.nextTemp();
    this.emit(`${valueAsI8} = bitcast ${valueType} ${value} to i8*`);
    this.emit(`store i8* ${valueAsI8}, i8** ${elemPtr}`);
    const newLen = this.nextTemp();
    this.emit(`${newLen} = add i32 ${currentLen}, 1`);
    this.emit(`store i32 ${newLen}, i32* ${lenPtr}`);
    const newLenDouble = this.nextTemp();
    this.emit(`${newLenDouble} = sitofp i32 ${newLen} to double`);
    this.ctx.setVariableType(newLenDouble, 'double');
    return newLenDouble;
  }

  private doPointerArrayPush(arrayPtr: string, value: string, valueType: string): string {
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const currentLen = this.nextTemp();
    this.emit(`${currentLen} = load i32, i32* ${lenPtr}`);
    const capPtr = this.nextTemp();
    this.emit(`${capPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
    const currentCap = this.nextTemp();
    this.emit(`${currentCap} = load i32, i32* ${capPtr}`);
    const needResize = this.nextTemp();
    this.emit(`${needResize} = icmp eq i32 ${currentLen}, ${currentCap}`);
    const resizeLabel = this.nextLabel('resize');
    const continueLabel = this.nextLabel('continue');
    this.emit(`br i1 ${needResize}, label %${resizeLabel}, label %${continueLabel}`);
    this.emit(`${resizeLabel}:`);
    const isZero = this.nextTemp();
    this.emit(`${isZero} = icmp eq i32 ${currentCap}, 0`);
    const doubled = this.nextTemp();
    this.emit(`${doubled} = mul i32 ${currentCap}, 2`);
    const newCap = this.nextTemp();
    this.emit(`${newCap} = select i1 ${isZero}, i32 2, i32 ${doubled}`);
    const newCapI64 = this.nextTemp();
    this.emit(`${newCapI64} = zext i32 ${newCap} to i64`);
    const newMemSize = this.nextTemp();
    this.emit(`${newMemSize} = mul i64 ${newCapI64}, 8`);
    const newMem = this.nextTemp();
    this.emit(`${newMem} = call i8* @GC_malloc(i64 ${newMemSize})`);
    const newDataPtr = this.nextTemp();
    this.emit(`${newDataPtr} = bitcast i8* ${newMem} to i8**`);
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const oldDataPtrRaw = this.nextTemp();
    this.emit(`${oldDataPtrRaw} = load double*, double** ${dataPtrField}, !tbaa !5`);
    const oldDataPtr = this.nextTemp();
    this.emit(`${oldDataPtr} = bitcast double* ${oldDataPtrRaw} to i8**`);
    const oldDataI8 = this.nextTemp();
    this.emit(`${oldDataI8} = bitcast i8** ${oldDataPtr} to i8*`);
    const newDataI8 = this.nextTemp();
    this.emit(`${newDataI8} = bitcast i8** ${newDataPtr} to i8*`);
    const copySize = this.nextTemp();
    this.emit(`${copySize} = mul i32 ${currentLen}, 8`);
    const copySizeI64 = this.nextTemp();
    this.emit(`${copySizeI64} = zext i32 ${copySize} to i64`);
    this.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${newDataI8}, i8* ${oldDataI8}, i64 ${copySizeI64}, i1 false)`);
    const newDataPtrAsDouble = this.nextTemp();
    this.emit(`${newDataPtrAsDouble} = bitcast i8** ${newDataPtr} to double*`);
    this.emit(`store double* ${newDataPtrAsDouble}, double** ${dataPtrField}`);
    this.emit(`store i32 ${newCap}, i32* ${capPtr}`);
    this.emit(`br label %${continueLabel}`);
    this.emit(`${continueLabel}:`);
    const dataPtrField2 = this.nextTemp();
    this.emit(`${dataPtrField2} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtrRaw = this.nextTemp();
    this.emit(`${dataPtrRaw} = load double*, double** ${dataPtrField2}, !tbaa !5`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = bitcast double* ${dataPtrRaw} to i8**`);
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${currentLen}`);
    const valueAsI8 = this.nextTemp();
    this.emit(`${valueAsI8} = bitcast ${valueType} ${value} to i8*`);
    this.emit(`store i8* ${valueAsI8}, i8** ${elemPtr}`);
    const newLen = this.nextTemp();
    this.emit(`${newLen} = add i32 ${currentLen}, 1`);
    this.emit(`store i32 ${newLen}, i32* ${lenPtr}`);
    const newLenDouble = this.nextTemp();
    this.emit(`${newLenDouble} = sitofp i32 ${newLen} to double`);
    this.ctx.setVariableType(newLenDouble, 'double');
    return newLenDouble;
  }

  private doIntArrayPop(arrayPtr: string): string {
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
    const currentLen = this.nextTemp();
    this.emit(`${currentLen} = load i32, i32* ${lenPtr}`);
    const isEmpty = this.nextTemp();
    this.emit(`${isEmpty} = icmp eq i32 ${currentLen}, 0`);
    const emptyLabel = this.nextLabel('pop_empty');
    const notEmptyLabel = this.nextLabel('pop_notempty');
    const endLabel = this.nextLabel('pop_end');
    this.emit(`br i1 ${isEmpty}, label %${emptyLabel}, label %${notEmptyLabel}`);
    this.emit(`${emptyLabel}:`);
    this.emit(`br label %${endLabel}`);
    this.emit(`${notEmptyLabel}:`);
    const lastIndex = this.nextTemp();
    this.emit(`${lastIndex} = sub i32 ${currentLen}, 1`);
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load double*, double** ${dataPtrField}`);
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 ${lastIndex}`);
    const lastElem = this.nextTemp();
    this.emit(`${lastElem} = load double, double* ${elemPtr}`);
    this.emit(`store i32 ${lastIndex}, i32* ${lenPtr}`);
    this.emit(`br label %${endLabel}`);
    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = phi double [ 0.0, %${emptyLabel} ], [ ${lastElem}, %${notEmptyLabel} ]`);
    return result;
  }

  private doStringArrayPop(arrayPtr: string): string {
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
    const currentLen = this.nextTemp();
    this.emit(`${currentLen} = load i32, i32* ${lenPtr}`);
    const isEmpty = this.nextTemp();
    this.emit(`${isEmpty} = icmp eq i32 ${currentLen}, 0`);
    const emptyLabel = this.nextLabel('pop_empty');
    const notEmptyLabel = this.nextLabel('pop_notempty');
    const endLabel = this.nextLabel('pop_end');
    this.emit(`br i1 ${isEmpty}, label %${emptyLabel}, label %${notEmptyLabel}`);
    this.emit(`${emptyLabel}:`);
    const emptyStr = this.nextTemp();
    this.emit(`${emptyStr} = call i8* @GC_malloc_atomic(i64 1)`);
    this.emit(`store i8 0, i8* ${emptyStr}`);
    this.emit(`br label %${endLabel}`);
    this.emit(`${notEmptyLabel}:`);
    const lastIndex = this.nextTemp();
    this.emit(`${lastIndex} = sub i32 ${currentLen}, 1`);
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${lastIndex}`);
    const lastElem = this.nextTemp();
    this.emit(`${lastElem} = load i8*, i8** ${elemPtr}`);
    this.emit(`store i32 ${lastIndex}, i32* ${lenPtr}`);
    this.emit(`br label %${endLabel}`);
    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = phi i8* [ ${emptyStr}, %${emptyLabel} ], [ ${lastElem}, %${notEmptyLabel} ]`);
    this.ctx.setVariableType(result, 'i8*');
    return result;
  }

  private doPointerArrayPop(arrayPtr: string): string {
    const castPtr = this.nextTemp();
    this.emit(`${castPtr} = bitcast i8* ${arrayPtr} to %Array*`);
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${castPtr}, i32 0, i32 1`);
    const currentLen = this.nextTemp();
    this.emit(`${currentLen} = load i32, i32* ${lenPtr}`);
    const isEmpty = this.nextTemp();
    this.emit(`${isEmpty} = icmp eq i32 ${currentLen}, 0`);
    const emptyLabel = this.nextLabel('pop_empty');
    const notEmptyLabel = this.nextLabel('pop_notempty');
    const endLabel = this.nextLabel('pop_end');
    this.emit(`br i1 ${isEmpty}, label %${emptyLabel}, label %${notEmptyLabel}`);
    this.emit(`${emptyLabel}:`);
    const nullPtr = this.nextTemp();
    this.emit(`${nullPtr} = inttoptr i64 0 to i8*`);
    this.emit(`br label %${endLabel}`);
    this.emit(`${notEmptyLabel}:`);
    const lastIndex = this.nextTemp();
    this.emit(`${lastIndex} = sub i32 ${currentLen}, 1`);
    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %Array, %Array* ${castPtr}, i32 0, i32 0`);
    const dataPtrRaw = this.nextTemp();
    this.emit(`${dataPtrRaw} = load double*, double** ${dataPtrField}`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = bitcast double* ${dataPtrRaw} to i8**`);
    const elemPtr = this.nextTemp();
    this.emit(`${elemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${lastIndex}`);
    const lastElem = this.nextTemp();
    this.emit(`${lastElem} = load i8*, i8** ${elemPtr}`);
    this.emit(`store i32 ${lastIndex}, i32* ${lenPtr}`);
    this.emit(`br label %${endLabel}`);
    this.emit(`${endLabel}:`);
    const result = this.nextTemp();
    this.emit(`${result} = phi i8* [ ${nullPtr}, %${emptyLabel} ], [ ${lastElem}, %${notEmptyLabel} ]`);
    this.ctx.setVariableType(result, 'i8*');
    return result;
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
      predicateFn = this.ctx.mangleUserName((predicateArg as VariableNode).name);
    } else if (predicateArg.type === 'arrow_function') {
      if (isStringArray || isObjectArray) {
        this.ctx.setExpectedCallbackParamType('string');
      }
      predicateFn = this.ctx.generateExpression(predicateArg, params);
      this.ctx.setExpectedCallbackParamType(null);
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
      predicateFn = this.ctx.mangleUserName((predicateArg as VariableNode).name);
    } else if (predicateArg.type === 'arrow_function') {
      if (isStringArray || isObjectArray) {
        this.ctx.setExpectedCallbackParamType('string');
      }
      predicateFn = this.ctx.generateExpression(predicateArg, params);
      this.ctx.setExpectedCallbackParamType(null);
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
      predicateFn = this.ctx.mangleUserName((predicateArg as VariableNode).name);
    } else if (predicateArg.type === 'arrow_function') {
      if (isStringArray || isObjectArray) {
        this.ctx.setExpectedCallbackParamType('string');
      }
      predicateFn = this.ctx.generateExpression(predicateArg, params);
      this.ctx.setExpectedCallbackParamType(null);
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
      predicateFn = this.ctx.mangleUserName((predicateArg as VariableNode).name);
    } else if (predicateArg.type === 'arrow_function') {
      if (isStringArray || isObjectArray) {
        this.ctx.setExpectedCallbackParamType('string');
      }
      predicateFn = this.ctx.generateExpression(predicateArg, params);
      this.ctx.setExpectedCallbackParamType(null);
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
      callbackFn = this.ctx.mangleUserName((callbackArg as VariableNode).name);
    } else if (callbackArg.type === 'arrow_function') {
      if (isStringArray || isObjectArray) {
        this.ctx.setExpectedCallbackParamType('string');
      }
      callbackFn = this.ctx.generateExpression(callbackArg, params);
      this.ctx.setExpectedCallbackParamType(null);
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

  generateArrayReduce(expr: MethodCallNode, params: string[]): string {
    if (expr.args.length < 1 || expr.args.length > 2) {
      throw new Error('reduce() requires 1-2 arguments (callback, optional initialValue)');
    }

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

    const callbackArg = expr.args[0];
    let callbackFn: string;

    if (callbackArg.type === 'variable') {
      callbackFn = this.ctx.mangleUserName((callbackArg as VariableNode).name);
    } else if (callbackArg.type === 'arrow_function') {
      if (isStringArray) {
        this.ctx.setExpectedCallbackParamType('string');
      }
      callbackFn = this.ctx.generateExpression(callbackArg, params);
      this.ctx.setExpectedCallbackParamType(null);
    } else {
      throw new Error('reduce() first argument must be a function name or inline function');
    }

    if (isStringArray) {
      return this.generateStringArrayReduce(arrayPtr, callbackFn, expr, params);
    }

    const arrayMeta = this.loadArrayMeta(arrayPtr) as { length: string; dataPtr: string };
    const length = arrayMeta.length;
    const dataPtr = arrayMeta.dataPtr;

    const checkLabel = this.nextLabel('reduce_check');
    const bodyLabel = this.nextLabel('reduce_body');
    const endLabel = this.nextLabel('reduce_end');

    const accPtr = this.nextTemp();
    this.emit(`${accPtr} = alloca double`);

    const counterPtr = this.nextTemp();
    this.emit(`${counterPtr} = alloca i32`);

    if (expr.args.length === 2) {
      const initVal = this.ctx.generateExpression(expr.args[1], params);
      this.emit(`store double ${initVal}, double* ${accPtr}`);
      this.emit(`store i32 0, i32* ${counterPtr}`);
    } else {
      const firstElemPtr = this.nextTemp();
      this.emit(`${firstElemPtr} = getelementptr inbounds double, double* ${dataPtr}, i32 0`);
      const firstElem = this.nextTemp();
      this.emit(`${firstElem} = load double, double* ${firstElemPtr}`);
      this.emit(`store double ${firstElem}, double* ${accPtr}`);
      this.emit(`store i32 1, i32* ${counterPtr}`);
    }

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

    const acc = this.nextTemp();
    this.emit(`${acc} = load double, double* ${accPtr}`);

    const newAcc = this.nextTemp();
    this.emit(`${newAcc} = call double @${callbackFn}(double ${acc}, double ${elem})`);
    this.emit(`store double ${newAcc}, double* ${accPtr}`);

    const nextCounter = this.nextTemp();
    this.emit(`${nextCounter} = add i32 ${counter}, 1`);
    this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
    this.emit(`br label %${checkLabel}`);

    this.emit(`${endLabel}:`);
    const finalAcc = this.nextTemp();
    this.emit(`${finalAcc} = load double, double* ${accPtr}`);
    return finalAcc;
  }

  private generateStringArrayReduce(arrayPtr: string, callbackFn: string, expr: MethodCallNode, params: string[]): string {
    const lenPtr = this.nextTemp();
    this.emit(`${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`);
    const length = this.nextTemp();
    this.emit(`${length} = load i32, i32* ${lenPtr}`);

    const dataPtrField = this.nextTemp();
    this.emit(`${dataPtrField} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`);
    const dataPtr = this.nextTemp();
    this.emit(`${dataPtr} = load i8**, i8*** ${dataPtrField}`);

    const checkLabel = this.nextLabel('reduce_check');
    const bodyLabel = this.nextLabel('reduce_body');
    const endLabel = this.nextLabel('reduce_end');

    const accPtr = this.nextTemp();
    this.emit(`${accPtr} = alloca i8*`);

    const counterPtr = this.nextTemp();
    this.emit(`${counterPtr} = alloca i32`);

    if (expr.args.length === 2) {
      const initVal = this.ctx.generateExpression(expr.args[1], params);
      this.emit(`store i8* ${initVal}, i8** ${accPtr}`);
      this.emit(`store i32 0, i32* ${counterPtr}`);
    } else {
      const firstElemPtr = this.nextTemp();
      this.emit(`${firstElemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 0`);
      const firstElem = this.nextTemp();
      this.emit(`${firstElem} = load i8*, i8** ${firstElemPtr}`);
      this.emit(`store i8* ${firstElem}, i8** ${accPtr}`);
      this.emit(`store i32 1, i32* ${counterPtr}`);
    }

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

    const acc = this.nextTemp();
    this.emit(`${acc} = load i8*, i8** ${accPtr}`);

    const newAcc = this.nextTemp();
    this.emit(`${newAcc} = call i8* @${callbackFn}(i8* ${acc}, i8* ${elem})`);
    this.emit(`store i8* ${newAcc}, i8** ${accPtr}`);

    const nextCounter = this.nextTemp();
    this.emit(`${nextCounter} = add i32 ${counter}, 1`);
    this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
    this.emit(`br label %${checkLabel}`);

    this.emit(`${endLabel}:`);
    const finalAcc = this.nextTemp();
    this.emit(`${finalAcc} = load i8*, i8** ${accPtr}`);
    return finalAcc;
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
      callbackFn = this.ctx.mangleUserName((callbackArg as VariableNode).name);
    } else if (callbackArg.type === 'arrow_function') {
      if (isStringArray || isObjectArray) {
        this.ctx.setExpectedCallbackParamType('string');
      }
      if (!isStringArray && !isObjectArray) {
        this.ctx.setExpectedCallbackReturnType('number');
      }
      callbackFn = this.ctx.generateExpression(callbackArg, params);
      this.ctx.setExpectedCallbackParamType(null);
      this.ctx.setExpectedCallbackReturnType(null);
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
    if (expr.args.length > 1) {
      throw new Error('join() accepts 0 or 1 arguments (separator)');
    }

    const arrayPtr = this.ctx.generateExpression(expr.object, params);
    let separator: string;
    if (expr.args.length === 1) {
      separator = this.ctx.generateExpression(expr.args[0], params);
    } else {
      separator = this.ctx.stringGenCreateStringConstant(',');
    }

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

    const sepLen = this.nextTemp();
    this.emit(`${sepLen} = call i64 @strlen(i8* ${separator})`);

    const totalSizePtr = this.ctx.nextAllocaReg('join_total');
    this.emit(`${totalSizePtr} = alloca i64`);
    this.emit(`store i64 0, i64* ${totalSizePtr}`);

    const sizeCheckLabel = this.nextLabel('join_size_check');
    const sizeBodyLabel = this.nextLabel('join_size_body');
    const sizeEndLabel = this.nextLabel('join_size_end');

    const sizeCounterPtr = this.ctx.nextAllocaReg('join_size_idx');
    this.emit(`${sizeCounterPtr} = alloca i32`);
    this.emit(`store i32 0, i32* ${sizeCounterPtr}`);

    this.emit(`br label %${sizeCheckLabel}`);

    this.emit(`${sizeCheckLabel}:`);
    const sizeCounter = this.nextTemp();
    this.emit(`${sizeCounter} = load i32, i32* ${sizeCounterPtr}`);
    const sizeCond = this.nextTemp();
    this.emit(`${sizeCond} = icmp slt i32 ${sizeCounter}, ${length}`);
    this.emit(`br i1 ${sizeCond}, label %${sizeBodyLabel}, label %${sizeEndLabel}`);

    this.emit(`${sizeBodyLabel}:`);
    const sizeElemPtr = this.nextTemp();
    this.emit(`${sizeElemPtr} = getelementptr inbounds i8*, i8** ${dataPtr}, i32 ${sizeCounter}`);
    const sizeElem = this.nextTemp();
    this.emit(`${sizeElem} = load i8*, i8** ${sizeElemPtr}`);
    const sizeElemNull = this.nextTemp();
    this.emit(`${sizeElemNull} = icmp eq i8* ${sizeElem}, null`);
    const sizeSkipLabel = this.nextLabel('join_size_skip');
    const sizeAddLabel = this.nextLabel('join_size_add');
    this.emit(`br i1 ${sizeElemNull}, label %${sizeSkipLabel}, label %${sizeAddLabel}`);

    this.emit(`${sizeAddLabel}:`);
    const elemLen = this.nextTemp();
    this.emit(`${elemLen} = call i64 @strlen(i8* ${sizeElem})`);
    const curTotal = this.nextTemp();
    this.emit(`${curTotal} = load i64, i64* ${totalSizePtr}`);
    const newTotal = this.nextTemp();
    this.emit(`${newTotal} = add i64 ${curTotal}, ${elemLen}`);
    this.emit(`store i64 ${newTotal}, i64* ${totalSizePtr}`);
    this.emit(`br label %${sizeSkipLabel}`);

    this.emit(`${sizeSkipLabel}:`);
    const sizeNextCounter = this.nextTemp();
    this.emit(`${sizeNextCounter} = add i32 ${sizeCounter}, 1`);
    this.emit(`store i32 ${sizeNextCounter}, i32* ${sizeCounterPtr}`);
    this.emit(`br label %${sizeCheckLabel}`);

    this.emit(`${sizeEndLabel}:`);
    const elemTotal = this.nextTemp();
    this.emit(`${elemTotal} = load i64, i64* ${totalSizePtr}`);
    const lengthI64 = this.nextTemp();
    this.emit(`${lengthI64} = sext i32 ${length} to i64`);
    const hasElements = this.nextTemp();
    this.emit(`${hasElements} = icmp sgt i64 ${lengthI64}, 0`);
    const sepCountRaw = this.nextTemp();
    this.emit(`${sepCountRaw} = sub i64 ${lengthI64}, 1`);
    const sepCount = this.nextTemp();
    this.emit(`${sepCount} = select i1 ${hasElements}, i64 ${sepCountRaw}, i64 0`);
    const totalSepLen = this.nextTemp();
    this.emit(`${totalSepLen} = mul i64 ${sepCount}, ${sepLen}`);
    const totalWithSep = this.nextTemp();
    this.emit(`${totalWithSep} = add i64 ${elemTotal}, ${totalSepLen}`);
    const finalSize = this.nextTemp();
    this.emit(`${finalSize} = add i64 ${totalWithSep}, 1`);
    const resultBuffer = this.nextTemp();
    this.emit(`${resultBuffer} = call i8* @GC_malloc_atomic(i64 ${finalSize})`);

    const offsetPtr = this.ctx.nextAllocaReg('join_offset');
    this.emit(`${offsetPtr} = alloca i64`);
    this.emit(`store i64 0, i64* ${offsetPtr}`);

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

    const elemIsNull = this.nextTemp();
    this.emit(`${elemIsNull} = icmp eq i8* ${elem}, null`);
    const elemSkipLabel = this.nextLabel('join_elem_skip');
    const elemCopyLabel = this.nextLabel('join_elem_copy');
    this.emit(`br i1 ${elemIsNull}, label %${elemSkipLabel}, label %${elemCopyLabel}`);

    this.emit(`${elemCopyLabel}:`);
    const isNotFirst = this.nextTemp();
    this.emit(`${isNotFirst} = icmp sgt i32 ${counter}, 0`);
    const addSepLabel = this.nextLabel('join_add_sep');
    const afterSepLabel = this.nextLabel('join_after_sep');
    this.emit(`br i1 ${isNotFirst}, label %${addSepLabel}, label %${afterSepLabel}`);

    this.emit(`${addSepLabel}:`);
    const sepOffset = this.nextTemp();
    this.emit(`${sepOffset} = load i64, i64* ${offsetPtr}`);
    const sepDst = this.nextTemp();
    this.emit(`${sepDst} = getelementptr inbounds i8, i8* ${resultBuffer}, i64 ${sepOffset}`);
    this.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${sepDst}, i8* ${separator}, i64 ${sepLen}, i1 false)`);
    const sepOffsetNew = this.nextTemp();
    this.emit(`${sepOffsetNew} = add i64 ${sepOffset}, ${sepLen}`);
    this.emit(`store i64 ${sepOffsetNew}, i64* ${offsetPtr}`);
    this.emit(`br label %${afterSepLabel}`);

    this.emit(`${afterSepLabel}:`);
    const curOffset = this.nextTemp();
    this.emit(`${curOffset} = load i64, i64* ${offsetPtr}`);
    const elemDst = this.nextTemp();
    this.emit(`${elemDst} = getelementptr inbounds i8, i8* ${resultBuffer}, i64 ${curOffset}`);
    const elemLength = this.nextTemp();
    this.emit(`${elemLength} = call i64 @strlen(i8* ${elem})`);
    this.emit(`call void @llvm.memcpy.p0i8.p0i8.i64(i8* ${elemDst}, i8* ${elem}, i64 ${elemLength}, i1 false)`);
    const newOffset = this.nextTemp();
    this.emit(`${newOffset} = add i64 ${curOffset}, ${elemLength}`);
    this.emit(`store i64 ${newOffset}, i64* ${offsetPtr}`);
    this.emit(`br label %${elemSkipLabel}`);

    this.emit(`${elemSkipLabel}:`);

    const nextCounter = this.nextTemp();
    this.emit(`${nextCounter} = add i32 ${counter}, 1`);
    this.emit(`store i32 ${nextCounter}, i32* ${counterPtr}`);
    this.emit(`br label %${checkLabel}`);

    this.emit(`${endLabel}:`);
    const finalOffset = this.nextTemp();
    this.emit(`${finalOffset} = load i64, i64* ${offsetPtr}`);
    const nullTermPtr = this.nextTemp();
    this.emit(`${nullTermPtr} = getelementptr inbounds i8, i8* ${resultBuffer}, i64 ${finalOffset}`);
    this.emit(`store i8 0, i8* ${nullTermPtr}`);
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
      callbackFn = this.ctx.mangleUserName((callbackArg as VariableNode).name);
    } else if (callbackArg.type === 'arrow_function') {
      this.ctx.setExpectedCallbackParamType('string');
      this.ctx.setExpectedCallbackReturnType('string');
      callbackFn = this.ctx.generateExpression(callbackArg, params);
      this.ctx.setExpectedCallbackParamType(null);
      this.ctx.setExpectedCallbackReturnType(null);
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
    let isObjectArray = false;
    const exprObjBase = expr.object as ExprBase;
    if (exprObjBase.type === 'variable') {
      const varName = (expr.object as VariableNode).name;
      const varType = this.ctx.getVariableType(varName);
      isStringArray = varType === '%StringArray*';
      isObjectArray = varType === '%ObjectArray*';
    } else {
      const ptrType = this.ctx.getVariableType(arrayPtr);
      isStringArray = ptrType === '%StringArray*';
      isObjectArray = ptrType === '%ObjectArray*';
    }

    if (expr.args.length !== 1) {
      throw new Error('concat() requires exactly 1 argument');
    }

    const otherArrayPtr = this.ctx.generateExpression(expr.args[0], params);

    if (isStringArray) {
      return this.generateStringArrayConcat(arrayPtr, otherArrayPtr);
    }

    if (isObjectArray) {
      return this.generateObjectArrayConcat(arrayPtr, otherArrayPtr);
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

  private generateObjectArrayConcat(arrayPtr: string, otherArrayPtr: string): string {
    const lenPtr1 = this.nextTemp();
    this.emit(`${lenPtr1} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 1`);
    const len1 = this.nextTemp();
    this.emit(`${len1} = load i32, i32* ${lenPtr1}`);

    const lenPtr2 = this.nextTemp();
    this.emit(`${lenPtr2} = getelementptr inbounds %ObjectArray, %ObjectArray* ${otherArrayPtr}, i32 0, i32 1`);
    const len2 = this.nextTemp();
    this.emit(`${len2} = load i32, i32* ${lenPtr2}`);

    const totalLen = this.nextTemp();
    this.emit(`${totalLen} = add i32 ${len1}, ${len2}`);

    const sizePtr = this.nextTemp();
    this.emit(`${sizePtr} = getelementptr %ObjectArray, %ObjectArray* null, i32 1`);
    const structSize = this.nextTemp();
    this.emit(`${structSize} = ptrtoint %ObjectArray* ${sizePtr} to i64`);
    const arrayMem = this.nextTemp();
    this.emit(`${arrayMem} = call i8* @GC_malloc(i64 ${structSize})`);
    const newArrayPtr = this.nextTemp();
    this.emit(`${newArrayPtr} = bitcast i8* ${arrayMem} to %ObjectArray*`);

    const totalLenI64 = this.nextTemp();
    this.emit(`${totalLenI64} = zext i32 ${totalLen} to i64`);
    const dataSize = this.nextTemp();
    this.emit(`${dataSize} = mul i64 ${totalLenI64}, 8`);
    const dataMem = this.nextTemp();
    this.emit(`${dataMem} = call i8* @GC_malloc(i64 ${dataSize})`);
    const newDataPtr = this.nextTemp();
    this.emit(`${newDataPtr} = bitcast i8* ${dataMem} to i8**`);

    const dataPtrField1 = this.nextTemp();
    this.emit(`${dataPtrField1} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`);
    const dataI8_1 = this.nextTemp();
    this.emit(`${dataI8_1} = load i8*, i8** ${dataPtrField1}`);
    const dataPtr1 = this.nextTemp();
    this.emit(`${dataPtr1} = bitcast i8* ${dataI8_1} to i8**`);

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
    this.emit(`${dataPtrField2} = getelementptr inbounds %ObjectArray, %ObjectArray* ${otherArrayPtr}, i32 0, i32 0`);
    const dataI8_2 = this.nextTemp();
    this.emit(`${dataI8_2} = load i8*, i8** ${dataPtrField2}`);
    const dataPtr2 = this.nextTemp();
    this.emit(`${dataPtr2} = bitcast i8* ${dataI8_2} to i8**`);

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
    this.emit(`${newDataField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${newArrayPtr}, i32 0, i32 0`);
    const newDataI8 = this.nextTemp();
    this.emit(`${newDataI8} = bitcast i8** ${newDataPtr} to i8*`);
    this.emit(`store i8* ${newDataI8}, i8** ${newDataField}`);

    const newLenField = this.nextTemp();
    this.emit(`${newLenField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${newArrayPtr}, i32 0, i32 1`);
    this.emit(`store i32 ${totalLen}, i32* ${newLenField}`);

    const newCapField = this.nextTemp();
    this.emit(`${newCapField} = getelementptr inbounds %ObjectArray, %ObjectArray* ${newArrayPtr}, i32 0, i32 2`);
    this.emit(`store i32 ${totalLen}, i32* ${newCapField}`);

    this.ctx.setVariableType(newArrayPtr, '%ObjectArray*');
    return newArrayPtr;
  }
}

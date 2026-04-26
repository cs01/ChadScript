import {
  Expression,
  ClassNode,
  ClassMethod,
  ClassField,
  FunctionParameter,
  VariableNode,
  InterfaceDeclaration,
  CommonField,
  TypeAliasDeclaration,
} from "../../../ast/types.js";
import { IGeneratorContext } from "../../infrastructure/generator-context.js";
import {
  SymbolKind,
  SymbolKind_Number,
  SymbolKind_String,
  SymbolKind_Array,
  SymbolKind_StringArray,
  SymbolKind_Object,
  SymbolKind_Class,
  createObjectMetadata,
  createObjectMetadataWithInterface,
  createObjectMetadataWithInterfaceAndPointerAlloca,
  createClassMetadata,
} from "../../infrastructure/symbol-table.js";
import {
  stripOptional,
  canonicalTypeToLlvm,
  classifyArray,
  arrayKindToLlvm,
  ArrayKind_None,
} from "../../infrastructure/type-system.js";
import type { FieldInfo } from "../../infrastructure/type-resolver/types.js";
import { emitZext, emitSitofp, emitPtrtoint } from "../../infrastructure/ir-builders.js";

// ============================================
// CLASS GENERATOR - Class and instance operations
// ============================================

export class ClassGenerator {
  // Track class structures: className -> ALL fields (including inherited)
  public classFields: Map<string, ClassField[]>;

  constructor(private ctx: IGeneratorContext) {
    this.classFields = new Map();
  }

  private findClassNode(className: string): ClassNode | null {
    const ast = this.ctx.getAst();
    if (!ast || !ast.classes) return null;
    for (let ci = 0; ci < ast.classes.length; ci++) {
      const c = ast.classes[ci] as ClassNode;
      if (!c) continue;
      if (!c.name) continue;
      if (c.name === className) {
        return c;
      }
    }
    return null;
  }

  private findInheritedConstructor(parentClassName: string): ClassMethod | null {
    const parentNode = this.findClassNode(parentClassName);
    if (!parentNode) return null;
    for (let mi = 0; mi < parentNode.methods.length; mi++) {
      const m = parentNode.methods[mi] as ClassMethod;
      if (m && m.isConstructor) return m;
    }
    if (parentNode.extends) {
      return this.findInheritedConstructor(parentNode.extends as string);
    }
    return null;
  }

  private getAllFieldsIncludingInherited(classNode: ClassNode): ClassField[] {
    const allFields: ClassField[] = [];
    if (classNode.extends) {
      const parentClass = this.findClassNode(classNode.extends);
      if (parentClass) {
        const parentFields = this.getAllFieldsIncludingInherited(parentClass);
        for (let i = 0; i < parentFields.length; i++) {
          allFields.push(parentFields[i]);
        }
      }
    }
    for (let i = 0; i < classNode.fields.length; i++) {
      if ((classNode.fields[i] as ClassField).isStatic) continue;
      allFields.push(classNode.fields[i]);
    }
    return allFields;
  }

  private fieldToLlvmType(f: ClassField): string {
    if (!f) return this.ctx.emitError("fieldToLlvmType called with null/undefined field");
    const ft = f.fieldType;
    let ts = f.tsType;
    if (ts && ts.indexOf(" | ") !== -1) {
      ts = ts
        .replace(/ \| undefined/g, "")
        .replace(/ \| null/g, "")
        .trim();
    }
    if (ts && this.isEnumType(ts)) {
      return "double";
    }
    if (!ft || ft === "double") {
      if (ts) {
        if (ts.startsWith("Map<string,")) {
          return "%StringMap*";
        } else if (ts.startsWith("Map<")) {
          return "%Map*";
        } else if (ts === "Set<string>") {
          return "%StringSet*";
        } else if (ts.startsWith("Set<")) {
          return "%Set*";
        } else if (ts === "number" || ts === "boolean") {
          return "double";
        }
        if (ts.endsWith("[]")) {
          return "%ObjectArray*";
        }
        const classNode = this.findClassNode(ts);
        if (classNode) {
          return "%" + ts + "_struct*";
        }
        if (this.isEnumType(ts)) {
          return "double";
        }
        return "i8*";
      }
      if (ft === "double") return "double";
      return this.ctx.emitError(
        `fieldToLlvmType: field '${f.name}' has no fieldType and no tsType`,
      );
    }
    if (ft === "string") {
      return "i8*";
    } else if (ft === "string[]") {
      return "%StringArray*";
    }
    const ftAk = classifyArray(ft);
    if (ftAk !== ArrayKind_None) {
      return arrayKindToLlvm(ftAk);
    }
    if (ft === "boolean") {
      return "double";
    } else if (ts) {
      if (ts.startsWith("Map<string,")) {
        return "%StringMap*";
      } else if (ts.startsWith("Map<")) {
        return "%Map*";
      } else if (ts === "Set<string>") {
        return "%StringSet*";
      } else if (ts.startsWith("Set<")) {
        return "%Set*";
      } else if (ts === "number" || ts === "boolean") {
        return "double";
      }
      const tsAk2 = classifyArray(ts);
      if (tsAk2 !== ArrayKind_None) {
        return arrayKindToLlvm(tsAk2);
      }
      {
        const classNode = this.findClassNode(ts);
        if (classNode) {
          return "%" + ts + "_struct*";
        }
        if (this.isEnumType(ts)) {
          return "double";
        }
        return "i8*";
      }
    }
    return this.ctx.emitError(
      `fieldToLlvmType: unrecognized field type '${ft}' with no tsType for field '${f.name}'`,
    );
  }

  private emitFieldInit(fieldPtr: string, llvmType: string): void {
    if (llvmType === "double") {
      this.ctx.emitStore("double", "0.0", fieldPtr);
    } else if (llvmType === "%Array*") {
      const sizePtr = this.ctx.emitGep("%Array", "null", "i32 1");
      const structSize = emitPtrtoint(this.ctx, sizePtr, "%Array*", "i64");
      const arrayMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
      const arrayPtr = this.ctx.emitBitcast(arrayMem, "i8*", "%Array*");
      const dataPtr = this.nextTemp();
      this.emit(`${dataPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 0`);
      this.ctx.emitStore("double*", "null", dataPtr);
      const lenPtr = this.nextTemp();
      this.emit(`${lenPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 1`);
      this.ctx.emitStore("i32", "0", lenPtr);
      const capPtr = this.nextTemp();
      this.emit(`${capPtr} = getelementptr inbounds %Array, %Array* ${arrayPtr}, i32 0, i32 2`);
      this.ctx.emitStore("i32", "0", capPtr);
      this.ctx.emitStore("%Array*", arrayPtr, fieldPtr);
    } else if (llvmType === "%StringArray*") {
      const sizePtr = this.ctx.emitGep("%StringArray", "null", "i32 1");
      const structSize = emitPtrtoint(this.ctx, sizePtr, "%StringArray*", "i64");
      const arrayMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
      const arrayPtr = this.ctx.emitBitcast(arrayMem, "i8*", "%StringArray*");
      const dataPtr = this.nextTemp();
      this.emit(
        `${dataPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 0`,
      );
      this.ctx.emitStore("i8**", "null", dataPtr);
      const lenPtr = this.nextTemp();
      this.emit(
        `${lenPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 1`,
      );
      this.ctx.emitStore("i32", "0", lenPtr);
      const capPtr = this.nextTemp();
      this.emit(
        `${capPtr} = getelementptr inbounds %StringArray, %StringArray* ${arrayPtr}, i32 0, i32 2`,
      );
      this.ctx.emitStore("i32", "0", capPtr);
      this.ctx.emitStore("%StringArray*", arrayPtr, fieldPtr);
    } else if (llvmType === "%ObjectArray*") {
      const sizePtr = this.ctx.emitGep("%ObjectArray", "null", "i32 1");
      const structSize = emitPtrtoint(this.ctx, sizePtr, "%ObjectArray*", "i64");
      const arrayMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
      const arrayPtr = this.ctx.emitBitcast(arrayMem, "i8*", "%ObjectArray*");
      const dataPtr = this.nextTemp();
      this.emit(
        `${dataPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 0`,
      );
      this.ctx.emitStore("i8*", "null", dataPtr);
      const lenPtr = this.nextTemp();
      this.emit(
        `${lenPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 1`,
      );
      this.ctx.emitStore("i32", "0", lenPtr);
      const capPtr = this.nextTemp();
      this.emit(
        `${capPtr} = getelementptr inbounds %ObjectArray, %ObjectArray* ${arrayPtr}, i32 0, i32 2`,
      );
      this.ctx.emitStore("i32", "0", capPtr);
      this.ctx.emitStore("%ObjectArray*", arrayPtr, fieldPtr);
    } else if (llvmType === "%StringMap*") {
      const initialCapacity = 16;
      const arrBytes = initialCapacity * 8;
      const sizePtr = this.ctx.emitGep("%StringMap", "null", "i32 1");
      const structSize = emitPtrtoint(this.ctx, sizePtr, "%StringMap*", "i64");
      const mapMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${structSize}`);
      const mapPtr = this.ctx.emitBitcast(mapMem, "i8*", "%StringMap*");
      const keysDataMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${arrBytes}`);
      const keysData = this.ctx.emitBitcast(keysDataMem, "i8*", "i8**");
      const valuesDataMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${arrBytes}`);
      const valuesData = this.ctx.emitBitcast(valuesDataMem, "i8*", "i8**");
      const keysPtr = this.nextTemp();
      this.emit(
        `${keysPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 0`,
      );
      this.ctx.emitStore("i8**", keysData, keysPtr);
      const valuesPtr = this.nextTemp();
      this.emit(
        `${valuesPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 1`,
      );
      this.ctx.emitStore("i8**", valuesData, valuesPtr);
      const lenPtr = this.nextTemp();
      this.emit(
        `${lenPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 2`,
      );
      this.ctx.emitStore("i32", "0", lenPtr);
      const capPtr = this.nextTemp();
      this.emit(
        `${capPtr} = getelementptr inbounds %StringMap, %StringMap* ${mapPtr}, i32 0, i32 3`,
      );
      this.ctx.emitStore("i32", `${initialCapacity}`, capPtr);
      this.ctx.emitStore("%StringMap*", mapPtr, fieldPtr);
    } else {
      this.ctx.emitStore(llvmType, "null", fieldPtr);
    }
  }

  // Helper methods delegate to context
  private nextTemp(): string {
    return this.ctx.nextTemp();
  }
  private emit(instruction: string): void {
    this.ctx.emit(instruction);
  }

  // Helper to get field info
  getFieldInfo(
    className: string,
    fieldName: string,
  ): {
    index: number;
    type: "double" | "string" | "string[]" | "number[]" | "boolean[]" | "boolean";
    tsType?: string;
  } | null {
    let fields = this.classFields.get(className);

    if (fields === undefined || fields === null) {
      const classNode = this.findClassNode(className);
      if (classNode) {
        fields = this.getAllFieldsIncludingInherited(classNode);
        this.classFields.set(className, fields);
      } else {
        return null;
      }
    }

    if (fields) {
      let index: number = -1;
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i] as ClassField;
        if (f.name === fieldName) {
          index = i;
          break;
        }
      }
      if (index !== -1) {
        const foundField = fields[index] as {
          name: string;
          fieldType: "double" | "string" | "string[]" | "number[]" | "boolean[]" | "boolean";
          tsType: string;
        };
        return { index, type: foundField.fieldType || "double", tsType: foundField.tsType };
      }
    }

    return null;
  }

  // Helper to get just the field type as a string (for ChadScript compatibility)
  getFieldType(className: string, fieldName: string): string | null {
    const info = this.getFieldInfo(className, fieldName);
    if (info) {
      const infoTyped = info as FieldInfo;
      return infoTyped.type;
    }
    return null;
  }

  // Helper to get just the tsType as a string (for ChadScript compatibility)
  getFieldTsType(className: string, fieldName: string): string | null {
    const info = this.getFieldInfo(className, fieldName);
    if (info) {
      const infoTyped = info as FieldInfo;
      return infoTyped.tsType || null;
    }
    return null;
  }

  getMethodInfo(
    className: string,
    methodName: string,
  ): { method: ClassMethod; ownerClass: string } | null {
    let classNodeResult: ClassNode | null = null;
    const ast = this.ctx.getAst();
    if (ast && ast.classes) {
      for (let ci = 0; ci < ast.classes.length; ci++) {
        const c = ast.classes[ci] as ClassNode;
        if (!c) continue;
        if (!c.name) continue;
        if (c.name === className) {
          classNodeResult = ast.classes[ci] as ClassNode;
          break;
        }
      }
    }
    if (!classNodeResult) {
      return null;
    }
    const classNode = classNodeResult as ClassNode;
    for (let mi = 0; mi < classNode.methods.length; mi++) {
      const m = classNode.methods[mi];
      if (!m) continue;
      if (!m.name) continue;
      if (m.name === methodName && !m.isConstructor) {
        return { method: m, ownerClass: className };
      }
    }
    if (classNode.extends) {
      return this.getMethodInfo(classNode.extends as string, methodName);
    }
    return null;
  }

  // Helper to get class fields
  getClassFields(className: string): {
    name: string;
    fieldType: "double" | "string" | "string[]" | "number[]" | "boolean[]" | "boolean";
  }[] {
    return this.classFields.get(className) || [];
  }

  generateClass(classNode: ClassNode): string {
    const className = classNode.name;
    const parts: string[] = [];

    const allFields = this.getAllFieldsIncludingInherited(classNode);

    this.classFields.set(className, allFields);

    const fieldLlvmTypes: string[] = [];
    for (let fi = 0; fi < allFields.length; fi++) {
      const f = allFields[fi] as ClassField;
      if (!f) continue;
      fieldLlvmTypes.push(this.fieldToLlvmType(f));
    }

    if (!this.structTypesEmitted) {
      if (allFields.length > 0) {
        const joinedTypes = fieldLlvmTypes.join(", ");
        const structDef = "%" + className + "_struct = type { " + joinedTypes + " }\n\n";
        parts.push(structDef);
      } else {
        const structDef = "%" + className + "_struct = type { }\n\n";
        parts.push(structDef);
      }
    }

    let constructorResult: ClassMethod | null = null;
    for (let mi = 0; mi < classNode.methods.length; mi++) {
      const m = classNode.methods[mi] as ClassMethod;
      if (!m) continue;
      if (m.isConstructor) {
        constructorResult = m;
      }
    }
    const constructor = constructorResult as ClassMethod;

    if (constructorResult) {
      this.ctx.clearOutput();
      const constructorIr = this.generateConstructor(className, constructor, allFields);
      if (constructorIr.length > 0) {
        const ctorPrefix = constructorIr.substr(0, 40);
        if (ctorPrefix.indexOf("define") === -1) {
          console.log(
            "WARNING: constructor for " +
              className +
              " does not start with define! prefix=" +
              ctorPrefix,
          );
        }
        parts.push(constructorIr);
        parts.push("\n");
      } else {
        console.log("WARNING: constructor for " + className + " returned falsy");
      }
    } else {
      const inheritedCtor = classNode.extends
        ? this.findInheritedConstructor(classNode.extends as string)
        : null;
      if (inheritedCtor) {
        this.ctx.clearOutput();
        const constructorIr = this.generateConstructor(className, inheritedCtor, allFields);
        if (constructorIr.length > 0) {
          parts.push(constructorIr);
          parts.push("\n");
        }
      } else {
        const defaultCtorIr = this.generateDefaultConstructorFromTypes(
          className,
          fieldLlvmTypes,
          allFields,
        );
        if (defaultCtorIr.length > 0) {
          parts.push(defaultCtorIr);
          parts.push("\n");
        }
      }
    }

    // Emit static fields as LLVM globals
    for (let fi = 0; fi < classNode.fields.length; fi++) {
      const field = classNode.fields[fi] as ClassField;
      if (!field || !field.isStatic) continue;
      const globalName = `@${this.ctx.mangleUserName(className)}_${field.name}`;
      const llvmType = this.fieldToLlvmType(field);
      let defaultVal = "0.0";
      if (llvmType === "i8*") defaultVal = "null";
      else if (llvmType === "i1") defaultVal = "0";
      else if (llvmType.endsWith("*")) defaultVal = "null";
      parts.push(`${globalName} = global ${llvmType} ${defaultVal}\n`);
    }

    for (let methodIdx = 0; methodIdx < classNode.methods.length; methodIdx++) {
      const method = classNode.methods[methodIdx] as ClassMethod;
      if (!method) {
        continue;
      }
      if (!method.name) {
        continue;
      }
      if (!method.isConstructor) {
        this.ctx.clearOutput();
        const methodIr = method.isStatic
          ? this.generateStaticMethod(className, method)
          : this.generateMethod(className, method, allFields);
        if (methodIr.length > 0) {
          parts.push(methodIr);
          parts.push("\n");
        }
      }
    }

    return parts.join("");
  }

  private generateConstructor(
    className: string,
    constructor: ClassMethod,
    _fieldsIgnored: ClassField[],
  ): string {
    const fieldsFromMap = this.classFields.get(className);
    const fields = fieldsFromMap || [];
    const structType = `%${className}_struct*`;
    let ir = `define ${structType} @${this.ctx.mangleUserName(className)}_constructor(`;
    const paramLLVMTypes: string[] = [];
    let paramTsTypes: string[];
    if (constructor.paramTypes) {
      paramTsTypes = constructor.paramTypes;
    } else {
      paramTsTypes = [];
    }
    if (constructor.paramTypes && constructor.paramTypes.length > 0) {
      for (let ptIdx = 0; ptIdx < constructor.paramTypes.length; ptIdx++) {
        const pType = constructor.paramTypes[ptIdx];
        paramLLVMTypes.push(this.tsTypeToLlvm(pType));
      }
    } else {
      for (let i = 0; i < constructor.params.length; i++) {
        paramLLVMTypes.push("double");
      }
    }

    const paramParts: string[] = [];
    for (let argIdx = 0; argIdx < paramLLVMTypes.length; argIdx++) {
      paramParts.push(paramLLVMTypes[argIdx] + " %arg" + argIdx);
    }
    ir += paramParts.join(", ");
    ir += ") {\n";
    ir += "entry:\n";
    this.ctx.setCurrentLabel("entry");

    for (let i = 0; i < constructor.params.length; i++) {
      const paramName = constructor.params[i];
      const allocaReg = this.nextTemp();
      const llvmType = paramLLVMTypes[i];
      let tsType: string | undefined = undefined;
      if (i < paramTsTypes.length) {
        tsType = paramTsTypes[i];
      }

      this.defineParameterWithType(paramName, allocaReg, llvmType, tsType);
      this.emit(`${allocaReg} = alloca ${llvmType}`);
      this.ctx.emitStore(llvmType, `%arg${i}`, allocaReg);
    }

    let objPtr: string;

    if (fields.length > 0) {
      const sizeofReg = this.ctx.emitGep(`%${className}_struct`, "null", "i32 1");
      const sizeReg = emitPtrtoint(this.ctx, sizeofReg, `%${className}_struct*`, "i64");

      const objMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${sizeReg}`);
      objPtr = this.ctx.emitBitcast(objMem, "i8*", `%${className}_struct*`);

      for (let i = 0; i < fields.length; i++) {
        const classField = fields[i];
        if (!classField) continue;
        const fieldPtr = this.nextTemp();
        const llvmType = this.fieldToLlvmType(classField);
        this.emit(
          `${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${objPtr}, i32 0, i32 ${i}`,
        );
        this.emitFieldInit(fieldPtr, llvmType);
      }
    } else {
      const sizeofReg = this.ctx.emitGep(`%${className}_struct`, "null", "i32 1");
      const sizeReg = emitPtrtoint(this.ctx, sizeofReg, `%${className}_struct*`, "i64");
      const objMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${sizeReg}`);
      objPtr = this.ctx.emitBitcast(objMem, "i8*", `%${className}_struct*`);
    }

    this.ctx.setThisPointer(objPtr);
    this.ctx.setCurrentClassName(className);
    this.ctx.setCurrentFunction("constructor");
    this.ctx.setCurrentFunctionReturnType(structType);

    const hasParamProps = constructor.parameterProperties;
    if (hasParamProps) {
      const paramProps = hasParamProps;
      const paramPropsLen = paramProps.length;
      for (let i = 0; i < paramPropsLen; i++) {
        const propName = paramProps[i];
        let paramIndex: number = -1;
        for (let pi = 0; pi < constructor.params.length; pi++) {
          if (constructor.params[pi] === propName) {
            paramIndex = pi;
            break;
          }
        }
        if (paramIndex !== -1) {
          const fieldInfo = this.getFieldInfo(className, propName);
          if (fieldInfo) {
            const fieldInfoTyped = fieldInfo as FieldInfo;
            const fieldIndex = fieldInfoTyped.index;
            const paramAlloca = this.ctx.getVariableAlloca(propName);
            if (paramAlloca) {
              const paramLlvmType = paramLLVMTypes[paramIndex];
              const loadedValue = this.ctx.emitLoad(paramLlvmType, paramAlloca);

              const fieldLlvmType = this.fieldToLlvmType(fields[fieldIndex]);

              let valueToStore = loadedValue;
              if (paramLlvmType !== fieldLlvmType && paramLlvmType === "i8*") {
                const castValue = this.ctx.emitBitcast(loadedValue, "i8*", fieldLlvmType);
                valueToStore = castValue;
              }

              const fieldPtr = this.nextTemp();
              this.emit(
                `${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${objPtr}, i32 0, i32 ${fieldIndex}`,
              );
              this.ctx.emitStore(fieldLlvmType, valueToStore, fieldPtr);
            }
          }
        }
      }
    }

    for (let fi = 0; fi < fields.length; fi++) {
      const classField = fields[fi] as ClassField;
      if (!classField) continue;
      if (!classField.initializer) continue;
      const initType = classField.initializer.type;
      if (
        initType !== "string" &&
        initType !== "number" &&
        initType !== "boolean" &&
        initType !== "null" &&
        initType !== "array" &&
        initType !== "new" &&
        initType !== "unary"
      )
        continue;
      const initResult = this.ctx.generateExpression(classField.initializer, constructor.params);
      if (initResult) {
        const fieldPtr = this.nextTemp();
        const llvmType = this.fieldToLlvmType(classField);
        this.emit(
          `${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${objPtr}, i32 0, i32 ${fi}`,
        );
        const resultType = this.ctx.getVariableType(initResult) || "double";
        if (resultType !== llvmType && llvmType === "double" && resultType === "i1") {
          const conv = emitZext(this.ctx, initResult, "i1", "i32");
          const conv2 = emitSitofp(this.ctx, conv, "i32");
          this.ctx.emitStore("double", conv2, fieldPtr);
        } else if (resultType !== llvmType && llvmType === "double" && resultType === "i64") {
          const conv = emitSitofp(this.ctx, initResult, "i64");
          this.ctx.emitStore("double", conv, fieldPtr);
        } else if (resultType !== llvmType) {
          const cast = this.ctx.emitBitcast(initResult, resultType, llvmType);
          this.ctx.emitStore(llvmType, cast, fieldPtr);
        } else {
          this.ctx.emitStore(llvmType, initResult, fieldPtr);
        }
      }
    }

    this.ctx.generateBlock(constructor.body, constructor.params);

    const deferredAllocas = this.ctx.getAllocaInstructions();
    if (deferredAllocas.length > 0) {
      const newOutput: string[] = [];
      for (let i = 0; i < deferredAllocas.length; i++) {
        newOutput.push(deferredAllocas[i]);
      }
      const outputLen = this.ctx.getOutputLength();
      for (let i = 0; i < outputLen; i++) {
        newOutput.push(this.ctx.getOutputLine(i));
      }
      this.ctx.clearOutput();
      for (let i = 0; i < newOutput.length; i++) {
        this.ctx.pushOutput(newOutput[i]);
      }
      this.ctx.clearAllocaInstructions();
    }

    if (this.ctx.getOutputLength() > 0) {
      const indented = this.ctx.getOutputAsIndentedString("  ");
      ir += indented;
      ir += "\n";
    }
    ir += `  ret ${structType} ${objPtr}` + "\n";
    ir += "}\n";

    return ir;
  }

  private generateDefaultConstructor(className: string, allFields: ClassField[]): string {
    const fieldLlvmTypes: string[] = [];
    for (let i = 0; i < allFields.length; i++) {
      const f = allFields[i] as ClassField;
      if (!f) continue;
      fieldLlvmTypes.push(this.fieldToLlvmType(f));
    }
    return this.generateDefaultConstructorFromTypes(className, fieldLlvmTypes, allFields);
  }

  private generateDefaultConstructorFromTypes(
    className: string,
    fieldLlvmTypes: string[],
    classFields?: ClassField[],
  ): string {
    const structType = `%${className}_struct*`;
    let ir = `define ${structType} @${this.ctx.mangleUserName(className)}_constructor() {` + "\n";
    ir += "entry:\n";

    this.ctx.clearOutput();
    this.ctx.setCurrentLabel("entry");

    let objPtr: string;

    if (fieldLlvmTypes.length > 0) {
      const sizeofReg = this.ctx.emitGep(`%${className}_struct`, "null", "i32 1");
      const sizeReg = emitPtrtoint(this.ctx, sizeofReg, `%${className}_struct*`, "i64");

      const objMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${sizeReg}`);
      objPtr = this.ctx.emitBitcast(objMem, "i8*", `%${className}_struct*`);

      for (let i = 0; i < fieldLlvmTypes.length; i++) {
        const llvmType = fieldLlvmTypes[i];
        const fieldPtr = this.nextTemp();
        this.emit(
          `${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${objPtr}, i32 0, i32 ${i}`,
        );
        this.emitFieldInit(fieldPtr, llvmType);
      }
    } else {
      const sizeofReg = this.ctx.emitGep(`%${className}_struct`, "null", "i32 1");
      const sizeReg = emitPtrtoint(this.ctx, sizeofReg, `%${className}_struct*`, "i64");
      const objMem = this.ctx.emitCall("i8*", "@GC_malloc", `i64 ${sizeReg}`);
      objPtr = this.ctx.emitBitcast(objMem, "i8*", `%${className}_struct*`);
    }

    if (classFields) {
      this.ctx.setThisPointer(objPtr);
      this.ctx.setCurrentClassName(className);
      for (let fi = 0; fi < classFields.length; fi++) {
        const cf = classFields[fi] as ClassField;
        if (!cf) continue;
        if (!cf.initializer) continue;
        const initType = cf.initializer.type;
        if (
          initType !== "string" &&
          initType !== "number" &&
          initType !== "boolean" &&
          initType !== "null" &&
          initType !== "array" &&
          initType !== "new" &&
          initType !== "unary"
        )
          continue;
        const initResult = this.ctx.generateExpression(cf.initializer, []);
        if (initResult) {
          const fieldPtr = this.nextTemp();
          const llvmType = fieldLlvmTypes[fi];
          this.emit(
            `${fieldPtr} = getelementptr inbounds %${className}_struct, %${className}_struct* ${objPtr}, i32 0, i32 ${fi}`,
          );
          const resultType = this.ctx.getVariableType(initResult) || "double";
          if (resultType !== llvmType && llvmType === "double" && resultType === "i1") {
            const conv = emitZext(this.ctx, initResult, "i1", "i32");
            const conv2 = emitSitofp(this.ctx, conv, "i32");
            this.ctx.emitStore("double", conv2, fieldPtr);
          } else if (resultType !== llvmType && llvmType === "double" && resultType === "i64") {
            const conv = emitSitofp(this.ctx, initResult, "i64");
            this.ctx.emitStore("double", conv, fieldPtr);
          } else if (resultType !== llvmType) {
            const cast = this.ctx.emitBitcast(initResult, resultType, llvmType);
            this.ctx.emitStore(llvmType, cast, fieldPtr);
          } else {
            this.ctx.emitStore(llvmType, initResult, fieldPtr);
          }
        }
      }
    }

    if (this.ctx.getOutputLength() > 0) {
      const indented = this.ctx.getOutputAsIndentedString("  ");
      ir += indented;
      ir += "\n";
    }
    ir += `  ret ${structType} ${objPtr}` + "\n";
    ir += "}\n";

    return ir;
  }

  private generateMethod(
    className: string,
    method: ClassMethod,
    _fieldsIgnored: ClassField[],
  ): string {
    const fields = this.classFields.get(className) || [];
    let returnLLVMType = "double";
    if (method.returnType && method.returnType.length > 0) {
      returnLLVMType = this.tsTypeToLlvm(method.returnType);
    }

    const thisType = `%${className}_struct*`;

    let hasOptionalParams = false;
    if (method.parameters) {
      for (let pi = 0; pi < method.parameters.length; pi++) {
        const p = method.parameters[pi] as FunctionParameter;
        if (p.optional || p.defaultValue) {
          hasOptionalParams = true;
          break;
        }
      }
    }

    let ir = `define ${returnLLVMType} @${this.ctx.mangleUserName(className)}_${method.name}(${thisType} %this`;

    const paramLLVMTypes: string[] = [];
    const paramTsTypes: string[] = method.paramTypes || [];
    for (let i = 0; i < method.params.length; i++) {
      if (method.paramTypes && i < method.paramTypes.length && method.paramTypes[i]) {
        paramLLVMTypes.push(this.tsTypeToLlvm(method.paramTypes[i]));
      } else {
        paramLLVMTypes.push("double");
      }
    }

    const paramParts: string[] = [];
    if (hasOptionalParams) {
      paramParts.push("i32 %__argc");
    }
    for (let pidx = 0; pidx < paramLLVMTypes.length; pidx++) {
      const noalias = paramLLVMTypes[pidx].indexOf("*") !== -1 ? " noalias" : "";
      paramParts.push(paramLLVMTypes[pidx] + noalias + " %arg" + pidx);
    }
    if (paramParts.length > 0) {
      ir += ", " + paramParts.join(", ");
    }
    ir += ") {\n";
    ir += "entry:\n";
    this.ctx.setCurrentLabel("entry");

    const thisAlloca = this.nextTemp();
    this.emit(`${thisAlloca} = alloca ${thisType}`);
    this.ctx.emitStore(thisType, "%this", thisAlloca);
    const thisLoaded = this.ctx.emitLoad(thisType, thisAlloca);
    this.ctx.setThisPointer(thisLoaded);
    this.ctx.setCurrentClassName(className);
    this.ctx.setCurrentFunction(method.name);
    this.ctx.setCurrentFunctionReturnType(returnLLVMType);
    this.ctx.setCurrentFunctionTsReturnType(method.returnType);

    for (let i = 0; i < method.params.length; i++) {
      const paramName = method.params[i];
      const allocaReg = this.nextTemp();
      const llvmType = paramLLVMTypes[i];
      let tsType: string | undefined = undefined;
      if (i < paramTsTypes.length) {
        tsType = paramTsTypes[i];
      }

      this.defineParameterWithType(paramName, allocaReg, llvmType, tsType);
      this.emit(`${allocaReg} = alloca ${llvmType}`);

      if (hasOptionalParams && method.parameters && method.parameters[i]) {
        const paramInfo = method.parameters[i] as FunctionParameter;
        if (paramInfo.optional || paramInfo.defaultValue) {
          this.generateOptionalParamInit(i, allocaReg, llvmType, paramInfo, method.params);
          continue;
        }
      }
      this.ctx.emitStore(llvmType, `%arg${i}`, allocaReg);
    }

    // Generate body
    const result = this.ctx.generateBlock(method.body, method.params);

    const deferredAllocas = this.ctx.getAllocaInstructions();
    if (deferredAllocas.length > 0) {
      const newOutput: string[] = [];
      for (let i = 0; i < deferredAllocas.length; i++) {
        newOutput.push(deferredAllocas[i]);
      }
      const outputLen = this.ctx.getOutputLength();
      for (let i = 0; i < outputLen; i++) {
        newOutput.push(this.ctx.getOutputLine(i));
      }
      this.ctx.clearOutput();
      for (let i = 0; i < newOutput.length; i++) {
        this.ctx.pushOutput(newOutput[i]);
      }
      this.ctx.clearAllocaInstructions();
    }

    // Check for and fix incomplete return statements
    const outputLen2 = this.ctx.getOutputLength();
    const fixedOutput: string[] = [];
    for (let i = 0; i < outputLen2; i++) {
      let line = this.ctx.getOutputLine(i);
      const trimmedLine = line.trim();
      // Stage0-safe: avoid regex due to GC interference with libc malloc
      if (trimmedLine.startsWith("ret ")) {
        const rest = trimmedLine.substring(4);
        let isRetTypeOnly = false;
        let retType = "";
        if (rest === "i8*") {
          isRetTypeOnly = true;
          retType = "i8*";
        } else if (rest === "double") {
          isRetTypeOnly = true;
          retType = "double";
        } else if (rest.startsWith("%") && rest.indexOf(" ") === -1) {
          isRetTypeOnly = true;
          retType = rest;
        }
        if (isRetTypeOnly) {
          let defaultValue: string;
          if (retType === "double") {
            defaultValue = "0.0";
          } else {
            defaultValue = "null";
          }
          line = `ret ${retType} ${defaultValue}`;
        }
      }
      fixedOutput.push(line);
    }
    this.ctx.clearOutput();
    for (let i = 0; i < fixedOutput.length; i++) {
      this.ctx.pushOutput(fixedOutput[i]);
    }

    // Add generated instructions
    if (this.ctx.getOutputLength() > 0) {
      const indented = this.ctx.getOutputAsIndentedString("  ");
      ir += indented;
      ir += "\n";
    }

    // Return value based on declared return type
    const hasTerminator = this.ctx.lastInstructionIsTerminator();

    if (!hasTerminator) {
      if (returnLLVMType === "void") {
        ir += "  ret void\n";
      } else if (result !== null && result !== "" && result !== "0") {
        ir += `  ret ${returnLLVMType} ${result}` + "\n";
      } else {
        if (returnLLVMType && returnLLVMType.indexOf("*") !== -1) {
          ir += `  ret ${returnLLVMType} null` + "\n";
        } else {
          ir += `  ret ${returnLLVMType} 0.0` + "\n";
        }
      }
    }
    ir += "}\n";

    return ir;
  }

  // Static methods are namespaced standalone functions — no %this parameter
  private generateStaticMethod(className: string, method: ClassMethod): string {
    let returnLLVMType = "double";
    if (method.returnType && method.returnType.length > 0) {
      returnLLVMType = this.tsTypeToLlvm(method.returnType);
    }

    let ir = `define ${returnLLVMType} @${this.ctx.mangleUserName(className)}_${method.name}(`;

    const paramLLVMTypes: string[] = [];
    const paramTsTypes: string[] = method.paramTypes || [];
    for (let i = 0; i < method.params.length; i++) {
      if (method.paramTypes && i < method.paramTypes.length && method.paramTypes[i]) {
        paramLLVMTypes.push(this.tsTypeToLlvm(method.paramTypes[i]));
      } else {
        paramLLVMTypes.push("double");
      }
    }

    if (method.params.length > 0) {
      const paramParts: string[] = [];
      for (let pidx = 0; pidx < paramLLVMTypes.length; pidx++) {
        const noalias = paramLLVMTypes[pidx].indexOf("*") !== -1 ? " noalias" : "";
        paramParts.push(paramLLVMTypes[pidx] + noalias + " %arg" + pidx);
      }
      ir += paramParts.join(", ");
    }
    ir += ") {\n";
    ir += "entry:\n";
    this.ctx.setCurrentLabel("entry");

    // No %this pointer for static methods
    this.ctx.setThisPointer(null);
    this.ctx.setCurrentClassName(className);
    this.ctx.setCurrentFunction(method.name);
    this.ctx.setCurrentFunctionReturnType(returnLLVMType);
    this.ctx.setCurrentFunctionTsReturnType(method.returnType);

    for (let i = 0; i < method.params.length; i++) {
      const paramName = method.params[i];
      const allocaReg = this.nextTemp();
      const llvmType = paramLLVMTypes[i];
      let tsType: string | undefined = undefined;
      if (i < paramTsTypes.length) {
        tsType = paramTsTypes[i];
      }

      this.defineParameterWithType(paramName, allocaReg, llvmType, tsType);
      this.emit(`${allocaReg} = alloca ${llvmType}`);
      this.ctx.emitStore(llvmType, `%arg${i}`, allocaReg);
    }

    const result = this.ctx.generateBlock(method.body, method.params);

    const deferredAllocas = this.ctx.getAllocaInstructions();
    if (deferredAllocas.length > 0) {
      const newOutput: string[] = [];
      for (let i = 0; i < deferredAllocas.length; i++) {
        newOutput.push(deferredAllocas[i]);
      }
      const outputLen = this.ctx.getOutputLength();
      for (let i = 0; i < outputLen; i++) {
        newOutput.push(this.ctx.getOutputLine(i));
      }
      this.ctx.clearOutput();
      for (let i = 0; i < newOutput.length; i++) {
        this.ctx.pushOutput(newOutput[i]);
      }
      this.ctx.clearAllocaInstructions();
    }

    if (this.ctx.getOutputLength() > 0) {
      const indented = this.ctx.getOutputAsIndentedString("  ");
      ir += indented;
      ir += "\n";
    }

    const hasTerminator = this.ctx.lastInstructionIsTerminator();
    if (!hasTerminator) {
      if (returnLLVMType === "void") {
        ir += "  ret void\n";
      } else if (result !== null && result !== "" && result !== "0") {
        ir += `  ret ${returnLLVMType} ${result}` + "\n";
      } else {
        if (returnLLVMType && returnLLVMType.indexOf("*") !== -1) {
          ir += `  ret ${returnLLVMType} null` + "\n";
        } else {
          ir += `  ret ${returnLLVMType} 0.0` + "\n";
        }
      }
    }
    ir += "}\n";
    return ir;
  }

  generateNewExpression(className: string, args: Expression[], params: string[]): string {
    // Resolve import aliases (e.g., import MyGreeter from './greeter' → Greeter)
    const resolvedClassName = this.ctx.resolveImportAlias(className);
    const classNode = this.findClassNode(resolvedClassName);
    if (!classNode) {
      return this.ctx.emitError(
        `class '${className}' not found — cannot create instance with 'new ${className}()'`,
      );
    }
    let constructorResult2: ClassMethod | null = null;
    for (let mi = 0; mi < classNode.methods.length; mi++) {
      const m = classNode.methods[mi];
      if (!m) continue;
      if (m.isConstructor) {
        constructorResult2 = m;
        break;
      }
    }
    if (!constructorResult2 && classNode.extends) {
      constructorResult2 = this.findInheritedConstructor(classNode.extends as string);
    }
    const constructor2 = constructorResult2 as ClassMethod;
    const paramTypes = constructor2 ? constructor2.paramTypes || [] : [];
    const paramLLVMTypes: string[] = [];
    for (let pi = 0; pi < paramTypes.length; pi++) {
      const pType = paramTypes[pi];
      paramLLVMTypes.push(this.tsTypeToLlvm(pType));
    }

    const argParts: string[] = [];
    const constructorParamCount = constructor2 ? constructor2.params.length : args.length;
    const ctorLoopLimit = constructorParamCount > args.length ? constructorParamCount : args.length;
    for (let ai = 0; ai < ctorLoopLimit; ai++) {
      if (ai < args.length) {
        const arg = args[ai];
        const argBase = arg as { type: string };
        let savedDeclaredIface: string | undefined = undefined;
        let wrappedDeclaredIface = false;
        if (argBase.type === "object" && ai < paramTypes.length) {
          const tsParamType = paramTypes[ai];
          if (tsParamType && this.ctx.interfaceStructGenHasInterface(tsParamType)) {
            savedDeclaredIface = this.ctx.getCurrentDeclaredInterfaceType();
            this.ctx.setCurrentDeclaredInterfaceType(tsParamType);
            wrappedDeclaredIface = true;
          }
        }
        const val = this.ctx.generateExpression(arg, params);
        if (wrappedDeclaredIface) {
          this.ctx.setCurrentDeclaredInterfaceType(savedDeclaredIface);
        }
        const argType = ai < paramLLVMTypes.length ? paramLLVMTypes[ai] : "double";
        if (argType === "double") {
          argParts.push(argType + " " + this.ctx.ensureDouble(val));
        } else {
          argParts.push(argType + " " + val);
        }
      } else {
        const argType = ai < paramLLVMTypes.length ? paramLLVMTypes[ai] : "double";
        const defaultVal = argType === "double" ? "0.0" : "null";
        argParts.push(argType + " " + defaultVal);
      }
    }
    const argValues = argParts.join(", ");

    const fields = this.classFields.get(resolvedClassName) || [];
    const returnType = `%${resolvedClassName}_struct*`;

    const instance = this.ctx.emitCall(
      returnType,
      `@${this.ctx.mangleUserName(resolvedClassName)}_constructor`,
      argValues,
    );

    return instance;
  }

  generateMethodCall(
    instancePtr: string,
    className: string,
    methodName: string,
    args: Expression[],
    params: string[],
  ): string {
    const methodInfoResult = this.getMethodInfo(className, methodName);
    if (!methodInfoResult) {
      return this.ctx.emitError(`Method ${methodName} not found in class ${className}`);
    }
    const methodInfo = methodInfoResult as { method: ClassMethod; ownerClass: string };
    const method = methodInfo.method as ClassMethod;
    const methodOwnerClass = methodInfo.ownerClass;

    // Determine parameter types
    const paramTypes = (method as ClassMethod).paramTypes || [];
    const paramLLVMTypes: string[] = [];
    for (let pi = 0; pi < paramTypes.length; pi++) {
      const pType = paramTypes[pi];
      paramLLVMTypes.push(this.tsTypeToLlvm(pType));
    }

    let methodHasOptionalParams = false;
    if (method.parameters) {
      for (let pi = 0; pi < method.parameters.length; pi++) {
        const p = method.parameters[pi] as FunctionParameter;
        if (p.optional || p.defaultValue) {
          methodHasOptionalParams = true;
          break;
        }
      }
    }

    const argParts: string[] = [];
    if (methodHasOptionalParams) {
      argParts.push(`i32 ${args.length}`);
    }
    const loopLimit = method.params.length > args.length ? method.params.length : args.length;
    for (let ai = 0; ai < loopLimit; ai++) {
      if (ai < args.length) {
        const arg = args[ai];
        const argTyped = arg as { type: string };
        if (argTyped.type === "arrow_function" && ai < paramTypes.length) {
          const paramTypeStr = paramTypes[ai];
          if (paramTypeStr.startsWith("(")) {
            const colonIdx = paramTypeStr.indexOf(": ");
            if (colonIdx !== -1) {
              const afterColon = paramTypeStr.substring(colonIdx + 2);
              const commaIdx = afterColon.indexOf(",");
              const parenIdx = afterColon.indexOf(")");
              const endIdx =
                commaIdx === -1
                  ? parenIdx
                  : parenIdx === -1
                    ? commaIdx
                    : commaIdx < parenIdx
                      ? commaIdx
                      : parenIdx;
              const firstParamType =
                endIdx !== -1 ? afterColon.substring(0, endIdx).trim() : afterColon.trim();
              this.ctx.setExpectedCallbackParamType(firstParamType);
            }
          }
        }
        const autoSerialize =
          ai === 0 &&
          methodName === "json" &&
          className === "Context" &&
          !this.ctx.isStringExpression(arg);
        let savedDeclaredIfaceM: string | undefined = undefined;
        let wrappedDeclaredIfaceM = false;
        if (argTyped.type === "object" && ai < paramTypes.length && !autoSerialize) {
          const tsParamTypeM = paramTypes[ai];
          if (tsParamTypeM && this.ctx.interfaceStructGenHasInterface(tsParamTypeM)) {
            savedDeclaredIfaceM = this.ctx.getCurrentDeclaredInterfaceType();
            this.ctx.setCurrentDeclaredInterfaceType(tsParamTypeM);
            wrappedDeclaredIfaceM = true;
          }
        }
        const val = autoSerialize
          ? this.ctx.jsonGen.generateStringifyExpr(arg, params)
          : this.ctx.generateExpression(arg, params);
        if (wrappedDeclaredIfaceM) {
          this.ctx.setCurrentDeclaredInterfaceType(savedDeclaredIfaceM);
        }
        this.ctx.setExpectedCallbackParamType(null);

        let argType = "double";
        if (ai < paramLLVMTypes.length) {
          argType = paramLLVMTypes[ai];
        } else {
          if (this.ctx.hasVariableType(val)) {
            argType = this.ctx.getVariableType(val)!;
          } else if (val.startsWith("@.str")) {
            argType = "i8*";
          } else if (argTyped.type === "variable") {
            const varName = (arg as VariableNode).name;
            if (this.ctx.hasVariableType(`%${varName}`)) {
              argType = this.ctx.getVariableType(`%${varName}`)!;
            }
          }
        }

        if (argType === "double") {
          argParts.push(argType + " " + this.ctx.ensureDouble(val));
        } else {
          const valRef =
            val.startsWith("%") || val.startsWith("@") || val === "null" ? val : "@" + val;
          argParts.push(argType + " " + valRef);
        }
      } else {
        let argType = "double";
        if (ai < paramLLVMTypes.length) {
          argType = paramLLVMTypes[ai];
        }
        const pendingEnv = this.ctx.getLastInlineLambdaEnvPtr();
        if (pendingEnv && argType === "i8*") {
          argParts.push(`i8* ${pendingEnv}`);
          this.ctx.setLastInlineLambdaEnvPtr(null);
        } else {
          const defaultVal = argType === "double" ? "0.0" : "null";
          argParts.push(argType + " " + defaultVal);
        }
      }
    }
    const argValues = argParts.join(", ");

    // Determine return type
    let returnLLVMType = "double"; // default for JavaScript semantics
    const methodCast = method as ClassMethod;
    if (methodCast.returnType) {
      returnLLVMType = this.methodReturnTypeToLlvm(methodCast.returnType);
    }

    const fields = this.classFields.get(className) || [];
    const thisType = `%${className}_struct*`;

    let actualInstancePtr = instancePtr;
    const instancePtrType = this.ctx.getVariableType(instancePtr);
    if (instancePtrType && instancePtrType !== thisType) {
      // emitBitcast auto-calls setVariableType with toType
      const castPtr = this.ctx.emitBitcast(instancePtr, instancePtrType, thisType);
      actualInstancePtr = castPtr;
    }

    // Call the method with instance as first argument
    const argList = argValues.length > 0 ? `, ${argValues}` : "";

    if (returnLLVMType === "void") {
      // Void methods don't return a value
      this.ctx.emitCallVoid(
        `@${this.ctx.mangleUserName(methodOwnerClass)}_${methodName}`,
        `${thisType} ${actualInstancePtr}${argList}`,
      );
      return "0"; // Return dummy value for void calls
    } else {
      // emitCall auto-calls nextTemp() and setVariableType
      const result = this.ctx.emitCall(
        returnLLVMType,
        `@${this.ctx.mangleUserName(methodOwnerClass)}_${methodName}`,
        `${thisType} ${actualInstancePtr}${argList}`,
      );
      return result;
    }
  }

  // Static method call — no instance pointer, direct call to @ClassName_method(args...)
  generateStaticMethodCall(
    className: string,
    methodName: string,
    args: Expression[],
    params: string[],
  ): string {
    const methodInfoResult = this.getMethodInfo(className, methodName);
    if (!methodInfoResult) {
      return this.ctx.emitError(`Static method ${methodName} not found in class ${className}`);
    }
    const methodInfo = methodInfoResult as { method: ClassMethod; ownerClass: string };
    const method = methodInfo.method as ClassMethod;
    const methodOwnerClass = methodInfo.ownerClass;

    const paramTypes = method.paramTypes || [];
    const paramLLVMTypes: string[] = [];
    for (let pi = 0; pi < paramTypes.length; pi++) {
      paramLLVMTypes.push(this.tsTypeToLlvm(paramTypes[pi]));
    }

    const argParts: string[] = [];
    const loopLimit = method.params.length > args.length ? method.params.length : args.length;
    for (let ai = 0; ai < loopLimit; ai++) {
      if (ai < args.length) {
        const val = this.ctx.generateExpression(args[ai], params);
        let argType = ai < paramLLVMTypes.length ? paramLLVMTypes[ai] : "double";
        if (argType === "double") {
          argParts.push(argType + " " + this.ctx.ensureDouble(val));
        } else {
          argParts.push(argType + " " + val);
        }
      } else {
        const argType = ai < paramLLVMTypes.length ? paramLLVMTypes[ai] : "double";
        const defaultVal = argType === "double" ? "0.0" : "null";
        argParts.push(argType + " " + defaultVal);
      }
    }
    const argValues = argParts.join(", ");

    let returnLLVMType = "double";
    if (method.returnType) {
      returnLLVMType = this.methodReturnTypeToLlvm(method.returnType);
    }

    if (returnLLVMType === "void") {
      this.ctx.emitCallVoid(
        `@${this.ctx.mangleUserName(methodOwnerClass)}_${methodName}`,
        argValues,
      );
      return "0.0";
    } else {
      const result = this.ctx.emitCall(
        returnLLVMType,
        `@${this.ctx.mangleUserName(methodOwnerClass)}_${methodName}`,
        argValues,
      );
      return result;
    }
  }

  // Check if a class has a static method with the given name
  isStaticMethod(className: string, methodName: string): boolean {
    const ast = this.ctx.getAst();
    if (!ast || !ast.classes) return false;
    for (let ci = 0; ci < ast.classes.length; ci++) {
      const c = ast.classes[ci] as ClassNode;
      if (!c || c.name !== className) continue;
      for (let mi = 0; mi < c.methods.length; mi++) {
        const m = c.methods[mi] as ClassMethod;
        if (m && m.name === methodName && m.isStatic) return true;
      }
      break;
    }
    return false;
  }

  // Check if a class has a static field with the given name
  isStaticField(className: string, fieldName: string): boolean {
    const ast = this.ctx.getAst();
    if (!ast || !ast.classes) return false;
    for (let ci = 0; ci < ast.classes.length; ci++) {
      const c = ast.classes[ci] as ClassNode;
      if (!c || c.name !== className) continue;
      for (let fi = 0; fi < c.fields.length; fi++) {
        const f = c.fields[fi] as ClassField;
        if (f && f.name === fieldName && f.isStatic) return true;
      }
      break;
    }
    return false;
  }

  // Get the LLVM type of a static field
  getStaticFieldType(className: string, fieldName: string): string {
    const ast = this.ctx.getAst();
    if (!ast || !ast.classes) return "double";
    for (let ci = 0; ci < ast.classes.length; ci++) {
      const c = ast.classes[ci] as ClassNode;
      if (!c || c.name !== className) continue;
      for (let fi = 0; fi < c.fields.length; fi++) {
        const f = c.fields[fi] as ClassField;
        if (f && f.name === fieldName && f.isStatic) {
          return this.fieldToLlvmType(f);
        }
      }
      break;
    }
    return "double";
  }

  private tsTypeToLlvm(tsType: string): string {
    if (!tsType || tsType.length === 0) {
      return "double";
    }
    return canonicalTypeToLlvm(tsType, "default", this.isEnumType(tsType), false, "");
  }

  private isEnumType(typeName: string): boolean {
    if (!typeName || typeName.length === 0) return false;
    const ast = this.ctx.getAst();
    if (!ast) return false;
    const enums = ast.enums;
    if (!enums) return false;
    let checkType = typeName;
    if (checkType.indexOf(" | ") !== -1) {
      const parts = checkType.split(" | ");
      for (let j = 0; j < parts.length; j++) {
        const part = parts[j].trim();
        if (part !== "undefined" && part !== "null") {
          checkType = part;
          break;
        }
      }
    }
    for (let i = 0; i < enums.length; i++) {
      const enumDecl = enums[i];
      if (!enumDecl) continue;
      if (!enumDecl.name) continue;
      if (enumDecl.name === checkType) {
        return true;
      }
    }
    return false;
  }

  private methodReturnTypeToLlvm(returnType: string): string {
    if (returnType === "string") return "i8*";
    const retAk = classifyArray(returnType);
    if (retAk !== ArrayKind_None) return arrayKindToLlvm(retAk);
    if (returnType === "void") return "void";
    if (returnType === "number" || returnType === "boolean") return "double";
    if (this.isEnumType(returnType)) return "double";
    if (returnType.indexOf(" | ") !== -1) {
      const parts = returnType.split(" | ");
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (part === "string") return "i8*";
        const partAk = classifyArray(part);
        if (partAk !== ArrayKind_None) return arrayKindToLlvm(partAk);
      }
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (part !== "null" && part !== "undefined") {
          return "i8*";
        }
      }
    }
    return "i8*";
  }

  private optionalParamCounter = 0;

  private generateOptionalParamInit(
    paramIndex: number,
    allocaReg: string,
    llvmType: string,
    paramInfo: FunctionParameter,
    params: string[],
  ): void {
    const labelId = this.optionalParamCounter++;
    const hasArgLabel = `has_arg_${labelId}`;
    const noArgLabel = `no_arg_${labelId}`;
    const doneLabel = `done_arg_${labelId}`;

    const cmpReg = this.nextTemp();
    this.emit(`${cmpReg} = icmp sgt i32 %__argc, ${paramIndex}`);
    this.emit(`br i1 ${cmpReg}, label %${hasArgLabel}, label %${noArgLabel}`);

    this.emit(`${hasArgLabel}:`);
    const ptrType = llvmType === "double" ? "double*" : llvmType + "*";
    this.emit(`store ${llvmType} %arg${paramIndex}, ${ptrType} ${allocaReg}`);
    this.emit(`br label %${doneLabel}`);

    this.emit(`${noArgLabel}:`);
    if (paramInfo.defaultValue) {
      const defaultReg = this.ctx.generateExpression(paramInfo.defaultValue, params);
      const coerced = llvmType === "double" ? this.ctx.ensureDouble(defaultReg) : defaultReg;
      this.emit(`store ${llvmType} ${coerced}, ${ptrType} ${allocaReg}`);
    } else {
      const defaultVal = llvmType === "double" ? "0.0" : "null";
      this.emit(`store ${llvmType} ${defaultVal}, ${ptrType} ${allocaReg}`);
    }
    this.emit(`br label %${doneLabel}`);

    this.emit(`${doneLabel}:`);
  }

  private defineParameterWithType(
    paramName: string,
    allocaReg: string,
    llvmType: string,
    tsType: string | undefined,
  ): void {
    if (!tsType || tsType.length === 0 || tsType === "string") {
      let kind = SymbolKind_Object;
      if (llvmType === "i8*") kind = SymbolKind_String;
      else if (llvmType === "%StringArray*") kind = SymbolKind_StringArray;
      else if (llvmType === "%Array*") kind = SymbolKind_Array;
      else if (llvmType === "double") kind = SymbolKind_Number;
      this.ctx.defineVariable(paramName, allocaReg, llvmType, kind, "local");
      return;
    }

    if (tsType === "number" || tsType === "boolean") {
      this.ctx.defineVariable(paramName, allocaReg, "double", SymbolKind_Number, "local");
      return;
    }

    if (tsType === "string[]") {
      this.ctx.defineVariable(
        paramName,
        allocaReg,
        "%StringArray*",
        SymbolKind_StringArray,
        "local",
      );
      return;
    }

    if (tsType === "number[]" || tsType === "boolean[]") {
      this.ctx.defineVariable(paramName, allocaReg, "%Array*", SymbolKind_Array, "local");
      return;
    }

    let interfaceDefResult: InterfaceDeclaration | null = null;
    const ast = this.ctx.getAst();
    if (ast && ast.interfaces) {
      for (let ii = 0; ii < ast.interfaces.length; ii++) {
        const iface = ast.interfaces[ii] as InterfaceDeclaration;
        if (!iface) continue;
        if (!iface.name) continue;
        if (iface.name === tsType) {
          interfaceDefResult = iface;
          break;
        }
      }
    }
    if (interfaceDefResult) {
      const interfaceDef = interfaceDefResult as InterfaceDeclaration;
      const keys: string[] = [];
      const types: string[] = [];
      const tsTypes: string[] = [];
      const allFields = this.ctx.getAllInterfaceFields(interfaceDef);
      for (let fi = 0; fi < allFields.length; fi++) {
        const f = allFields[fi] as { name: string; type: string };
        keys.push(stripOptional(f.name));
        types.push(this.fieldTypeToLlvm(f.type));
        tsTypes.push(f.type);
      }
      const isInterfaceStruct = this.ctx.interfaceStructGen?.hasInterface(tsType);
      this.ctx.defineVariableWithMetadata(
        paramName,
        allocaReg,
        "i8*",
        SymbolKind_Object,
        "local",
        createObjectMetadataWithInterfaceAndPointerAlloca(
          { keys, types, tsTypes },
          tsType,
          !!isInterfaceStruct,
        ),
      );
      return;
    }

    let typeAlias: { name: string; unionMembers: string[] } | null = null;
    const ast2 = this.ctx.getAst();
    const typeAliases = ast2 ? ast2.typeAliases || [] : [];
    for (let i = 0; i < typeAliases.length; i++) {
      const ta = typeAliases[i] as TypeAliasDeclaration;
      if (ta.name === tsType) {
        typeAlias = ta;
        break;
      }
    }
    if (typeAlias) {
      const typeAliasTyped = typeAlias as TypeAliasDeclaration;
      if (typeAliasTyped.unionMembers) {
        const commonFields = this.getUnionCommonFields(typeAliasTyped.unionMembers);
        this.ctx.defineVariableWithMetadata(
          paramName,
          allocaReg,
          "i8*",
          SymbolKind_Object,
          "local",
          createObjectMetadata(commonFields),
        );
        return;
      }
    }

    let classDef: ClassNode | null = null;
    const ast3 = this.ctx.getAst();
    const classes = ast3 ? ast3.classes || [] : [];
    for (let i = 0; i < classes.length; i++) {
      const cls = classes[i] as ClassNode;
      if (!cls) continue;
      if (!cls.name) continue;
      if (cls.name === tsType) {
        classDef = cls;
        break;
      }
    }
    if (classDef) {
      this.ctx.defineVariableWithMetadata(
        paramName,
        allocaReg,
        "i8*",
        SymbolKind_Class,
        "local",
        createClassMetadata({ className: classDef.name }),
      );
      return;
    }

    if (tsType.startsWith("{") && tsType.endsWith("}")) {
      const inlineFields = this.parseInlineObjectFields(tsType);
      if (inlineFields.length > 0) {
        const keys: string[] = [];
        const types: string[] = [];
        const tsTypes: string[] = [];
        for (let fi = 0; fi < inlineFields.length; fi++) {
          const f = inlineFields[fi] as { name: string; type: string };
          keys.push(stripOptional(f.name));
          types.push(this.fieldTypeToLlvm(f.type));
          tsTypes.push(f.type);
        }
        this.ctx.defineVariableWithMetadata(
          paramName,
          allocaReg,
          "i8*",
          SymbolKind_Object,
          "local",
          createObjectMetadata({ keys, types, tsTypes }),
        );
        return;
      }
    }

    let builtinIfaceKeys: string[] = [];
    let builtinIfaceTypes: string[] = [];
    let builtinIfaceTsTypes: string[] = [];
    if (tsType === "HttpRequest") {
      builtinIfaceKeys = [
        "method",
        "path",
        "body",
        "contentType",
        "headers",
        "bodyLen",
        "queryString",
      ];
      builtinIfaceTypes = ["i8*", "i8*", "i8*", "i8*", "i8*", "double", "i8*"];
      builtinIfaceTsTypes = ["string", "string", "string", "string", "string", "number", "string"];
    } else if (tsType === "HttpResponse") {
      builtinIfaceKeys = ["status", "body", "headers"];
      builtinIfaceTypes = ["double", "i8*", "i8*"];
      builtinIfaceTsTypes = ["number", "string", "string"];
    } else if (tsType === "WsEvent") {
      builtinIfaceKeys = ["data", "event", "connId"];
      builtinIfaceTypes = ["i8*", "i8*", "i8*"];
      builtinIfaceTsTypes = ["string", "string", "string"];
    } else if (tsType === "MultipartPart") {
      builtinIfaceKeys = ["name", "filename", "contentType", "data", "dataLen"];
      builtinIfaceTypes = ["i8*", "i8*", "i8*", "i8*", "double"];
      builtinIfaceTsTypes = ["string", "string", "string", "string", "number"];
    }
    if (tsType && builtinIfaceKeys.length > 0) {
      this.ctx.defineVariableWithMetadata(
        paramName,
        allocaReg,
        "i8*",
        SymbolKind_Object,
        "local",
        createObjectMetadataWithInterface(
          { keys: builtinIfaceKeys, types: builtinIfaceTypes, tsTypes: builtinIfaceTsTypes },
          tsType,
        ),
      );
      return;
    }

    this.ctx.defineVariable(paramName, allocaReg, llvmType, SymbolKind_Object, "local");
  }

  private fieldTypeToLlvmPrimitive(fieldType: string): string | null {
    if (fieldType === "string") return "i8*";
    if (fieldType === "number") return "double";
    if (fieldType === "boolean") return "double";
    if (fieldType.startsWith("'") || fieldType.startsWith('"')) return "i8*";
    return null;
  }

  private fieldTypeToLlvm(fieldType: string): string {
    const prim = this.fieldTypeToLlvmPrimitive(fieldType);
    if (prim) return prim;
    const ak = classifyArray(fieldType);
    if (ak !== ArrayKind_None) return arrayKindToLlvm(ak);
    if (fieldType.indexOf(" | ") !== -1) {
      const parts = fieldType.split(" | ");
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (part === "null" || part === "undefined") continue;
        return this.fieldTypeToLlvm(part);
      }
    }
    return "i8*";
  }

  private parseInlineObjectFields(typeStr: string): { name: string; type: string }[] {
    const inner = typeStr.slice(1, typeStr.length - 1).trim();
    if (inner.length === 0) return [];
    const fields: { name: string; type: string }[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === "{" || ch === "(" || ch === "[" || ch === "<") {
        depth++;
      } else if (ch === "}" || ch === ")" || ch === "]" || ch === ">") {
        depth--;
      } else if (ch === ";" && depth === 0) {
        const part = inner.slice(start, i).trim();
        if (part) {
          const colonIdx = part.indexOf(":");
          if (colonIdx !== -1) {
            const name = part.slice(0, colonIdx).trim();
            const fieldType = part.slice(colonIdx + 1).trim();
            fields.push({ name, type: fieldType });
          }
        }
        start = i + 1;
      }
    }
    const lastPart = inner.slice(start).trim();
    if (lastPart) {
      const colonIdx = lastPart.indexOf(":");
      if (colonIdx !== -1) {
        const name = lastPart.slice(0, colonIdx).trim();
        const fieldType = lastPart.slice(colonIdx + 1).trim();
        fields.push({ name, type: fieldType });
      }
    }
    return fields;
  }

  private getUnionCommonFields(memberNames: string[]): { keys: string[]; types: string[] } {
    const interfaces: InterfaceDeclaration[] = [];
    const ast = this.ctx.getAst();
    const astInterfaces = ast ? ast.interfaces || [] : [];
    for (let i = 0; i < memberNames.length; i++) {
      const memberName = memberNames[i];
      for (let j = 0; j < astInterfaces.length; j++) {
        const iface = astInterfaces[j] as InterfaceDeclaration;
        if (!iface) continue;
        if (!iface.name) continue;
        if (iface.name === memberName) {
          interfaces.push(iface);
          break;
        }
      }
    }

    if (interfaces.length === 0) {
      return { keys: [], types: [] };
    }

    const firstInterface = interfaces[0] as InterfaceDeclaration;
    const firstFields = this.ctx.getAllInterfaceFields(firstInterface);
    const commonFields: CommonField[] = [];

    for (let fi = 0; fi < firstFields.length; fi++) {
      const field = firstFields[fi] as { name: string; type: string };
      let isCommon = true;
      for (let ii = 0; ii < interfaces.length; ii++) {
        const ifaceTyped = interfaces[ii] as InterfaceDeclaration;
        const ifaceFields = this.ctx.getAllInterfaceFields(ifaceTyped);
        let found = false;
        for (let fj = 0; fj < ifaceFields.length; fj++) {
          const f = ifaceFields[fj] as { name: string; type: string };
          if (f.name === field.name && this.areTypesCompatible(f.type, field.type)) {
            found = true;
            break;
          }
        }
        if (!found) {
          isCommon = false;
          break;
        }
      }
      if (isCommon) {
        commonFields.push({ name: field.name, type: this.normalizeType(field.type) });
      }
    }

    const keys: string[] = [];
    const types: string[] = [];
    for (let fi = 0; fi < commonFields.length; fi++) {
      const f = commonFields[fi] as CommonField;
      keys.push(stripOptional(f.name));
      types.push(this.fieldTypeToLlvm(f.type));
    }

    return {
      keys: keys,
      types: types,
    };
  }

  private areTypesCompatible(type1: string, type2: string): boolean {
    if (type1 === type2) return true;
    const norm1 = this.normalizeType(type1);
    const norm2 = this.normalizeType(type2);
    return norm1 === norm2;
  }

  private normalizeType(type: string): string {
    if (type.startsWith("'") && type.endsWith("'")) return "string";
    if (type.startsWith('"') && type.endsWith('"')) return "string";
    return type;
  }

  private structTypesEmitted: boolean = false;

  generateStructTypeDefinitions(classCount: number): string {
    if (classCount === 0) {
      return "";
    }
    const ast = this.ctx.getAst();
    if (!ast || !ast.classes) {
      return "";
    }

    let ir = "; Class struct type definitions\n";
    let hasDefinitions = false;
    const classes = ast.classes;

    for (let ci = 0; ci < classCount; ci++) {
      const classNode = classes[ci] as ClassNode;
      if (!classNode) continue;
      if (!classNode.name) continue;
      const className = classNode.name;
      const allFields = this.getAllFieldsIncludingInherited(classNode);
      this.classFields.set(className, allFields);
      hasDefinitions = true;
      if (allFields.length > 0) {
        const fieldTypes: string[] = [];
        for (let fi = 0; fi < allFields.length; fi++) {
          const f = allFields[fi] as ClassField;
          if (!f) continue;
          fieldTypes.push(this.fieldToLlvmType(f));
        }
        ir += `%${className}_struct = type { ${fieldTypes.join(", ")} }` + "\n";
      } else {
        ir += `%${className}_struct = type { }` + "\n";
      }
    }

    if (!hasDefinitions) return "";

    this.structTypesEmitted = true;
    ir += "\n";
    return ir;
  }

  hasEmittedStructTypes(): boolean {
    return this.structTypesEmitted;
  }
}

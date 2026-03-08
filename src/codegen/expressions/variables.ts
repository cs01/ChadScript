import type { SymbolTable } from "../infrastructure/symbol-table.js";
import type { InterfaceStructGenerator } from "../types/interface-struct-generator.js";
import type { SourceLocation } from "../../ast/types.js";

export interface VariableExpressionContext {
  symbolTable: SymbolTable;
  variableTypes: Map<string, string>;
  setVariableType(name: string, type: string): void;
  classGenGetClassFields(className: string): { name: string; fieldType: string }[];
  nextTemp(): string;
  emit(instruction: string): void;
  getVariableAlloca(name: string): string | undefined;
  getVariableType(name: string): string | undefined;
  interfaceStructGen?: InterfaceStructGenerator;
  interfaceStructGenHasInterface(name: string): boolean;
  getAstFunctionsLength(): number;
  getAstFunctionNameAt(index: number): string | null;
  emitError(message: string, loc?: SourceLocation, suggestion?: string): never;
}

interface ClassMeta {
  ptr: string;
  className: string;
}

interface ObjectMeta {
  ptr: string;
  keys: string[];
  types: string[];
  tsTypes?: string[];
}

/**
 * VariableExpressionGenerator
 *
 * Handles loading of all variable types from memory:
 * - Class instance variables
 * - Regex variables
 * - Map variables
 * - Set variables
 * - Array variables
 * - String array variables
 * - String variables
 * - Object variables
 * - Regular numeric/boolean variables
 */
export class VariableExpressionGenerator {
  constructor(private ctx: VariableExpressionContext) {}

  /**
   * Generate variable load
   * Checks SymbolTable and loads with correct LLVM type
   */
  generate(name: string): string {
    if (name === "null") {
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = inttoptr i64 0 to i8*`);
      this.ctx.setVariableType(temp, "i8*");
      return temp;
    }

    if (name === "undefined") {
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = inttoptr i64 0 to i8*`);
      this.ctx.setVariableType(temp, "i8*");
      return temp;
    }

    // Check if it's a class instance variable
    if (this.ctx.symbolTable.isClass(name)) {
      const classMeta = this.ctx.symbolTable.getClassInfo(name)!;
      return this.loadClassInstance(name, classMeta);
    }

    // Check if it's a regex variable
    if (this.ctx.symbolTable.isRegex(name)) {
      const allocaReg = this.ctx.getVariableAlloca(name)!;
      return this.loadRegex(allocaReg);
    }

    // Check if it's a map variable
    if (this.ctx.symbolTable.isMap(name)) {
      const allocaReg = this.ctx.getVariableAlloca(name)!;
      const mapMeta = this.ctx.symbolTable.getMapMetadata(name);
      if (mapMeta && mapMeta.keyType === "string") {
        this.ctx.setVariableType(allocaReg, "%StringMap*");
      } else {
        this.ctx.setVariableType(allocaReg, "%Map*");
      }
      return allocaReg;
    }

    // Check if it's a set variable
    if (this.ctx.symbolTable.isSet(name)) {
      const allocaReg = this.ctx.getVariableAlloca(name)!;
      const setValueType = this.ctx.symbolTable.getSetValueType(name);
      if (setValueType === "string") {
        this.ctx.setVariableType(allocaReg, "%StringSet*");
      } else {
        this.ctx.setVariableType(allocaReg, "%Set*");
      }
      return allocaReg;
    }

    // Check if it's an array variable (number or boolean array)
    if (this.ctx.symbolTable.isNumberArray(name)) {
      const allocaReg = this.ctx.symbolTable.getAlloca(name)!;
      const llvmType = this.ctx.symbolTable.getType(name);
      if (llvmType === "%Array*") {
        const isPointerAlloca = this.ctx.symbolTable.isPointerAlloca(name);
        return this.loadArray(allocaReg, "%Array*", isPointerAlloca);
      } else if (llvmType === "i8*") {
        const temp = this.ctx.nextTemp();
        this.ctx.emit(`${temp} = load i8*, i8** ${allocaReg}`);
        this.ctx.setVariableType(temp, "i8*");
        return temp;
      }
      return allocaReg;
    }

    // Check if it's a string array variable
    if (this.ctx.symbolTable.isStringArray(name)) {
      const allocaReg = this.ctx.symbolTable.getAlloca(name)!;
      const llvmType = this.ctx.symbolTable.getType(name);
      if (llvmType === "%StringArray*") {
        const isPointerAlloca = this.ctx.symbolTable.isPointerAlloca(name);
        return this.loadArray(allocaReg, "%StringArray*", isPointerAlloca);
      } else if (llvmType === "i8*") {
        const temp = this.ctx.nextTemp();
        this.ctx.emit(`${temp} = load i8*, i8** ${allocaReg}`);
        this.ctx.setVariableType(temp, "i8*");
        return temp;
      }
      return allocaReg;
    }

    if (this.ctx.symbolTable.isUint8Array(name)) {
      const allocaReg = this.ctx.symbolTable.getAlloca(name)!;
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = load %Uint8Array*, %Uint8Array** ${allocaReg}`);
      this.ctx.setVariableType(temp, "%Uint8Array*");
      return temp;
    }

    // Check if it's a string variable
    if (this.ctx.symbolTable.isString(name)) {
      const allocaReg = this.ctx.symbolTable.getAlloca(name)!;
      return this.loadString(allocaReg);
    }

    // Check if it's an object variable
    if (this.ctx.symbolTable.isObject(name)) {
      const objectMeta = this.ctx.symbolTable.getObjectInfo(name);
      if (objectMeta) {
        const interfaceType = this.ctx.symbolTable.getInterfaceType(name);
        return this.loadObject(objectMeta, interfaceType);
      }
      // Fall through to regular variable handling if no metadata
    }

    // Load regular variable with proper type from variableTypes map
    if (!name) {
      return this.ctx.emitError("Variable expression has no name property");
    }

    // Handle __chadscript global
    if (name === "__chadscript") {
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = load double, double* @__chadscript`);
      this.ctx.setVariableType(temp, "double");
      return temp;
    }

    const allocaReg = this.ctx.getVariableAlloca(name);
    if (allocaReg) {
      return this.loadRegularVariable(name, allocaReg);
    }

    const funcCount = this.ctx.getAstFunctionsLength();
    for (let fi = 0; fi < funcCount; fi++) {
      const funcName = this.ctx.getAstFunctionNameAt(fi);
      if (funcName === name) {
        return "_cs_" + name;
      }
    }

    return this.ctx.emitError("Unknown variable: " + name);
  }

  private loadClassInstance(_name: string, classMeta: ClassMeta): string {
    const fields = this.ctx.classGenGetClassFields(classMeta.className);
    const ptrType = fields.length > 0 ? `%${classMeta.className}_struct*` : "double*";

    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = load ${ptrType}, ${ptrType}* ${classMeta.ptr}`);
    this.ctx.setVariableType(temp, ptrType);
    return temp;
  }

  private loadRegex(allocaReg: string): string {
    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = load i8*, i8** ${allocaReg}`);
    this.ctx.setVariableType(temp, "i8*");
    return temp;
  }

  private loadString(allocaReg: string): string {
    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = load i8*, i8** ${allocaReg}`);
    this.ctx.setVariableType(temp, "i8*");
    return temp;
  }

  private loadArray(allocaReg: string, arrayType: string, isPointerAlloca: boolean): string {
    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = load ${arrayType}, ${arrayType}* ${allocaReg}`);
    this.ctx.setVariableType(temp, arrayType);
    return temp;
  }

  private loadObject(objectMeta: ObjectMeta, _interfaceType?: string): string {
    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = load i8*, i8** ${objectMeta.ptr}`);
    this.ctx.setVariableType(temp, "i8*");
    return temp;
  }

  private loadRegularVariable(name: string, allocaReg: string): string {
    const temp = this.ctx.nextTemp();
    let varType = this.ctx.getVariableType(name) || "double";
    const isTreeSitterType =
      varType === "%TSNode*" ||
      varType === "%TSTree*" ||
      varType === "%TSParser*" ||
      varType === "%TSLanguage*";
    if (isTreeSitterType) {
      this.ctx.emit(`${temp} = load double, double* ${allocaReg}`);
      this.ctx.setVariableType(temp, varType);
      return temp;
    }
    if (!this.isValidLlvmType(varType)) {
      varType = "i8*";
    }
    const ptrToType = `${varType}*`;
    this.ctx.emit(`${temp} = load ${varType}, ${ptrToType} ${allocaReg}`);
    this.ctx.setVariableType(temp, varType);
    return temp;
  }

  private isValidLlvmType(typeStr: string): boolean {
    if (!typeStr) return false;
    if (typeStr.startsWith("%{") || typeStr.includes("|") || typeStr.includes(":")) {
      return false;
    }
    if (
      typeStr === "double" ||
      typeStr === "i1" ||
      typeStr === "i8" ||
      typeStr === "i32" ||
      typeStr === "i64" ||
      typeStr === "void"
    ) {
      return true;
    }
    if (typeStr === "i8*" || typeStr === "i32*" || typeStr === "i64*" || typeStr === "double*") {
      return true;
    }
    if (typeStr.endsWith("*")) {
      const baseName = typeStr.slice(0, typeStr.length - 1);
      if (baseName.startsWith("%")) {
        // Any %Name* is a valid LLVM named struct pointer type.
        // The old whitelist approach was too fragile — types like %__FetchResponse*
        // are perfectly valid but weren't in the list. The early guards above already
        // catch leaked TypeScript types (%{...}, unions with |, types with :).
        return true;
      }
    }
    return false;
  }
}

import type { SymbolTable } from '../infrastructure/symbol-table.js';

interface ClassGeneratorLike {
  getClassFields(className: string): { name: string; fieldType: string }[];
  thisPointer?: string | null;
  currentClassName?: string | null;
}

export interface VariableExpressionContext {
  symbolTable: SymbolTable;
  variableTypes: Map<string, string>;
  setVariableType(name: string, type: string): void;
  classGen: ClassGeneratorLike;
  classGenGetClassFields(className: string): { name: string; fieldType: string }[];
  nextTemp(): string;
  emit(instruction: string): void;
  getVariableAlloca(name: string): string | undefined;
  getVariableType(name: string): string | undefined;
  symbolTableIsClass(name: string): boolean;
  symbolTableIsRegex(name: string): boolean;
  symbolTableIsMap(name: string): boolean;
  symbolTableIsSet(name: string): boolean;
  symbolTableIsNumberArray(name: string): boolean;
  symbolTableIsStringArray(name: string): boolean;
  symbolTableIsString(name: string): boolean;
  symbolTableIsObject(name: string): boolean;
  symbolTableIsPointerAlloca(name: string): boolean;
  symbolTableGetClassInfo(name: string): { ptr: string; className: string } | undefined;
  symbolTableGetMapMetadata(name: string): { keyType: string; valueType: string } | undefined;
  symbolTableGetSetMetadata(name: string): { valueType: string } | undefined;
  symbolTableGetAlloca(name: string): string | undefined;
  symbolTableGetType(name: string): string | undefined;
  symbolTableGetObjectInfo(name: string): { ptr: string; keys: string[]; types: string[]; tsTypes?: string[] } | undefined;
  symbolTableGetInterfaceType(name: string): string | undefined;
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
    if (name === 'null') {
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = inttoptr i64 0 to i8*`);
      this.ctx.setVariableType(temp, 'i8*');
      return temp;
    }

    if (name === 'undefined') {
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = inttoptr i64 0 to i8*`);
      this.ctx.setVariableType(temp, 'i8*');
      return temp;
    }

    // Check if it's a class instance variable
    if (this.ctx.symbolTableIsClass(name)) {
      const classMeta = this.ctx.symbolTableGetClassInfo(name)!;
      return this.loadClassInstance(name, classMeta);
    }

    // Check if it's a regex variable
    if (this.ctx.symbolTableIsRegex(name)) {
      const allocaReg = this.ctx.getVariableAlloca(name)!;
      return this.loadRegex(allocaReg);
    }

    // Check if it's a map variable
    if (this.ctx.symbolTableIsMap(name)) {
      const allocaReg = this.ctx.getVariableAlloca(name)!;
      const mapMeta = this.ctx.symbolTableGetMapMetadata(name);
      if (mapMeta && mapMeta.keyType === 'string') {
        this.ctx.setVariableType(allocaReg, '%StringMap*');
      } else {
        this.ctx.setVariableType(allocaReg, '%Map*');
      }
      return allocaReg;
    }

    // Check if it's a set variable
    if (this.ctx.symbolTableIsSet(name)) {
      const allocaReg = this.ctx.getVariableAlloca(name)!;
      const setMeta = this.ctx.symbolTableGetSetMetadata(name);
      if (setMeta && setMeta.valueType === 'string') {
        this.ctx.setVariableType(allocaReg, '%StringSet*');
      } else {
        this.ctx.setVariableType(allocaReg, '%Set*');
      }
      return allocaReg;
    }

    // Check if it's an array variable (number or boolean array)
    if (this.ctx.symbolTableIsNumberArray(name)) {
      const allocaReg = this.ctx.symbolTableGetAlloca(name)!;
      const llvmType = this.ctx.symbolTableGetType(name);
      if (llvmType === '%Array*') {
        const isPointerAlloca = this.ctx.symbolTableIsPointerAlloca(name);
        return this.loadArray(allocaReg, '%Array*', isPointerAlloca);
      } else if (llvmType === 'i8*') {
        const temp = this.ctx.nextTemp();
        this.ctx.emit(`${temp} = load i8*, i8** ${allocaReg}`);
        this.ctx.setVariableType(temp, 'i8*');
        return temp;
      }
      return allocaReg;
    }

    // Check if it's a string array variable
    if (this.ctx.symbolTableIsStringArray(name)) {
      const allocaReg = this.ctx.symbolTableGetAlloca(name)!;
      const llvmType = this.ctx.symbolTableGetType(name);
      if (llvmType === '%StringArray*') {
        const isPointerAlloca = this.ctx.symbolTableIsPointerAlloca(name);
        return this.loadArray(allocaReg, '%StringArray*', isPointerAlloca);
      } else if (llvmType === 'i8*') {
        const temp = this.ctx.nextTemp();
        this.ctx.emit(`${temp} = load i8*, i8** ${allocaReg}`);
        this.ctx.setVariableType(temp, 'i8*');
        return temp;
      }
      return allocaReg;
    }

    // Check if it's a string variable
    if (this.ctx.symbolTableIsString(name)) {
      const allocaReg = this.ctx.symbolTableGetAlloca(name)!;
      return this.loadString(allocaReg);
    }

    // Check if it's an object variable
    if (this.ctx.symbolTableIsObject(name)) {
      const objectMeta = this.ctx.symbolTableGetObjectInfo(name);
      if (objectMeta) {
        const interfaceType = this.ctx.symbolTableGetInterfaceType(name);
        return this.loadObject(objectMeta, interfaceType);
      }
      // Fall through to regular variable handling if no metadata
    }

    // Load regular variable with proper type from variableTypes map
    if (!name) {
      throw new Error(`Variable expression has no name property`);
    }

    // Handle __chadscript global
    if (name === '__chadscript') {
      const temp = this.ctx.nextTemp();
      this.ctx.emit(`${temp} = load double, double* @__chadscript`);
      this.ctx.setVariableType(temp, 'double');
      return temp;
    }

    const allocaReg = this.ctx.getVariableAlloca(name);
    if (allocaReg) {
      return this.loadRegularVariable(name, allocaReg);
    }

    throw new Error(`Unknown variable: ${name}`);
  }

  private loadClassInstance(_name: string, classMeta: ClassMeta): string {
    const fields = this.ctx.classGenGetClassFields(classMeta.className);
    const ptrType = fields.length > 0 ? `%${classMeta.className}_struct*` : 'double*';

    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = load ${ptrType}, ${ptrType}* ${classMeta.ptr}`);
    this.ctx.setVariableType(temp, ptrType);
    return temp;
  }

  private loadRegex(allocaReg: string): string {
    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = load i8*, i8** ${allocaReg}`);
    this.ctx.setVariableType(temp, 'i8*');
    return temp;
  }

  private loadString(allocaReg: string): string {
    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = load i8*, i8** ${allocaReg}`);
    this.ctx.setVariableType(temp, 'i8*');
    return temp;
  }

  private loadArray(allocaReg: string, arrayType: string, isPointerAlloca: boolean): string {
    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = load ${arrayType}, ${arrayType}* ${allocaReg}`);
    this.ctx.setVariableType(temp, arrayType);
    return temp;
  }

  private loadObject(objectMeta: ObjectMeta, interfaceType?: string): string {
    const temp = this.ctx.nextTemp();
    if (interfaceType) {
      const ptrType = `%${interfaceType}*`;
      this.ctx.emit(`${temp} = load ${ptrType}, ${ptrType}* ${objectMeta.ptr}`);
      this.ctx.setVariableType(temp, ptrType);
    } else {
      this.ctx.emit(`${temp} = load i8*, i8** ${objectMeta.ptr}`);
      this.ctx.setVariableType(temp, 'i8*');
    }
    return temp;
  }

  private loadRegularVariable(name: string, allocaReg: string): string {
    const temp = this.ctx.nextTemp();
    const varType = this.ctx.getVariableType(name) || 'double';
    const isTreeSitterType = varType === '%TSNode*' || varType === '%TSTree*' || varType === '%TSParser*' || varType === '%TSLanguage*';
    if (isTreeSitterType) {
      this.ctx.emit(`${temp} = load double, double* ${allocaReg}`);
      this.ctx.setVariableType(temp, varType);
      return temp;
    }
    const ptrToType = `${varType}*`;
    this.ctx.emit(`${temp} = load ${varType}, ${ptrToType} ${allocaReg}`);
    this.ctx.setVariableType(temp, varType);
    return temp;
  }
}

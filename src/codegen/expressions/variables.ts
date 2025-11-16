import { logger } from '../../utils/logger.js';

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
  constructor(private ctx: any) {}

  /**
   * Generate variable load
   * Checks SymbolTable and loads with correct LLVM type
   */
  generate(name: string): string {
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
      return this.ctx.getVariableAlloca(name)!;
    }

    // Check if it's a set variable
    if (this.ctx.symbolTable.isSet(name)) {
      return this.ctx.getVariableAlloca(name)!;
    }

    // Check if it's an array variable (number or boolean array)
    if (this.ctx.symbolTable.isNumberArray(name)) {
      return this.ctx.symbolTable.getAlloca(name)!;
    }

    // Check if it's a string array variable
    if (this.ctx.symbolTable.isStringArray(name)) {
      return this.ctx.symbolTable.getAlloca(name)!;
    }

    // Check if it's a string variable
    if (this.ctx.symbolTable.isString(name)) {
      const allocaReg = this.ctx.symbolTable.getAlloca(name)!;;
      return this.loadString(allocaReg);
    }

    // Check if it's an object variable
    if (this.ctx.symbolTable.isObject(name)) {
      const objectMeta = this.ctx.symbolTable.getObjectInfo(name);
      if (objectMeta) {
        return this.loadObject(objectMeta);
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
      this.ctx.variableTypes.set(temp, 'double');
      return temp;
    }

    const allocaReg = this.ctx.getVariableAlloca(name);
    if (allocaReg) {
      return this.loadRegularVariable(name, allocaReg);
    }

    throw new Error(`Unknown variable: ${name}`);
  }

  private loadClassInstance(name: string, classMeta: any): string {
    const fields = this.ctx.classGen.getClassFields(classMeta.className);
    const ptrType = fields.length > 0 ? `%${classMeta.className}_struct*` : 'double*';

    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = load ${ptrType}, ${ptrType}* ${classMeta.ptr}`);
    this.ctx.variableTypes.set(temp, ptrType);
    return temp;
  }

  private loadRegex(allocaReg: string): string {
    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = load i8*, i8** ${allocaReg}`);
    this.ctx.variableTypes.set(temp, 'i8*');
    return temp;
  }

  private loadString(allocaReg: string): string {
    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = load i8*, i8** ${allocaReg}`);
    this.ctx.variableTypes.set(temp, 'i8*');
    return temp;
  }

  private loadObject(objectMeta: any): string {
    // Load object pointer
    const temp = this.ctx.nextTemp();
    this.ctx.emit(`${temp} = load i8*, i8** ${objectMeta.ptr}`);
    // Convert pointer to i32 for passing as argument
    const asInt = this.ctx.nextTemp();
    this.ctx.emit(`${asInt} = ptrtoint i8* ${temp} to i32`);
    return asInt;
  }

  private loadRegularVariable(name: string, allocaReg: string): string {
    const temp = this.ctx.nextTemp();
    const varType = this.ctx.variableTypes.get(name) || 'double';
    logger.debug(`Loading variable "${name}", type: "${varType}", alloca: "${allocaReg}"`);
    this.ctx.emit(`${temp} = load ${varType}, ${varType}* ${allocaReg}`);
    this.ctx.variableTypes.set(temp, varType);
    return temp;
  }
}

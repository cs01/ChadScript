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
   * Checks all variable type maps and loads with correct LLVM type
   */
  generate(name: string): string {
    // Check if it's a class instance variable
    const classInstanceMeta = this.ctx.classInstanceVariables.get(name);
    if (classInstanceMeta) {
      return this.loadClassInstance(name, classInstanceMeta);
    }

    // Check if it's a regex variable
    const regexAllocaReg = this.ctx.regexVariables.get(name);
    if (regexAllocaReg) {
      return this.loadRegex(regexAllocaReg);
    }

    // Check if it's a map variable
    const mapAllocaReg = this.ctx.mapVariables.get(name);
    if (mapAllocaReg) {
      return mapAllocaReg;
    }

    // Check if it's a set variable
    const setAllocaReg = this.ctx.setVariables.get(name);
    if (setAllocaReg) {
      return setAllocaReg;
    }

    // Check if it's an array variable
    const arrayAllocaReg = this.ctx.arrayVariables.get(name);
    if (arrayAllocaReg) {
      return arrayAllocaReg;
    }

    // Check if it's a string array variable
    const stringArrayAllocaReg = this.ctx.stringArrayVariables.get(name);
    if (stringArrayAllocaReg) {
      return stringArrayAllocaReg;
    }

    // Check if it's a string variable
    const stringAllocaReg = this.ctx.stringVariables.get(name);
    if (stringAllocaReg) {
      return this.loadString(stringAllocaReg);
    }

    // Check if it's an object variable
    const objectMeta = this.ctx.objectVariables.get(name);
    if (objectMeta) {
      return this.loadObject(objectMeta);
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

    const allocaReg = this.ctx.variables.get(name);
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

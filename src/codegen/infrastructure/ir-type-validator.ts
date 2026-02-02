export interface IRValidatorOptions {
  throwOnError?: boolean;
  logWarnings?: boolean;
}

export class IRTypeValidator {
  private options: IRValidatorOptions;
  private registerTypes: Map<string, string> = new Map();
  private errors: string[] = [];
  private warnings: string[] = [];

  constructor(options: IRValidatorOptions = {}) {
    this.options = {
      throwOnError: options.throwOnError ?? false,
      logWarnings: options.logWarnings ?? false
    };
  }

  clear(): void {
    this.registerTypes.clear();
    this.errors = [];
    this.warnings = [];
  }

  getErrors(): string[] {
    return this.errors;
  }

  getWarnings(): string[] {
    return this.warnings;
  }

  setRegisterType(register: string, type: string): void {
    this.registerTypes.set(register, type);
  }

  getRegisterType(register: string): string | undefined {
    return this.registerTypes.get(register);
  }

  validateInstruction(instruction: string): boolean {
    const trimmed = instruction.trim();
    if (!trimmed || trimmed.endsWith(':') || trimmed.startsWith(';')) {
      return true;
    }

    if (trimmed.startsWith('%') && trimmed.includes(' = ')) {
      return this.validateAssignment(trimmed);
    }

    if (trimmed.startsWith('store ')) {
      return this.validateStore(trimmed);
    }

    if (trimmed.startsWith('ret ')) {
      return this.validateRet(trimmed);
    }

    return true;
  }

  private validateAssignment(instruction: string): boolean {
    const eqIdx = instruction.indexOf(' = ');
    if (eqIdx === -1) return true;

    const dest = instruction.substring(0, eqIdx);
    const rhs = instruction.substring(eqIdx + 3).trim();

    if (rhs.startsWith('load ')) {
      return this.validateLoad(dest, rhs);
    }

    if (rhs.startsWith('alloca ')) {
      return this.validateAlloca(dest, rhs);
    }

    if (rhs.startsWith('getelementptr ')) {
      return this.validateGep(dest, rhs);
    }

    if (rhs.startsWith('fptosi ') || rhs.startsWith('sitofp ') ||
        rhs.startsWith('bitcast ') || rhs.startsWith('ptrtoint ') ||
        rhs.startsWith('inttoptr ') || rhs.startsWith('sext ') ||
        rhs.startsWith('zext ') || rhs.startsWith('trunc ')) {
      return this.validateCast(dest, rhs);
    }

    if (rhs.startsWith('call ')) {
      return this.validateCall(dest, rhs);
    }

    if (rhs.startsWith('phi ')) {
      return this.validatePhi(dest, rhs);
    }

    return true;
  }

  private validateLoad(dest: string, rhs: string): boolean {
    const match = rhs.match(/^load\s+(\S+),\s*(\S+)\*?\s+(\S+)/);
    if (!match) return true;

    const loadType = match[1].replace(',', '');
    const ptrType = match[2];
    const srcReg = match[3];

    this.registerTypes.set(dest, loadType);

    const srcRegType = this.registerTypes.get(srcReg);
    if (srcRegType) {
      const expectedPtrType = loadType + '*';
      if (srcRegType !== expectedPtrType && srcRegType !== 'ptr') {
        this.addError(`load: source ${srcReg} has type ${srcRegType}, expected ${expectedPtrType}`);
        return false;
      }
    }

    return true;
  }

  private validateAlloca(dest: string, rhs: string): boolean {
    const match = rhs.match(/^alloca\s+(\S+)/);
    if (!match) return true;

    const allocaType = match[1].replace(',', '');
    this.registerTypes.set(dest, allocaType + '*');

    return true;
  }

  private validateGep(dest: string, rhs: string): boolean {
    const match = rhs.match(/^getelementptr\s+(?:inbounds\s+)?(\S+),/);
    if (!match) return true;

    const baseType = match[1];
    this.registerTypes.set(dest, baseType + '*');

    return true;
  }

  private validateCast(dest: string, rhs: string): boolean {
    const match = rhs.match(/\bto\s+(\S+)$/);
    if (!match) return true;

    this.registerTypes.set(dest, match[1]);
    return true;
  }

  private validateCall(dest: string, rhs: string): boolean {
    const match = rhs.match(/^call\s+(\S+)\s+@/);
    if (!match) return true;

    const returnType = match[1];
    if (returnType !== 'void') {
      this.registerTypes.set(dest, returnType);
    }

    return true;
  }

  private validatePhi(dest: string, rhs: string): boolean {
    const match = rhs.match(/^phi\s+(\S+)\s+/);
    if (!match) return true;

    this.registerTypes.set(dest, match[1]);
    return true;
  }

  private validateStore(instruction: string): boolean {
    const match = instruction.match(/^store\s+(\S+)\s+(\S+),\s*(\S+)\*?\s+(\S+)/);
    if (!match) return true;

    const valueType = match[1];
    const value = match[2].replace(',', '');
    const ptrType = match[3];
    const ptrReg = match[4];

    if (valueType !== ptrType) {
      if (!(valueType === 'ptr' || ptrType === 'ptr')) {
        this.addError(`store: value type ${valueType} does not match pointer type ${ptrType}*`);
        return false;
      }
    }

    const valueRegType = this.registerTypes.get(value);
    if (valueRegType && valueRegType !== valueType) {
      if (!(valueRegType === 'ptr' || valueType === 'ptr')) {
        this.addError(`store: register ${value} has type ${valueRegType}, but storing as ${valueType}`);
        return false;
      }
    }

    const ptrRegType = this.registerTypes.get(ptrReg);
    if (ptrRegType) {
      const expectedPtrType = valueType + '*';
      if (ptrRegType !== expectedPtrType && ptrRegType !== 'ptr') {
        this.addWarning(`store: destination ${ptrReg} has type ${ptrRegType}, expected ${expectedPtrType}`);
      }
    }

    return true;
  }

  private validateRet(instruction: string): boolean {
    return true;
  }

  private addError(message: string): void {
    this.errors.push(message);
    if (this.options.throwOnError) {
      throw new Error(`IR Type Error: ${message}`);
    }
  }

  private addWarning(message: string): void {
    this.warnings.push(message);
    if (this.options.logWarnings) {
      console.warn(`IR Type Warning: ${message}`);
    }
  }
}

export function validateStoreTypes(valueType: string, ptrType: string): boolean {
  if (valueType === ptrType) return true;
  if (valueType === 'ptr' || ptrType === 'ptr') return true;
  return false;
}

export function validateLoadTypes(loadType: string, ptrType: string): boolean {
  const expectedPtr = loadType + '*';
  if (ptrType === expectedPtr) return true;
  if (ptrType === 'ptr') return true;
  return false;
}

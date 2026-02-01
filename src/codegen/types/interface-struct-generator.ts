import { InterfaceDeclaration } from '../../ast/types.js';

const BUILTIN_TYPES = new Set([
  'Array', 'StringArray', 'Map', 'StringMap', 'Set', 'StringSet',
  'Response', 'FetchBuffer', 'Promise', 'PromiseCallback', 'PromiseAllState', 'PromiseAllContext'
]);

export interface InterfaceStructInfo {
  name: string;
  llvmType: string;
  fields: { name: string; tsType: string; llvmType: string }[];
  isBuiltinConflict: boolean;
}

export class InterfaceStructGenerator {
  private interfaceStructs: Map<string, InterfaceStructInfo> = new Map();

  constructor(private interfaces: InterfaceDeclaration[]) {
    this.buildInterfaceStructs();
  }

  private buildInterfaceStructs(): void {
    for (const iface of this.interfaces) {
      const isBuiltinConflict = BUILTIN_TYPES.has(iface.name);
      const fields = iface.fields.map(f => ({
        name: f.name,
        tsType: f.type,
        llvmType: this.tsTypeToLlvm(f.type)
      }));

      const structType = `%${iface.name}`;
      this.interfaceStructs.set(iface.name, {
        name: iface.name,
        llvmType: structType,
        fields,
        isBuiltinConflict
      });
    }
  }

  private tsTypeToLlvm(tsType: string): string {
    if (tsType === 'string') return 'i8*';
    if (tsType === 'number') return 'double';
    if (tsType === 'boolean') return 'double';
    if (tsType === 'string[]') return '%StringArray*';
    if (tsType === 'number[]' || tsType === 'boolean[]') return '%Array*';
    if (tsType.endsWith('[]')) return '%Array*';
    if (this.interfaceStructs.has(tsType)) return `%${tsType}*`;
    return 'i8*';
  }

  getInterfaceStruct(name: string): InterfaceStructInfo | undefined {
    return this.interfaceStructs.get(name);
  }

  hasInterface(name: string): boolean {
    const info = this.interfaceStructs.get(name);
    if (!info) return false;
    return !info.isBuiltinConflict;
  }

  getFieldIndex(interfaceName: string, fieldName: string): number {
    const iface = this.interfaceStructs.get(interfaceName);
    if (!iface) return -1;
    return iface.fields.findIndex(f => f.name === fieldName);
  }

  getFieldType(interfaceName: string, fieldName: string): string | undefined {
    const iface = this.interfaceStructs.get(interfaceName);
    if (!iface) return undefined;
    const field = iface.fields.find(f => f.name === fieldName);
    return field?.llvmType;
  }

  generateStructTypeDefinitions(): string {
    if (this.interfaces.length === 0) return '';

    const nonConflicting = this.interfaces.filter(i => !BUILTIN_TYPES.has(i.name));
    if (nonConflicting.length === 0) return '';

    let ir = '; Interface struct type definitions\n';

    for (const iface of nonConflicting) {
      const info = this.interfaceStructs.get(iface.name)!;
      const fieldTypes = info.fields.map(f => f.llvmType).join(', ');
      ir += `%${iface.name} = type { ${fieldTypes} }\n`;
    }

    ir += '\n';
    return ir;
  }

  getInlineStructType(interfaceName: string): string {
    const info = this.interfaceStructs.get(interfaceName);
    if (!info) return '';
    const fieldTypes = info.fields.map(f => f.llvmType).join(', ');
    return `{ ${fieldTypes} }`;
  }

  getStructSize(interfaceName: string): number {
    const info = this.interfaceStructs.get(interfaceName);
    if (!info) return 0;
    let size = 0;
    for (const field of info.fields) {
      if (field.llvmType === 'double') size += 8;
      else size += 8;
    }
    return size;
  }
}

import { InterfaceDeclaration } from '../../ast/types.js';
import { tsTypeToLlvm as tsTypeToLlvmUtil } from '../infrastructure/type-system.js';

const BUILTIN_TYPES = [
  'Array', 'StringArray', 'Map', 'StringMap', 'Set', 'StringSet',
  'Response', 'FetchBuffer', 'Promise', 'PromiseCallback', 'PromiseAllState', 'PromiseAllContext'
];

function isBuiltinType(name: string): boolean {
  return BUILTIN_TYPES.indexOf(name) !== -1;
}

export interface InterfaceStructInfo {
  name: string;
  llvmType: string;
  fields: { name: string; tsType: string; llvmType: string }[];
  isBuiltinConflict: boolean;
}

export class InterfaceStructGenerator {
  private interfaceStructs: Map<string, InterfaceStructInfo> = new Map();
  private interfaceCount: number = 0;
  private interfaces: InterfaceDeclaration[] = [];

  constructor(interfaces: InterfaceDeclaration[], interfaceCount: number) {
    this.interfaceCount = interfaceCount;
    if (interfaceCount > 0) {
      this.interfaces = interfaces;
      this.buildInterfaceStructs();
    }
  }

  private buildInterfaceStructs(): void {
    for (let idx = 0; idx < this.interfaces.length; idx++) {
      this.processInterface(idx);
    }
  }

  private processInterface(idx: number): void {
    const ifaceName = this.getInterfaceName(idx);
    const isBuiltinConflict = isBuiltinType(ifaceName);
    const fields = this.buildFields(idx);

    const structType = `%${ifaceName}`;
    this.interfaceStructs.set(ifaceName, {
      name: ifaceName,
      llvmType: structType,
      fields,
      isBuiltinConflict
    });
  }

  private getInterfaceName(idx: number): string {
    const iface = this.interfaces[idx] as InterfaceDeclaration;
    return iface.name;
  }

  private getInterfaceFields(idx: number): { name: string; type: string }[] {
    const iface = this.interfaces[idx] as InterfaceDeclaration;
    return iface.fields;
  }

  private getInterfaceByName(name: string): InterfaceDeclaration | undefined {
    for (let i = 0; i < this.interfaces.length; i++) {
      const iface = this.interfaces[i] as InterfaceDeclaration;
      if (iface.name === name) {
        return iface;
      }
    }
    return undefined;
  }

  private getInheritedFields(iface: InterfaceDeclaration): { name: string; tsType: string; llvmType: string }[] {
    const result: { name: string; tsType: string; llvmType: string }[] = [];
    const extArr = iface.extends;
    const hasExtends = extArr !== undefined && extArr !== null && extArr.length > 0;
    if (!hasExtends) {
      return result;
    }
    for (let i = 0; i < extArr!.length; i++) {
      const parentName = extArr![i];
      const parent = this.getInterfaceByName(parentName);
      const hasParent = parent !== undefined && parent !== null;
      if (hasParent) {
        const parentInherited = this.getInheritedFields(parent!);
        for (let j = 0; j < parentInherited.length; j++) {
          result.push(parentInherited[j]);
        }
        const pFields = parent!.fields;
        const hasFields = pFields !== undefined && pFields !== null && pFields.length > 0;
        if (hasFields) {
          for (let j = 0; j < pFields!.length; j++) {
            const f = pFields![j] as { name: string; type: string };
            let fieldName = f.name;
            if (fieldName.endsWith('?')) {
              fieldName = fieldName.slice(0, -1);
            }
            result.push({
              name: fieldName,
              tsType: f.type,
              llvmType: this.tsTypeToLlvmForField(fieldName, f.type)
            });
          }
        }
      }
    }
    return result;
  }

  private buildFields(idx: number): { name: string; tsType: string; llvmType: string }[] {
    const iface = this.interfaces[idx] as InterfaceDeclaration;
    const result: { name: string; tsType: string; llvmType: string }[] = [];
    const inheritedFields = this.getInheritedFields(iface);
    for (let i = 0; i < inheritedFields.length; i++) {
      result.push(inheritedFields[i]);
    }
    const fields = this.getInterfaceFields(idx);
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i] as { name: string; type: string };
      let fieldName = f.name;
      if (fieldName.endsWith('?')) {
        fieldName = fieldName.slice(0, -1);
      }
      result.push({
        name: fieldName,
        tsType: f.type,
        llvmType: this.tsTypeToLlvmForField(fieldName, f.type)
      });
    }
    return result;
  }

  private tsTypeToLlvmForField(fieldName: string, tsType: string): string {
    if (fieldName === 'nodePtr' || fieldName === 'treePtr') {
      return 'i8*';
    }
    return this.tsTypeToLlvm(tsType);
  }

  private tsTypeToLlvm(tsType: string): string {
    if (this.interfaceStructs.has(tsType)) {
      return `%${tsType}*`;
    }
    return tsTypeToLlvmUtil(tsType);
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
    const ifaceTyped = iface as InterfaceStructInfo;
    for (let i = 0; i < ifaceTyped.fields.length; i++) {
      const field = ifaceTyped.fields[i] as { name: string; tsType: string; llvmType: string };
      if (field.name === fieldName) {
        return i;
      }
    }
    return -1;
  }

  getFieldType(interfaceName: string, fieldName: string): string | undefined {
    const iface = this.interfaceStructs.get(interfaceName);
    if (!iface) return undefined;
    const ifaceTyped = iface as InterfaceStructInfo;
    for (let i = 0; i < ifaceTyped.fields.length; i++) {
      const field = ifaceTyped.fields[i] as { name: string; tsType: string; llvmType: string };
      if (field.name === fieldName) {
        return field.llvmType;
      }
    }
    return undefined;
  }

  generateStructTypeDefinitions(): string {
    if (this.interfaceCount === 0) return '';

    let ir = '; Interface struct type definitions\n';
    let hasNonConflicting = false;
    const emittedNames: string[] = [];

    for (let idx = 0; idx < this.interfaceCount; idx++) {
      const ifaceName = this.getInterfaceName(idx);
      if (isBuiltinType(ifaceName)) continue;
      if (emittedNames.indexOf(ifaceName) !== -1) continue;
      emittedNames.push(ifaceName);
      hasNonConflicting = true;
      const info = this.interfaceStructs.get(ifaceName)!;
      const fieldTypes = this.getFieldTypesString(info);
      ir += `%${ifaceName} = type { ${fieldTypes} }\n`;
    }

    if (!hasNonConflicting) return '';

    ir += '\n';
    return ir;
  }

  private getFieldTypesString(info: InterfaceStructInfo): string {
    const types: string[] = [];
    for (let i = 0; i < info.fields.length; i++) {
      const field = info.fields[i] as { name: string; tsType: string; llvmType: string };
      types.push(field.llvmType);
    }
    return types.join(', ');
  }

  getInlineStructType(interfaceName: string): string {
    const info = this.interfaceStructs.get(interfaceName);
    if (!info) return '';
    const fieldTypes = this.getFieldTypesString(info);
    return `{ ${fieldTypes} }`;
  }

  getStructSize(interfaceName: string): number {
    const info = this.interfaceStructs.get(interfaceName);
    if (!info) return 0;
    let size = 0;
    for (let i = 0; i < info.fields.length; i++) {
      const field = info.fields[i] as { name: string; tsType: string; llvmType: string };
      if (field.llvmType === 'double') size += 8;
      else size += 8;
    }
    return size;
  }
}

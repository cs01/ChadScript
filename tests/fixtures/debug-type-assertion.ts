function getFieldInfo(className: string, field: string): { index: number; type: string; tsType: string } | null {
  return { index: 0, type: 'i8*', tsType: 'string' };
}

class TypeResolver {
  currentClassName: string;

  constructor() {
    this.currentClassName = 'TestClass';
  }

  resolveType(): string | null {
    if (this.currentClassName) {
      const fieldInfoResult = getFieldInfo(this.currentClassName, 'test');
      const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
      if (fieldInfoResult && fieldInfo.tsType) {
        return fieldInfo.tsType;
      }
    }
    return null;
  }
}

const resolver = new TypeResolver();
const result = resolver.resolveType();
if (result) {
  console.log(result);
}

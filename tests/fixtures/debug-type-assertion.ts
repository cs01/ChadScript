function getFieldInfo(className: string, field: string): { index: number; type: string; tsType: string } | null {
  return { index: 0, type: 'i8*', tsType: 'string' };
}

function test(): void {
  const fieldInfoResult = getFieldInfo('Test', 'name');
  const fieldInfo = fieldInfoResult as { index: number; type: string; tsType: string };
  if (fieldInfoResult && fieldInfo.tsType) {
    console.log(fieldInfo.tsType);
  }
}

test();

import { InterfaceField } from '../../../ast/types.js';

export function splitByTopLevelSemicolon(str: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < str.length; i++) {
    const char = str.charAt(i);
    if (char === '{' || char === '(' || char === '<' || char === '[') {
      depth++;
      current += char;
    } else if (char === '}' || char === ')' || char === '>' || char === ']') {
      depth--;
      current += char;
    } else if (char === ';' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    parts.push(current);
  }
  return parts;
}

export function findTopLevelColon(str: string): number {
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charAt(i);
    if (char === '{' || char === '(' || char === '<' || char === '[') {
      depth++;
    } else if (char === '}' || char === ')' || char === '>' || char === ']') {
      depth--;
    } else if (char === ':' && depth === 0) {
      return i;
    }
  }
  return -1;
}

export function parseInlineObjectTypeForAssertion(typeStr: string): InterfaceField[] | null {
  if (!typeStr.startsWith('{') || !typeStr.endsWith('}')) {
    return null;
  }
  const inner = typeStr.slice(1, typeStr.length - 1).trim();
  if (inner.length === 0) {
    return [];
  }
  const fields: InterfaceField[] = [];
  const parts = splitByTopLevelSemicolon(inner);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;
    const colonIdx = findTopLevelColon(part);
    if (colonIdx === -1) continue;
    const name = part.slice(0, colonIdx).trim();
    const fieldType = part.slice(colonIdx + 1).trim();
    fields.push({ name, type: fieldType });
  }
  return fields;
}

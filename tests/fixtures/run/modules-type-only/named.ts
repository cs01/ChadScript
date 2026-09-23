export interface Named {
  name: string;
}

console.log("named.ts initialized");

export function describe(n: Named): string {
  return `<${n.name}>`;
}

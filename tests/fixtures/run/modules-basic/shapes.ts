// An imported module: exported class, function, const, and interface. None of it needs runtime
// module machinery — the names are resolved by tsc and lowered exactly like local ones.
export interface Named {
  name: string;
}

export const ORIGIN = 0;

export class Circle {
  radius: number;
  constructor(radius: number) {
    this.radius = radius;
  }
  area(): number {
    return 3.14159 * this.radius * this.radius;
  }
}

export function describe(n: Named): string {
  return `<${n.name}>`;
}

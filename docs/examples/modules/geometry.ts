export interface Shape {
  kind: "circle" | "square";
  size: number;
}

export function area(s: Shape): number {
  return s.kind === "circle" ? Math.PI * s.size * s.size : s.size * s.size;
}

// The program's allocation layouts (runtime shapes). Every object the program can create gets its
// layout registered here: one per class, one per distinct field list + field representation for
// literals and JSON.parse targets. HModule.shapes is the result; codegen emits one shape global per
// entry and every record points at its shape from slot 0.

import { ice } from "../diagnostics.js";
import type { ShapeDescriptor } from "../hir/nodes.js";
import type { ObjectField, ValueType } from "../hir/types.js";

export class ShapeRegistry {
  readonly shapes: ShapeDescriptor[] = [];
  private readonly byKey = new Map<string, number>();
  private readonly classShapes = new Map<string, number>();

  // A literal / JSON layout: fields in record order. Two allocations with the same names in the
  // same order and the same field representations share one shape.
  literal(fields: readonly ObjectField[]): number {
    const key = fields.map((f) => `${f.name}:${reprKey(f.type)}`).join(",");
    const hit = this.byKey.get(key);
    if (hit !== undefined) return hit;
    const id = this.shapes.length;
    this.shapes.push({ id, fields: [...fields], methods: [] });
    this.byKey.set(key, id);
    return id;
  }

  // A class's layout, registered once per class id.
  defineClass(
    className: string,
    fields: readonly ObjectField[],
    methods: { name: string; fn: string }[],
  ): number {
    if (this.classShapes.has(className)) ice(`lower: class ${className} registered twice`);
    const id = this.shapes.length;
    this.shapes.push({ id, fields: [...fields], className, methods });
    this.classShapes.set(className, id);
    return id;
  }

  classShape(className: string): number {
    return this.classShapes.get(className) ?? ice(`lower: class ${className} has no shape`);
  }
}

// A representation key for a field type: what codegen needs to know to print or serialize the
// stored Value. Nested objects dispatch on their own runtime shape, so an object field is just
// "object" here, which is also what keeps the key finite for recursive types.
function reprKey(t: ValueType): string {
  switch (t.kind) {
    case "number":
    case "string":
    case "boolean":
    case "null":
    case "undefined":
    case "unknown":
    case "object":
    case "function":
      return t.kind;
    case "opaque":
      return `opaque:${t.name}`;
    case "array":
      return `[${reprKey(t.element)}]`;
    case "optional":
      return `?${reprKey(t.inner)}`;
    case "map":
      return `map<${reprKey(t.key)},${reprKey(t.value)}>`;
    case "set":
      return `set<${reprKey(t.element)}>`;
    case "promise":
      return `promise<${reprKey(t.inner)}>`;
    default: {
      const never: never = t;
      return ice(`reprKey: unhandled ${(never as { kind: string }).kind}`);
    }
  }
}

// LLVM types, as a small closed tagged union. The backend only ever speaks these — no raw
// type strings float around. Grows one variant per phase; `llvmType()` is switch+ice so a
// new variant that forgets a rendering crashes loud instead of emitting a bad string.

import { ice } from "../diagnostics.js";

export type IrType =
  | { kind: "void" }
  | { kind: "i1" } // boolean
  | { kind: "i8" }
  | { kind: "i32" } // exit codes, int32 bitwise domain
  | { kind: "i64" }
  | { kind: "double" } // JS number
  | { kind: "ptr" }; // opaque pointer (LLVM ≥15 opaque-pointer model)

export const T = {
  void: { kind: "void" } as IrType,
  i1: { kind: "i1" } as IrType,
  i8: { kind: "i8" } as IrType,
  i32: { kind: "i32" } as IrType,
  i64: { kind: "i64" } as IrType,
  double: { kind: "double" } as IrType,
  ptr: { kind: "ptr" } as IrType,
} as const;

export function llvmType(t: IrType): string {
  switch (t.kind) {
    case "void":
      return "void";
    case "i1":
      return "i1";
    case "i8":
      return "i8";
    case "i32":
      return "i32";
    case "i64":
      return "i64";
    case "double":
      return "double";
    case "ptr":
      return "ptr";
    default:
      return ice(`llvmType: unhandled IrType ${(t as { kind: string }).kind}`);
  }
}

export function typesEqual(a: IrType, b: IrType): boolean {
  return a.kind === b.kind;
}

export type HIRType =
  | { kind: "f64" }
  | { kind: "i64" }
  | { kind: "i1" }
  | { kind: "i8ptr" }
  | { kind: "void" }
  | { kind: "ptr"; pointee: string }
  | { kind: "array"; element: HIRType }
  | { kind: "boxed" }
  | { kind: "struct"; name: string; fields: HIRField[] };

export interface HIRField {
  name: string;
  type: HIRType;
}

export type BinaryOp =
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "rem"
  | "eq"
  | "ne"
  | "lt"
  | "le"
  | "gt"
  | "ge"
  | "and"
  | "or"
  | "bit_and"
  | "bit_or"
  | "bit_xor"
  | "shl"
  | "shr"
  | "ushr";

export type UnaryOp = "neg" | "not" | "bit_not" | "typeof";

export type HIRExpr =
  | { kind: "literal_f64"; value: number; type: HIRType }
  | { kind: "literal_i64"; value: number; type: HIRType }
  | { kind: "literal_i1"; value: boolean; type: HIRType }
  | { kind: "literal_string"; value: string; type: HIRType }
  | { kind: "literal_null"; type: HIRType }
  | { kind: "local_get"; id: number; type: HIRType }
  | { kind: "local_set"; id: number; value: HIRExpr; type: HIRType }
  | { kind: "global_get"; name: string; type: HIRType }
  | { kind: "global_set"; name: string; value: HIRExpr; type: HIRType }
  | {
      kind: "binary";
      op: BinaryOp;
      left: HIRExpr;
      right: HIRExpr;
      type: HIRType;
    }
  | { kind: "unary"; op: UnaryOp; operand: HIRExpr; type: HIRType }
  | {
      kind: "call";
      callee: string;
      args: HIRExpr[];
      returnType: HIRType;
      type: HIRType;
    }
  | {
      kind: "call_indirect";
      callee: HIRExpr;
      args: HIRExpr[];
      returnType: HIRType;
      type: HIRType;
    }
  | {
      kind: "field_get";
      object: HIRExpr;
      fieldName: string;
      index: number;
      type: HIRType;
    }
  | {
      kind: "field_set";
      object: HIRExpr;
      fieldName: string;
      index: number;
      value: HIRExpr;
      type: HIRType;
    }
  | { kind: "index_get"; array: HIRExpr; index: HIRExpr; type: HIRType }
  | {
      kind: "index_set";
      array: HIRExpr;
      index: HIRExpr;
      value: HIRExpr;
      type: HIRType;
    }
  | { kind: "box"; value: HIRExpr; fromType: HIRType; type: HIRType }
  | { kind: "unbox"; value: HIRExpr; toType: HIRType; type: HIRType }
  | { kind: "narrow_i64"; value: HIRExpr; type: HIRType }
  | { kind: "widen_f64"; value: HIRExpr; type: HIRType }
  | {
      kind: "alloc_struct";
      structName: string;
      fields: HIRExpr[];
      type: HIRType;
    }
  | {
      kind: "alloc_array";
      elementType: HIRType;
      initialValues: HIRExpr[];
      type: HIRType;
    }
  | {
      kind: "runtime_call";
      func: string;
      args: HIRExpr[];
      returnType: HIRType;
      type: HIRType;
    }
  | { kind: "conditional"; condition: HIRExpr; then: HIRExpr; else: HIRExpr; type: HIRType }
  | {
      kind: "wrap_interface";
      value: HIRExpr;
      className: string;
      interfaceName: string;
      type: HIRType;
    }
  | {
      kind: "vtable_call";
      object: HIRExpr;
      interfaceName: string;
      methodName: string;
      methodIndex: number;
      args: HIRExpr[];
      returnType: HIRType;
      type: HIRType;
    };

export type HIRStmtBase =
  | {
      kind: "let";
      id: number;
      name: string;
      type: HIRType;
      init?: HIRExpr;
      mutable: boolean;
    }
  | { kind: "assign"; id: number; value: HIRExpr }
  | { kind: "expr"; expr: HIRExpr }
  | { kind: "return"; value?: HIRExpr }
  | {
      kind: "if";
      condition: HIRExpr;
      then: HIRStmt[];
      else?: HIRStmt[];
    }
  | { kind: "while"; condition: HIRExpr; body: HIRStmt[] }
  | {
      kind: "for";
      init?: HIRStmt;
      condition?: HIRExpr;
      update?: HIRExpr;
      body: HIRStmt[];
    }
  | { kind: "break" }
  | { kind: "continue" }
  | {
      kind: "switch";
      discriminant: HIRExpr;
      cases: HIRSwitchCase[];
    }
  | { kind: "throw"; value: HIRExpr }
  | {
      kind: "try";
      body: HIRStmt[];
      catch?: { paramId: number; paramName: string; body: HIRStmt[] };
      finally?: HIRStmt[];
    };

export type HIRStmt = HIRStmtBase & { line?: number };

export interface HIRSwitchCase {
  test?: HIRExpr;
  body: HIRStmt[];
}

export interface HIRParam {
  id: number;
  name: string;
  type: HIRType;
}

export interface HIRFunction {
  name: string;
  params: HIRParam[];
  returnType: HIRType;
  body: HIRStmt[];
  isAsync: boolean;
  captures: number[];
  line?: number;
}

export interface SourceInfo {
  filename: string;
  directory: string;
  source: string;
}

export interface HIRInterface {
  name: string;
  fields: HIRField[];
  methods: { name: string; params: HIRParam[]; returnType: HIRType }[];
}

export interface HIRClass {
  name: string;
  fields: HIRField[];
  methods: HIRFunction[];
  parent?: string;
  implements?: string[];
}

export interface HIRGlobal {
  name: string;
  type: HIRType;
  init?: HIRExpr;
  mutable: boolean;
}

export interface HIRModule {
  functions: HIRFunction[];
  classes: HIRClass[];
  interfaces: HIRInterface[];
  globals: HIRGlobal[];
  init: HIRStmt[];
  sourceInfo?: SourceInfo;
}

export const F64: HIRType = { kind: "f64" };
export const I64: HIRType = { kind: "i64" };
export const I1: HIRType = { kind: "i1" };
export const I8PTR: HIRType = { kind: "i8ptr" };
export const VOID: HIRType = { kind: "void" };
export const BOXED: HIRType = { kind: "boxed" };

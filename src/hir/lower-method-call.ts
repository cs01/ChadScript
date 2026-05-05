import type {
  CallExpression,
  MemberExpression,
  Identifier,
} from "@swc/core";

import type { HIRExpr, HIRType, BinaryOp } from "./types.js";
import { F64, I64, I1, I8PTR, VOID, BOXED, DYNARRAY } from "./types.js";
import { compileError } from "../errors.js";
import {
  expectedDeclType,
  setExpectedDeclType,
  setExpectedArrayElementType,
  arrayPrefix,
  mapPrefix,
  setPrefix,
  coerce,
  setExpectedClosureParamTypes,
} from "./lower-state.js";
import { lowerExpr } from "./lower-expr.js";

export function lowerStringMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;
  const args = expr.arguments.map((a) => lowerExpr(a.expression));

  if (method === "match" && args.length >= 1 && args[0].type.kind === "regex") {
    return {
      kind: "runtime_call",
      func: "cs2_string_match",
      args: [obj, args[0]],
      returnType: I8PTR,
      type: I8PTR,
    };
  }

  if (method === "replace" && args.length >= 2 && args[0].type.kind === "regex") {
    return {
      kind: "runtime_call",
      func: "cs2_string_replace_regex",
      args: [obj, args[0], args[1]],
      returnType: I8PTR,
      type: I8PTR,
    };
  }

  const strMethodMap: Record<string, { func: string; returnType: HIRType; argTypes?: HIRType[] }> =
    {
      charAt: { func: "cs2_str_char_at", returnType: I8PTR, argTypes: [I64] },
      indexOf: { func: "cs2_str_index_of", returnType: I64, argTypes: [I8PTR] },
      includes: { func: "cs2_str_includes", returnType: I1, argTypes: [I8PTR] },
      startsWith: { func: "cs2_str_starts_with", returnType: I1, argTypes: [I8PTR] },
      endsWith: { func: "cs2_str_ends_with", returnType: I1, argTypes: [I8PTR] },
      slice: { func: "cs2_str_slice", returnType: I8PTR, argTypes: [I64, I64] },
      substring: { func: "cs2_str_substring", returnType: I8PTR, argTypes: [I64, I64] },
      substr: { func: "cs2_str_substr", returnType: I8PTR, argTypes: [I64, I64] },
      toUpperCase: { func: "cs2_str_to_upper", returnType: I8PTR },
      toLowerCase: { func: "cs2_str_to_lower", returnType: I8PTR },
      trim: { func: "cs2_str_trim", returnType: I8PTR },
      repeat: { func: "cs2_str_repeat", returnType: I8PTR, argTypes: [I64] },
      replace: { func: "cs2_str_replace", returnType: I8PTR, argTypes: [I8PTR, I8PTR] },
      charCodeAt: { func: "cs2_str_char_code_at", returnType: I64, argTypes: [I64] },
      split: {
        func: "cs2_str_split",
        returnType: { kind: "array", element: I8PTR },
        argTypes: [I8PTR],
      },
      padStart: { func: "cs2_str_pad_start", returnType: I8PTR, argTypes: [I64, I8PTR] },
      padEnd: { func: "cs2_str_pad_end", returnType: I8PTR, argTypes: [I64, I8PTR] },
      trimStart: { func: "cs2_str_trim_start", returnType: I8PTR },
      trimEnd: { func: "cs2_str_trim_end", returnType: I8PTR },
      lastIndexOf: { func: "cs2_str_last_index_of", returnType: F64, argTypes: [I8PTR] },
      at: { func: "cs2_str_at", returnType: I8PTR, argTypes: [I64] },
      replaceAll: { func: "cs2_str_replace_all", returnType: I8PTR, argTypes: [I8PTR, I8PTR] },
    };

  const info = strMethodMap[method];
  if (!info) {
    compileError(`unsupported string method: ${method}`, expr.span);
  }

  if ((method === "padStart" || method === "padEnd") && args.length === 1) {
    args.push({ kind: "literal_string", value: " ", type: I8PTR });
  }

  if ((method === "slice" || method === "substring" || method === "substr") && args.length < 2) {
    if (args.length === 0) {
      args.push({ kind: "literal_i64", value: 0, type: I64 });
    }
    args.push({ kind: "runtime_call", func: "cs2_str_length", args: [obj], returnType: I64, type: I64 });
  }

  const coercedArgs = info.argTypes ? args.map((a, i) => coerce(a, info.argTypes![i])) : [];

  const bridgeRetType = info.returnType;
  const rtCall: HIRExpr = {
    kind: "runtime_call",
    func: info.func,
    args: [obj, ...coercedArgs],
    returnType: bridgeRetType,
    type: bridgeRetType,
  };

  return rtCall;
}

export function lowerMapMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;
  const mt = obj.type as { kind: "map"; key: HIRType; value: HIRType };
  const prefix = mapPrefix(mt.key, mt.value);

  switch (method) {
    case "set": {
      const key = coerce(lowerExpr(expr.arguments[0].expression), mt.key);
      if (mt.value.kind === "ptr") setExpectedDeclType(mt.value);
      else if (mt.value.kind === "array") setExpectedArrayElementType((mt.value as any).element);
      const val = coerce(lowerExpr(expr.arguments[1].expression), mt.value);
      if (mt.value.kind === "ptr") setExpectedDeclType(null);
      else if (mt.value.kind === "array") setExpectedArrayElementType(null);
      return {
        kind: "runtime_call",
        func: `${prefix}_set`,
        args: [obj, key, val],
        returnType: VOID,
        type: VOID,
      };
    }
    case "get": {
      const key = coerce(lowerExpr(expr.arguments[0].expression), mt.key);
      const isBoolInNumMap = mt.value.kind === "i1" && prefix.endsWith("_num_map");
      const callRetType = isBoolInNumMap ? F64 : mt.value;
      const callExpr: HIRExpr = {
        kind: "runtime_call",
        func: `${prefix}_get`,
        args: [obj, key],
        returnType: callRetType,
        type: callRetType,
      };
      if (isBoolInNumMap) {
        return {
          kind: "binary",
          op: "ne",
          left: callExpr,
          right: { kind: "literal_f64", value: 0, type: F64 },
          type: I1,
        };
      }
      return callExpr;
    }
    case "has": {
      const key = coerce(lowerExpr(expr.arguments[0].expression), mt.key);
      return {
        kind: "runtime_call",
        func: `${prefix}_has`,
        args: [obj, key],
        returnType: I1,
        type: I1,
      };
    }
    case "delete": {
      const key = coerce(lowerExpr(expr.arguments[0].expression), mt.key);
      return {
        kind: "runtime_call",
        func: `${prefix}_delete`,
        args: [obj, key],
        returnType: I1,
        type: I1,
      };
    }
    case "keys": {
      const keyArrType: HIRType = { kind: "array", element: mt.key };
      return {
        kind: "runtime_call",
        func: `${prefix}_keys`,
        args: [obj],
        returnType: keyArrType,
        type: keyArrType,
      };
    }
    case "values": {
      const valArrType: HIRType = { kind: "array", element: mt.value };
      return {
        kind: "runtime_call",
        func: `${prefix}_values`,
        args: [obj],
        returnType: valArrType,
        type: valArrType,
      };
    }
    case "clear":
      return {
        kind: "runtime_call",
        func: `${prefix}_clear`,
        args: [obj],
        returnType: VOID,
        type: VOID,
      };
    default:
      throw new Error(`unsupported Map method: ${method}`);
  }
}

export function lowerSetMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;
  const st = obj.type as { kind: "set"; element: HIRType };
  const prefix = setPrefix(st.element);

  switch (method) {
    case "add": {
      if (st.element.kind === "i8ptr") setExpectedDeclType(I8PTR);
      const val = coerce(lowerExpr(expr.arguments[0].expression), st.element);
      if (st.element.kind === "i8ptr") setExpectedDeclType(null);
      return {
        kind: "runtime_call",
        func: `${prefix}_add`,
        args: [obj, val],
        returnType: VOID,
        type: VOID,
      };
    }
    case "has": {
      if (st.element.kind === "i8ptr") setExpectedDeclType(I8PTR);
      const val = coerce(lowerExpr(expr.arguments[0].expression), st.element);
      if (st.element.kind === "i8ptr") setExpectedDeclType(null);
      return {
        kind: "runtime_call",
        func: `${prefix}_has`,
        args: [obj, val],
        returnType: I1,
        type: I1,
      };
    }
    case "delete": {
      if (st.element.kind === "i8ptr") setExpectedDeclType(I8PTR);
      const val = coerce(lowerExpr(expr.arguments[0].expression), st.element);
      if (st.element.kind === "i8ptr") setExpectedDeclType(null);
      return {
        kind: "runtime_call",
        func: `${prefix}_delete`,
        args: [obj, val],
        returnType: I1,
        type: I1,
      };
    }
    case "values": {
      const arrType: HIRType = { kind: "array", element: st.element };
      return {
        kind: "runtime_call",
        func: `${prefix}_values`,
        args: [obj],
        returnType: arrType,
        type: arrType,
      };
    }
    case "clear":
      return {
        kind: "runtime_call",
        func: `${prefix}_clear`,
        args: [obj],
        returnType: VOID,
        type: VOID,
      };
    default:
      throw new Error(`unsupported Set method: ${method}`);
  }
}

export function lowerRegexMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "test": {
      const strArg = lowerExpr(expr.arguments[0].expression);
      return {
        kind: "runtime_call",
        func: "cs2_regex_test",
        args: [obj, strArg],
        returnType: I1,
        type: I1,
      };
    }
    case "exec": {
      const strArg = lowerExpr(expr.arguments[0].expression);
      return {
        kind: "runtime_call",
        func: "cs2_regex_exec_match",
        args: [obj, strArg],
        returnType: I8PTR,
        type: I8PTR,
      };
    }
    default:
      throw new Error(`unsupported RegExp method: ${method}`);
  }
}

export function lowerDynarrayMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;
  const args = expr.arguments.map((a: any) => lowerExpr(a.expression));

  if (method === "length") {
    return {
      kind: "runtime_call",
      func: "cs2_dynarray_length",
      args: [obj],
      returnType: I64,
      type: I64,
    };
  }

  if (method === "push") {
    const val = args[0];
    let func = "cs2_dynarray_push_obj";
    if (val.type.kind === "f64" || val.type.kind === "i64") func = "cs2_dynarray_push_f64";
    else if (val.type.kind === "i8ptr") func = "cs2_dynarray_push_str";
    else if (val.type.kind === "dynarray") func = "cs2_dynarray_push_arr";
    return { kind: "runtime_call", func, args: [obj, val], returnType: VOID, type: VOID };
  }

  const hofMethods: Record<string, string> = {
    filter: "cs2_dynarray_filter",
    map: "cs2_dynarray_map",
    flatMap: "cs2_dynarray_flatMap",
    forEach: "cs2_dynarray_forEach",
    find: "cs2_dynarray_find",
    findIndex: "cs2_dynarray_findIndex",
    every: "cs2_dynarray_every",
    some: "cs2_dynarray_some",
  };

  if (hofMethods[method]) {
    const callback = args[0];
    let returnType: HIRType;
    switch (method) {
      case "filter":
        returnType = DYNARRAY;
        break;
      case "map":
      case "flatMap":
        returnType = DYNARRAY;
        break;
      case "forEach":
        returnType = VOID;
        break;
      case "find":
        returnType = BOXED;
        break;
      case "findIndex":
        returnType = F64;
        break;
      case "every":
      case "some":
        returnType = I1;
        break;
      default:
        throw new Error(`unexpected dynarray hof: ${method}`);
    }
    return {
      kind: "array_hof",
      array: obj,
      method,
      callback,
      bridgeFunc: hofMethods[method],
      returnType,
      type: returnType,
    } as any;
  }

  compileError(`unsupported dynarray method: ${method}`, expr.span);
}

export function lowerArrayMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;
  const arrType = obj.type as { kind: "array"; element: HIRType };
  const prefix = arrayPrefix(arrType.element);
  if (method === "push" && expr.arguments.some((a: any) => a.spread)) {
    const src = lowerExpr(expr.arguments[0].expression);
    return {
      kind: "runtime_call",
      func: `${prefix}_spread`,
      args: [obj, src],
      returnType: VOID,
      type: VOID,
    };
  }
  const args = expr.arguments.map((a) => {
    if (method === "push" && arrType.element.kind === "ptr") {
      const prev = expectedDeclType;
      setExpectedDeclType(arrType.element);
      const r = lowerExpr(a.expression);
      setExpectedDeclType(prev);
      return r;
    }
    if (
      (method === "sort" || method === "map" || method === "filter" ||
       method === "forEach" || method === "find" || method === "findIndex" ||
       method === "every" || method === "some" || method === "reduce") &&
      (a.expression.type === "ArrowFunctionExpression" || a.expression.type === "FunctionExpression")
    ) {
      const elem = arrType.element;
      let paramTypes: HIRType[];
      if (method === "sort") paramTypes = [elem, elem];
      else if (method === "reduce") paramTypes = [elem, elem];
      else paramTypes = [elem, F64];
      setExpectedClosureParamTypes(paramTypes);
      const r = lowerExpr(a.expression);
      setExpectedClosureParamTypes(null);
      return r;
    }
    return lowerExpr(a.expression);
  });

  type MethodInfo = { func: string; returnType: HIRType; argTypes?: HIRType[] };
  let info: MethodInfo | undefined;

  const isObj = arrType.element.kind === "ptr" || arrType.element.kind === "dynobj" || arrType.element.kind === "dynarray" || arrType.element.kind === "map";
  if (method === "sort" && args.length > 0 && prefix === "cs2_num_array") {
    const callback = args[0];
    return {
      kind: "array_hof",
      array: obj,
      method: "sort" as any,
      callback,
      bridgeFunc: "cs2_num_array_sort_fn",
      returnType: VOID,
      type: VOID,
    };
  }

  if (method === "push") {
    info = { func: `${prefix}_push`, returnType: VOID, argTypes: [arrType.element] };
  } else if (method === "pop") {
    info = { func: `${prefix}_pop`, returnType: arrType.element };
  } else if (method === "join" && !isObj) {
    info = { func: `${prefix}_join`, returnType: I8PTR, argTypes: [I8PTR] };
  } else if (prefix === "cs2_num_array") {
    const numMethods: Record<string, MethodInfo> = {
      indexOf: { func: "cs2_num_array_index_of", returnType: I64, argTypes: [F64] },
      lastIndexOf: { func: "cs2_num_array_last_index_of", returnType: I64, argTypes: [F64] },
      copyWithin: { func: "cs2_num_array_copy_within", returnType: VOID, argTypes: [I64, I64] },
      includes: { func: "cs2_num_array_includes", returnType: I64, argTypes: [F64] },
      slice: { func: "cs2_num_array_slice", returnType: obj.type, argTypes: [I64, I64] },
      reverse: { func: "cs2_num_array_reverse", returnType: VOID },
      sort: { func: "cs2_num_array_sort", returnType: VOID },
      concat: { func: "cs2_num_array_concat", returnType: obj.type, argTypes: [obj.type] },
      shift: { func: "cs2_num_array_shift", returnType: F64 },
      unshift: { func: "cs2_num_array_unshift", returnType: VOID, argTypes: [F64] },
      splice: { func: "cs2_num_array_splice", returnType: obj.type, argTypes: [I64, I64] },
      at: { func: "cs2_num_array_at", returnType: F64, argTypes: [I64] },
      fill: { func: "cs2_num_array_fill", returnType: VOID, argTypes: [F64] },
    };
    info = numMethods[method];
  } else if (prefix === "cs2_str_array") {
    const strMethods: Record<string, MethodInfo> = {
      indexOf: { func: "cs2_str_array_index_of", returnType: I64, argTypes: [I8PTR] },
      lastIndexOf: { func: "cs2_str_array_last_index_of", returnType: I64, argTypes: [I8PTR] },
      includes: { func: "cs2_str_array_includes", returnType: I64, argTypes: [I8PTR] },
      slice: { func: "cs2_str_array_slice", returnType: obj.type, argTypes: [I64, I64] },
      reverse: { func: "cs2_str_array_reverse", returnType: VOID },
      concat: { func: "cs2_str_array_concat", returnType: obj.type, argTypes: [obj.type] },
      shift: { func: "cs2_str_array_shift", returnType: I8PTR },
      unshift: { func: "cs2_str_array_unshift", returnType: VOID, argTypes: [I8PTR] },
      at: { func: "cs2_str_array_at", returnType: I8PTR, argTypes: [I64] },
      sort: { func: "cs2_str_array_sort", returnType: VOID },
      fill: { func: "cs2_str_array_fill", returnType: VOID, argTypes: [I8PTR] },
      splice: { func: "cs2_str_array_splice", returnType: obj.type, argTypes: [I64, I64] },
    };
    info = strMethods[method];
  }

  if (prefix === "cs2_obj_array") {
    if (method === "unshift") info = { func: "cs2_obj_array_unshift", returnType: VOID, argTypes: [arrType.element] };
    else if (method === "join") info = { func: "cs2_obj_array_join", returnType: I8PTR, argTypes: [I8PTR] };
    else if (method === "slice") info = { func: "cs2_obj_array_slice", returnType: obj.type, argTypes: [I64, I64] };
  }

  if (
    method === "map" ||
    method === "filter" ||
    method === "forEach" ||
    method === "find" ||
    method === "findIndex" ||
    method === "every" ||
    method === "some" ||
    method === "reduce" ||
    method === "flatMap"
  ) {
    const callback = args[0];
    const hofMethods: Record<string, Record<string, string>> = {
      cs2_num_array: {
        map: "cs2_num_array_map",
        filter: "cs2_num_array_filter",
        forEach: "cs2_num_array_forEach",
        find: "cs2_num_array_find",
        findIndex: "cs2_num_array_findIndex",
        every: "cs2_num_array_every",
        some: "cs2_num_array_some",
        reduce: "cs2_num_array_reduce",
      },
      cs2_str_array: {
        map: "cs2_str_array_map",
        filter: "cs2_str_array_filter",
        forEach: "cs2_str_array_forEach",
        find: "cs2_str_array_find",
        findIndex: "cs2_str_array_findIndex",
        every: "cs2_str_array_every",
        some: "cs2_str_array_some",
        reduce: "cs2_str_array_reduce",
      },
      cs2_obj_array: {
        map: "cs2_obj_array_map",
        filter: "cs2_obj_array_filter",
        forEach: "cs2_obj_array_forEach",
        find: "cs2_obj_array_find",
        findIndex: "cs2_obj_array_findIndex",
        every: "cs2_obj_array_every",
        some: "cs2_obj_array_some",
        flatMap: "cs2_obj_array_flatMap",
      },
    };
    const funcs = hofMethods[prefix];
    if (!funcs || !funcs[method]) compileError(`unsupported array method: ${method}`, expr.span);
    const elemType: HIRType = obj.type.kind === "array"
      ? (obj.type as { kind: "array"; element: HIRType }).element
      : (prefix === "cs2_num_array" ? F64 : prefix === "cs2_str_array" ? I8PTR : BOXED);
    let returnType: HIRType;
    switch (method) {
      case "map":
      case "filter":
        returnType = obj.type;
        break;
      case "forEach":
        returnType = VOID;
        break;
      case "find":
        returnType = elemType;
        break;
      case "findIndex":
        returnType = F64;
        break;
      case "every":
      case "some":
        returnType = { kind: "i1" };
        break;
      case "reduce":
        returnType = elemType;
        break;
      case "flatMap":
        returnType = obj.type;
        break;
      default:
        throw new Error(`unexpected hof method: ${method}`);
    }
    const node: any = {
      kind: "array_hof",
      array: obj,
      method,
      callback,
      bridgeFunc: funcs[method],
      returnType,
      type: returnType,
    };
    if (method === "reduce" && args.length > 1) {
      node.initialValue = args[1];
    }
    return node;
  }

  if (!info) compileError(`unsupported array method: ${method}`, expr.span);

  if (method === "slice" && args.length === 0) {
    args.push({ kind: "literal_i64", value: 0, type: I64 });
    args.push({ kind: "runtime_call", func: `${prefix}_length`, args: [obj], returnType: I64, type: I64 });
  }
  if (method === "slice" && args.length === 1) {
    args.push({ kind: "runtime_call", func: `${prefix}_length`, args: [obj], returnType: I64, type: I64 });
  }

  const coercedArgs = info.argTypes ? args.map((a, i) => coerce(a, info!.argTypes![i])) : [];

  const rtCall: HIRExpr = {
    kind: "runtime_call",
    func: info.func,
    args: [obj, ...coercedArgs],
    returnType: info.returnType,
    type: info.returnType,
  };

  if (method === "includes") {
    return {
      kind: "binary",
      op: "ne" as BinaryOp,
      left: rtCall,
      right: { kind: "literal_i64", value: 0, type: I64 },
      type: I1,
    };
  }

  return rtCall;
}

import type { CallExpression, MemberExpression, Identifier } from "@swc/core";
import type { HIRExpr, HIRType } from "./types.js";
import { F64, I64, I1, I8PTR, VOID, BOXED, DYNOBJ, DYNARRAY } from "./types.js";
import { compileError } from "../errors.js";
import {
  locals, globals, classRegistry, interfaceRegistry, expectedDeclType,
  enumRegistry, builtinImports, narrowedLocals, coerce,
  pendingGenericClasses, sourceFilePath, mapPrefix, arrayPrefix, setPrefix,
  setExpectedDeclType,
} from "./lower-state.js";
import { lowerExpr } from "./lower-expr.js";

function dynobj_get_typed(obj: HIRExpr, key: HIRExpr, targetType: HIRType | null): HIRExpr {
  if (targetType) {
    switch (targetType.kind) {
      case "f64":
      case "i64":
        return { kind: "runtime_call", func: "cs2_dynobj_get_f64", args: [obj, key], returnType: F64, type: F64 };
      case "i8ptr":
        return { kind: "runtime_call", func: "cs2_dynobj_get_str", args: [obj, key], returnType: I8PTR, type: I8PTR };
      case "i1":
        return { kind: "runtime_call", func: "cs2_dynobj_get_bool", args: [obj, key], returnType: I1, type: I1 };
      case "dynarray":
        return { kind: "runtime_call", func: "cs2_dynobj_get_arr", args: [obj, key], returnType: DYNARRAY, type: DYNARRAY };
      case "dynobj":
        return { kind: "runtime_call", func: "cs2_dynobj_get_obj", args: [obj, key], returnType: DYNOBJ, type: DYNOBJ };
      case "boxed":
        return { kind: "runtime_call", func: "cs2_dynobj_get_boxed", args: [obj, key], returnType: BOXED, type: BOXED };
      case "map":
      case "set":
      case "ptr":
        return { kind: "runtime_call", func: "cs2_dynobj_get_obj", args: [obj, key], returnType: targetType, type: targetType };
      case "array":
        return { kind: "runtime_call", func: "cs2_dynobj_get_boxed", args: [obj, key], returnType: BOXED, type: BOXED };
      default:
        break;
    }
  }
  return { kind: "runtime_call", func: "cs2_dynobj_get_boxed", args: [obj, key], returnType: BOXED, type: BOXED };
}

function dynobj_get(obj: HIRExpr, key: HIRExpr): HIRExpr {
  return {
    kind: "runtime_call",
    func: "cs2_dynobj_get_obj",
    args: [obj, key],
    returnType: DYNOBJ,
    type: DYNOBJ,
  };
}

export function drainPendingGenericClasses(): {
  hirClass: import("./types.js").HIRClass;
  fns: import("./types.js").HIRFunction[];
}[] {
  const pending = pendingGenericClasses.slice();
  pendingGenericClasses.length = 0;
  return pending;
}

export function lowerMember(expr: MemberExpression): HIRExpr {
  if (
    expr.object.type === "MemberExpression" &&
    (expr.object as MemberExpression).object.type === "Identifier" &&
    ((expr.object as MemberExpression).object as Identifier).value === "process" &&
    (expr.object as MemberExpression).property.type === "Identifier" &&
    ((expr.object as MemberExpression).property as Identifier).value === "env" &&
    expr.property.type === "Identifier"
  ) {
    const envName = (expr.property as Identifier).value;
    return {
      kind: "runtime_call",
      func: "cs2_process_env_get",
      args: [{ kind: "literal_string", value: envName, type: I8PTR }],
      returnType: I8PTR,
      type: I8PTR,
    };
  }

  if (
    (expr.object as any).type === "MetaProperty" &&
    expr.property.type === "Identifier" &&
    (expr.property as Identifier).value === "url"
  ) {
    const url = sourceFilePath ? `file://${sourceFilePath}` : "file:///unknown";
    return { kind: "literal_string", value: url, type: I8PTR };
  }

  if (
    (expr.object as any).type === "NewExpression" &&
    (expr.object as any).callee?.type === "Identifier" &&
    (expr.object as any).callee.value === "URL" &&
    expr.property.type === "Identifier"
  ) {
    const urlArg = lowerExpr((expr.object as any).arguments[0].expression);
    const prop = (expr.property as Identifier).value;
    if (prop === "pathname" && urlArg.kind === "literal_string") {
      const urlStr = urlArg.value;
      const pathname = urlStr.startsWith("file://") ? urlStr.slice(7) : urlStr;
      return { kind: "literal_string", value: pathname, type: I8PTR };
    }
    return urlArg;
  }

  if (
    expr.object.type === "Identifier" &&
    expr.property.type === "Identifier" &&
    enumRegistry.has(expr.object.value)
  ) {
    const enumName = expr.object.value;
    const memberName = (expr.property as Identifier).value;
    const globalName = `${enumName}_${memberName}`;
    const enumInfo = enumRegistry.get(enumName)!;
    return { kind: "global_get", name: globalName, type: enumInfo.memberType };
  }

  if (
    expr.object.type === "Identifier" &&
    expr.object.value === "process" &&
    expr.property.type === "Identifier"
  ) {
    const prop = (expr.property as Identifier).value;
    switch (prop) {
      case "argv":
        return {
          kind: "runtime_call",
          func: "cs2_process_argv_array",
          args: [],
          returnType: { kind: "array", element: I8PTR },
          type: { kind: "array", element: I8PTR },
        };
      case "platform":
        return {
          kind: "runtime_call",
          func: "cs2_process_platform",
          args: [],
          returnType: I8PTR,
          type: I8PTR,
        };
      case "pid":
        return {
          kind: "runtime_call",
          func: "cs2_process_get_pid",
          args: [],
          returnType: I64,
          type: I64,
        };
      case "exit":
        return { kind: "global_get", name: "process_exit", type: BOXED };
      default:
        break;
    }
  }

  if (
    expr.object.type === "Identifier" &&
    expr.object.value === "os" &&
    expr.property.type === "Identifier" &&
    (expr.property as Identifier).value === "EOL"
  ) {
    return { kind: "literal_string", value: "\n", type: I8PTR };
  }

  if (
    expr.object.type === "Identifier" &&
    expr.object.value === "Math" &&
    expr.property.type === "Identifier"
  ) {
    const prop = (expr.property as Identifier).value;
    switch (prop) {
      case "PI":
        return { kind: "literal_f64", value: Math.PI, type: F64 };
      case "E":
        return { kind: "literal_f64", value: Math.E, type: F64 };
      case "LN2":
        return { kind: "literal_f64", value: Math.LN2, type: F64 };
      case "LN10":
        return { kind: "literal_f64", value: Math.LN10, type: F64 };
      case "LOG2E":
        return { kind: "literal_f64", value: Math.LOG2E, type: F64 };
      case "LOG10E":
        return { kind: "literal_f64", value: Math.LOG10E, type: F64 };
      case "SQRT2":
        return { kind: "literal_f64", value: Math.SQRT2, type: F64 };
      case "SQRT1_2":
        return { kind: "literal_f64", value: Math.SQRT1_2, type: F64 };
      default:
        throw new Error(`unsupported Math constant: ${prop}`);
    }
  }

  if (
    expr.object.type === "Identifier" &&
    expr.object.value === "Number" &&
    expr.property.type === "Identifier"
  ) {
    const prop = (expr.property as Identifier).value;
    switch (prop) {
      case "MAX_SAFE_INTEGER":
        return { kind: "literal_f64", value: Number.MAX_SAFE_INTEGER, type: F64 };
      case "MIN_SAFE_INTEGER":
        return { kind: "literal_f64", value: Number.MIN_SAFE_INTEGER, type: F64 };
      case "POSITIVE_INFINITY":
        return { kind: "literal_f64", value: Infinity, type: F64 };
      case "NEGATIVE_INFINITY":
        return { kind: "literal_f64", value: -Infinity, type: F64 };
      case "NaN":
        return { kind: "literal_f64", value: NaN, type: F64 };
      case "EPSILON":
        return { kind: "literal_f64", value: Number.EPSILON, type: F64 };
      default:
        throw new Error(`unsupported Number constant: ${prop}`);
    }
  }

  if (
    expr.object.type === "Identifier" &&
    expr.object.value === "path" &&
    expr.property.type === "Identifier"
  ) {
    const prop = (expr.property as Identifier).value;
    if (prop === "sep") {
      return { kind: "literal_string", value: "/", type: I8PTR };
    }
  }

  if ((expr.property as any).type === "Computed") {
    const obj = lowerExpr(expr.object);
    const index = lowerExpr((expr.property as any).expression);
    if (obj.type.kind === "array") {
      const elemType = (obj.type as { kind: "array"; element: HIRType }).element;
      const idxCoerced = index.type.kind !== "i64" ? coerce(index, I64) : index;
      return { kind: "index_get", array: obj, index: idxCoerced, type: elemType };
    }
    if (
      obj.type.kind === "ptr" &&
      (obj.type as { kind: "ptr"; pointee: string }).pointee === "Buffer"
    ) {
      return {
        kind: "runtime_call",
        func: "cs2_buffer_at",
        args: [obj, coerce(index, F64)],
        returnType: F64,
        type: F64,
      };
    }
    if (obj.type.kind === "map") {
      const mt = obj.type as { kind: "map"; key: HIRType; value: HIRType };
      const prefix = mapPrefix(mt.key, mt.value);
      return {
        kind: "runtime_call",
        func: `${prefix}_get`,
        args: [obj, coerce(index, mt.key)],
        returnType: mt.value,
        type: mt.value,
      };
    }
    if (obj.type.kind === "ptr") {
      const pointee = (obj.type as { kind: "ptr"; pointee: string }).pointee;
      if (pointee === "Uint8Array" || pointee === "Float64Array") {
        const fn = pointee === "Uint8Array" ? "cs2_uint8array_get" : "cs2_float64array_get";
        return {
          kind: "runtime_call",
          func: fn,
          args: [obj, coerce(index, F64)],
          returnType: F64,
          type: F64,
        };
      }
    }
    if (obj.type.kind === "i8ptr") {
      return {
        kind: "runtime_call",
        func: "cs2_str_char_at",
        args: [obj, coerce(index, I64)],
        returnType: I8PTR,
        type: I8PTR,
      };
    }
    if (obj.type.kind === "dynarray") {
      return {
        kind: "runtime_call",
        func: "cs2_dynarray_get_obj",
        args: [obj, coerce(index, I64)],
        returnType: DYNOBJ,
        type: DYNOBJ,
      };
    }
    if (obj.type.kind === "boxed" && (index.type.kind === "i64" || index.type.kind === "f64")) {
      const arr = coerce(obj, DYNARRAY);
      return {
        kind: "runtime_call",
        func: "cs2_dynarray_get_obj",
        args: [arr, coerce(index, I64)],
        returnType: DYNOBJ,
        type: DYNOBJ,
      };
    }
    if (obj.type.kind === "dynobj" || obj.type.kind === "boxed") {
      const dynObj = obj.type.kind === "boxed" ? coerce(obj, DYNOBJ) : obj;
      return dynobj_get(dynObj, index);
    }
    compileError("unsupported computed member access", expr.span);
  }

  if (expr.property.type === "Identifier") {
    const propName = expr.property.value;

    if (propName === "length") {
      const obj = lowerExpr(expr.object);
      if (obj.type.kind === "i8ptr") {
        return {
          kind: "runtime_call",
          func: "cs2_str_length",
          args: [obj],
          returnType: I64,
          type: I64,
        };
      }
      if (obj.type.kind === "array") {
        const elemType = (obj.type as { kind: "array"; element: HIRType }).element;
        const lenFn = `${arrayPrefix(elemType)}_length`;
        return { kind: "runtime_call", func: lenFn, args: [obj], returnType: I64, type: I64 };
      }
      if (obj.type.kind === "dynarray") {
        return { kind: "runtime_call", func: "cs2_dynarray_length", args: [obj], returnType: I64, type: I64 };
      }
      if (obj.type.kind === "boxed" || obj.type.kind === "dynobj") {
        const arr = coerce(obj, DYNARRAY);
        return { kind: "runtime_call", func: "cs2_dynarray_length", args: [arr], returnType: I64, type: I64 };
      }
      if (
        obj.type.kind === "ptr" &&
        (obj.type as { kind: "ptr"; pointee: string }).pointee === "Buffer"
      ) {
        return {
          kind: "runtime_call",
          func: "cs2_buffer_length",
          args: [obj],
          returnType: F64,
          type: F64,
        };
      }
      if (obj.type.kind === "ptr") {
        const pointee = (obj.type as { kind: "ptr"; pointee: string }).pointee;
        if (pointee === "Uint8Array" || pointee === "Float64Array") {
          const fn = pointee === "Uint8Array" ? "cs2_uint8array_length" : "cs2_float64array_length";
          return {
            kind: "runtime_call",
            func: fn,
            args: [obj],
            returnType: F64,
            type: F64,
          };
        }
      }
    }

    if (propName === "size") {
      const obj = lowerExpr(expr.object);
      if (obj.type.kind === "map") {
        const mt = obj.type as { kind: "map"; key: HIRType; value: HIRType };
        const prefix = mapPrefix(mt.key, mt.value);
        return {
          kind: "runtime_call",
          func: `${prefix}_size`,
          args: [obj],
          returnType: I64,
          type: I64,
        };
      }
      if (obj.type.kind === "set") {
        const st = obj.type as { kind: "set"; element: HIRType };
        const prefix = setPrefix(st.element);
        return {
          kind: "runtime_call",
          func: `${prefix}_size`,
          args: [obj],
          returnType: I64,
          type: I64,
        };
      }
    }

    const obj = lowerExpr(expr.object);
    if (obj.type.kind === "ptr") {
      const typeName = (obj.type as { kind: "ptr"; pointee: string }).pointee;
      if (typeName === "HttpRequest") {
        switch (propName) {
          case "method":
            return {
              kind: "runtime_call",
              func: "cs2_http_req_method",
              args: [obj],
              returnType: I8PTR,
              type: I8PTR,
            };
          case "url":
            return {
              kind: "runtime_call",
              func: "cs2_http_req_url",
              args: [obj],
              returnType: I8PTR,
              type: I8PTR,
            };
          default:
            throw new Error(`unsupported HttpRequest property: ${propName}`);
        }
      }
      let searchClass = typeName;
      while (searchClass) {
        const classInfo = classRegistry.get(searchClass);
        if (!classInfo) break;
        const fieldIdx = classInfo.fields.findIndex((f) => f.name === propName);
        if (fieldIdx >= 0) {
          const field = classInfo.fields[fieldIdx];
          return {
            kind: "field_get",
            object: obj,
            fieldName: propName,
            index: fieldIdx,
            type: field.type,
          };
        }
        searchClass = classInfo.parent!;
      }
      const ifaceInfo = interfaceRegistry.get(typeName);
      if (ifaceInfo) {
        const fieldIdx = ifaceInfo.fields.findIndex((f) => f.name === propName);
        if (fieldIdx >= 0) {
          const field = ifaceInfo.fields[fieldIdx];
          return {
            kind: "field_get",
            object: obj,
            fieldName: propName,
            index: fieldIdx,
            type: field.type,
          };
        }
      }
    }
  }

  {
    const savedDeclType = expectedDeclType;
    setExpectedDeclType(null);
    const objExpr = lowerExpr(expr.object);
    setExpectedDeclType(savedDeclType);
    if (
      (objExpr.type.kind === "dynobj" || objExpr.type.kind === "boxed") &&
      expr.property.type === "Identifier"
    ) {
      const dynObj = objExpr.type.kind === "boxed" ? coerce(objExpr, DYNOBJ) : objExpr;
      const key: HIRExpr = { kind: "literal_string", value: (expr.property as any).value, type: I8PTR };
      let targetType = savedDeclType;
      if (!targetType && (objExpr.type as any).props) {
        const propInfo = (objExpr.type as any).props.find(
          (p: { name: string; type: HIRType }) => p.name === (expr.property as any).value,
        );
        if (propInfo) targetType = propInfo.type;
      }
      return dynobj_get_typed(dynObj, key, targetType);
    }
  }

  const obj = expr.object.type === "Identifier" ? expr.object.value : expr.object.type;
  const prop = expr.property.type === "Identifier" ? expr.property.value : expr.property.type;
  compileError(`unsupported member access: ${obj}.${prop}`, expr.span);
}

export function lowerPromiseStaticCall(expr: CallExpression): HIRExpr {
  const method = ((expr.callee as MemberExpression).property as Identifier).value;
  if (expr.arguments.length < 1) {
    compileError(`Promise.${method} requires an argument`, expr.span);
  }
  const argExpr = expr.arguments[0].expression;
  if (argExpr.type !== "ArrayExpression") {
    compileError(`Promise.${method} requires an array literal argument`, expr.span);
  }
  const elements = (argExpr as any).elements || [];
  const promises: HIRExpr[] = elements
    .filter((e: any) => e !== null)
    .map((e: any) => lowerExpr(e.expression));

  if (promises.length === 0) {
    compileError(`Promise.${method} requires at least one promise`, expr.span);
  }

  const firstType = promises[0].type;
  if (firstType.kind !== "promise") {
    compileError(`Promise.${method} elements must be promises`, expr.span);
  }
  const innerType = (firstType as { kind: "promise"; inner: HIRType }).inner;

  switch (method) {
    case "all":
      return {
        kind: "promise_static",
        method: "all",
        promises,
        innerType,
        type: { kind: "promise", inner: { kind: "array", element: innerType } },
      };
    case "race":
      return {
        kind: "promise_static",
        method: "race",
        promises,
        innerType,
        type: { kind: "promise", inner: innerType },
      };
    case "allSettled": {
      if (!classRegistry.has("__PromiseSettledResult")) {
        const fields =
          innerType.kind === "i8ptr"
            ? [
                { name: "status", type: I8PTR },
                { name: "value", type: I8PTR },
              ]
            : [
                { name: "status", type: I8PTR },
                { name: "value", type: F64 },
              ];
        classRegistry.set("__PromiseSettledResult", {
          fields,
          methods: new Map(),
        });
      }
      const resultStructType: HIRType = { kind: "ptr", pointee: "__PromiseSettledResult" };
      return {
        kind: "promise_static",
        method: "allSettled",
        promises,
        innerType,
        type: { kind: "promise", inner: { kind: "array", element: resultStructType } },
      };
    }
    default:
      compileError(`unsupported Promise method: ${method}`, expr.span);
  }
}

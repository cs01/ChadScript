import type {
  CallExpression,
  MemberExpression,
  Identifier,
} from "@swc/core";

import type { HIRExpr, HIRType, HIRParam, BinaryOp } from "./types.js";
import { F64, I64, I1, I8PTR, VOID, BOXED, DYNOBJ, DYNARRAY, REGEX } from "./types.js";
import { compileError } from "../errors.js";
import {
  locals, globals, classRegistry, functionRegistry, restParamRegistry, fnAliases,
  currentClassName, expectedDeclType, setExpectedDeclType, freshId, resolveTypeAnnotation,
  coerce, defaultValue, arrayPrefix, mapPrefix, setPrefix, builtinImports,
  genericFunctionTemplates, genericClassTemplates, genericSpecializations, mangleGenericName,
  pendingFunctions,
} from "./lower-state.js";
import { specializeFunction } from "./lower-generic.js";
import { lowerExpr, lowerClassMethodCall, lowerGenericFunctionCall, lowerGenericNewExpr } from "./lower-expr.js";
import { lowerPromiseStaticCall } from "./lower-member.js";
import {
  lowerProcessCall,
  lowerPathCall,
  lowerFsCall,
  matchCryptoChain,
  lowerBufferStaticCall,
  lowerDateMethodCall,
  lowerBufferMethodCall,
  lowerChildProcessCall,
  ensureHttpTypesRegistered,
  lowerHttpCall,
  lowerHttpServerMethodCall,
  lowerHttpResponseMethodCall,
  lowerMathCall,
  lowerJSONCall,
} from "./lower-stdlib.js";
import {
  lowerStringMethodCall,
  lowerMapMethodCall,
  lowerSetMethodCall,
  lowerRegexMethodCall,
  lowerDynarrayMethodCall,
  lowerArrayMethodCall,
} from "./lower-method-call.js";

export function lowerCall(expr: CallExpression): HIRExpr {
  if ((expr.callee as any).type === "Super") {
    if (!currentClassName) compileError("super() called outside constructor", expr.span);
    const classInfo = classRegistry.get(currentClassName);
    const parentName = classInfo?.parent;
    if (!parentName) compileError("super() called in class without parent", expr.span);

    const thisLocal = locals.get("this")!;
    const initFnName = `${parentName}_init`;
    const initInfo = functionRegistry.get(initFnName);
    const args: HIRExpr[] = [{ kind: "local_get", id: thisLocal.id, type: thisLocal.type }];
    for (let i = 0; i < expr.arguments.length; i++) {
      let arg = lowerExpr(expr.arguments[i].expression);
      if (initInfo && initInfo.params[i + 1]) {
        arg = coerce(arg, initInfo.params[i + 1].type);
      }
      args.push(arg);
    }
    if (initInfo) {
      for (let i = args.length; i < initInfo.params.length; i++) {
        const p = initInfo.params[i];
        args.push(p.defaultValue ? coerce(p.defaultValue, p.type) : defaultValue(p.type));
      }
    }
    return { kind: "call", callee: initFnName, args, returnType: VOID, type: VOID };
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "console" &&
    expr.callee.property.type === "Identifier"
  ) {
    const method = (expr.callee.property as Identifier).value;
    if (method === "log" || method === "error" || method === "warn") {
      const args = expr.arguments.map((a) => lowerExpr(a.expression));
      const funcMap: Record<string, string> = {
        log: "cs_console_log",
        error: "cs_console_error",
        warn: "cs_console_warn",
      };
      return {
        kind: "runtime_call",
        func: funcMap[method],
        args,
        returnType: VOID,
        type: VOID,
      };
    }
    if (method === "time") {
      const label =
        expr.arguments.length > 0
          ? lowerExpr(expr.arguments[0].expression)
          : ({ kind: "literal_string" as const, value: "default", type: I8PTR } as HIRExpr);
      return {
        kind: "runtime_call",
        func: "cs2_console_time",
        args: [label],
        returnType: VOID,
        type: VOID,
      };
    }
    if (method === "timeEnd") {
      const label =
        expr.arguments.length > 0
          ? lowerExpr(expr.arguments[0].expression)
          : ({ kind: "literal_string" as const, value: "default", type: I8PTR } as HIRExpr);
      return {
        kind: "runtime_call",
        func: "cs2_console_time_end",
        args: [label],
        returnType: VOID,
        type: VOID,
      };
    }
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "process" &&
    expr.callee.property.type === "Identifier"
  ) {
    return lowerProcessCall(expr);
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "path" &&
    expr.callee.property.type === "Identifier"
  ) {
    return lowerPathCall(expr);
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "Buffer" &&
    expr.callee.property.type === "Identifier"
  ) {
    return lowerBufferStaticCall(expr);
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    (expr.callee.object.value === "Uint8Array" || expr.callee.object.value === "Float64Array") &&
    expr.callee.property.type === "Identifier" &&
    expr.callee.property.value === "from"
  ) {
    const typeName = expr.callee.object.value;
    const arrArg = lowerExpr(expr.arguments[0].expression);
    const resultType: HIRType = { kind: "ptr", pointee: typeName };
    const fn =
      typeName === "Uint8Array"
        ? "cs2_uint8array_from_num_array"
        : "cs2_float64array_from_num_array";
    return {
      kind: "runtime_call",
      func: fn,
      args: [arrArg],
      returnType: resultType,
      type: resultType,
    };
  }

  {
    const cryptoChain = matchCryptoChain(expr);
    if (cryptoChain) return cryptoChain;
  }

  if (
    expr.callee.type === "MemberExpression" &&
    (expr.callee as MemberExpression).object.type === "CallExpression" &&
    ((expr.callee as MemberExpression).object as CallExpression).callee.type ===
      "MemberExpression" &&
    (((expr.callee as MemberExpression).object as CallExpression).callee as MemberExpression).object
      .type === "Identifier" &&
    (
      (((expr.callee as MemberExpression).object as CallExpression).callee as MemberExpression)
        .object as Identifier
    ).value === "fs" &&
    (((expr.callee as MemberExpression).object as CallExpression).callee as MemberExpression)
      .property.type === "Identifier" &&
    (
      (((expr.callee as MemberExpression).object as CallExpression).callee as MemberExpression)
        .property as Identifier
    ).value === "statSync" &&
    (expr.callee as MemberExpression).property.type === "Identifier"
  ) {
    const innerCall = (expr.callee as MemberExpression).object as CallExpression;
    const pathArg = lowerExpr(innerCall.arguments[0].expression);
    const statMethod = ((expr.callee as MemberExpression).property as Identifier).value;
    switch (statMethod) {
      case "isFile":
        return {
          kind: "runtime_call",
          func: "cs2_fs_stat_is_file",
          args: [pathArg],
          returnType: I1,
          type: I1,
        };
      case "isDirectory":
        return {
          kind: "runtime_call",
          func: "cs2_fs_stat_is_directory",
          args: [pathArg],
          returnType: I1,
          type: I1,
        };
      default:
        throw new Error(`unsupported statSync method: ${statMethod}`);
    }
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "fs" &&
    expr.callee.property.type === "Identifier"
  ) {
    return lowerFsCall(expr);
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "child_process" &&
    expr.callee.property.type === "Identifier"
  ) {
    return lowerChildProcessCall(expr);
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "http" &&
    expr.callee.property.type === "Identifier"
  ) {
    return lowerHttpCall(expr);
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "os" &&
    expr.callee.property.type === "Identifier"
  ) {
    const method = (expr.callee.property as Identifier).value;
    const osMethods: Record<string, { func: string; returnType: HIRType }> = {
      hostname: { func: "cs2_os_hostname", returnType: I8PTR },
      homedir: { func: "cs2_os_homedir", returnType: I8PTR },
      tmpdir: { func: "cs2_os_tmpdir", returnType: I8PTR },
      platform: { func: "cs2_os_platform", returnType: I8PTR },
      arch: { func: "cs2_os_arch", returnType: I8PTR },
      type: { func: "cs2_os_type", returnType: I8PTR },
      uptime: { func: "cs2_os_uptime", returnType: F64 },
    };
    const info = osMethods[method];
    if (info) {
      return {
        kind: "runtime_call",
        func: info.func,
        args: [],
        returnType: info.returnType,
        type: info.returnType,
      };
    }
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "Math"
  ) {
    return lowerMathCall(expr);
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "JSON" &&
    expr.callee.property.type === "Identifier"
  ) {
    return lowerJSONCall(expr);
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "Promise" &&
    expr.callee.property.type === "Identifier"
  ) {
    return lowerPromiseStaticCall(expr);
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "String" &&
    expr.callee.property.type === "Identifier" &&
    expr.callee.property.value === "fromCharCode"
  ) {
    const args = expr.arguments.map((a) => coerce(lowerExpr(a.expression), I64));
    return {
      kind: "runtime_call",
      func: "cs2_str_from_char_code",
      args,
      returnType: I8PTR,
      type: I8PTR,
    };
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "Date" &&
    expr.callee.property.type === "Identifier" &&
    expr.callee.property.value === "now"
  ) {
    return { kind: "runtime_call", func: "cs2_date_now", args: [], returnType: F64, type: F64 };
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "Number" &&
    expr.callee.property.type === "Identifier"
  ) {
    const method = (expr.callee.property as Identifier).value;
    if (method === "parseInt" || method === "parseFloat") {
      const strArg = coerce(lowerExpr(expr.arguments[0].expression), I8PTR);
      return {
        kind: "runtime_call",
        func: method === "parseInt" ? "cs2_parse_int" : "cs2_parse_float",
        args: [strArg],
        returnType: F64,
        type: F64,
      };
    }
    const arg = coerce(lowerExpr(expr.arguments[0].expression), F64);
    switch (method) {
      case "isInteger":
        return {
          kind: "runtime_call",
          func: "cs2_number_is_integer",
          args: [arg],
          returnType: I1,
          type: I1,
        };
      case "isNaN":
        return {
          kind: "runtime_call",
          func: "cs2_number_is_nan",
          args: [arg],
          returnType: I1,
          type: I1,
        };
      case "isFinite":
        return {
          kind: "runtime_call",
          func: "cs2_number_is_finite",
          args: [arg],
          returnType: I1,
          type: I1,
        };
      default:
        break;
    }
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.property.type === "Identifier" &&
    classRegistry.has(expr.callee.object.value)
  ) {
    const className = expr.callee.object.value;
    const methodName = expr.callee.property.value;
    const funcName = `${className}_${methodName}`;
    const info = functionRegistry.get(funcName);
    if (info && !info.params.some((p: any) => p.name === "this")) {
      const args: HIRExpr[] = expr.arguments.map((a: any, i: number) =>
        coerce(lowerExpr(a.expression), info.params[i].type),
      );
      for (let i = args.length; i < info.params.length; i++) {
        const p = info.params[i];
        args.push(p.defaultValue ? coerce(p.defaultValue, p.type) : defaultValue(p.type));
      }
      return {
        kind: "call",
        callee: funcName,
        args,
        returnType: info.returnType,
        type: info.returnType,
      };
    }
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "Array" &&
    expr.callee.property.type === "Identifier" &&
    expr.callee.property.value === "isArray"
  ) {
    const arg = lowerExpr(expr.arguments[0].expression);
    if (arg.type.kind === "array" || arg.type.kind === "dynarray") {
      return { kind: "literal_i1", value: true, type: I1 };
    }
    if (arg.type.kind === "dynobj" || arg.type.kind === "ptr") {
      return { kind: "literal_i1", value: false, type: I1 };
    }
    return {
      kind: "runtime_call",
      func: "cs2_is_array",
      args: [coerce(arg, BOXED)],
      returnType: I1,
      type: I1,
    };
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "Number" &&
    expr.callee.property.type === "Identifier"
  ) {
    const method = expr.callee.property.value;
    if (method === "isInteger") {
      const arg = lowerExpr(expr.arguments[0].expression);
      if (arg.type.kind === "i64") return { kind: "literal_i1", value: true, type: I1 };
      const rem: HIRExpr = {
        kind: "binary",
        op: "rem" as BinaryOp,
        left: coerce(arg, F64),
        right: { kind: "literal_f64", value: 1.0, type: F64 },
        type: F64,
      };
      return {
        kind: "binary",
        op: "eq" as BinaryOp,
        left: rem,
        right: { kind: "literal_f64", value: 0.0, type: F64 },
        type: I1,
      };
    }
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "Object" &&
    expr.callee.property.type === "Identifier" &&
    expr.callee.property.value === "hasOwn"
  ) {
    const obj = lowerExpr(expr.arguments[0].expression);
    const key = lowerExpr(expr.arguments[1].expression);
    if (obj.type.kind === "dynobj") {
      return {
        kind: "binary",
        op: "ne" as BinaryOp,
        left: {
          kind: "runtime_call",
          func: "cs2_dynobj_tag",
          args: [obj, coerce(key, I8PTR)],
          returnType: I64,
          type: I64,
        },
        right: { kind: "literal_i64", value: -1, type: I64 },
        type: I1,
      };
    }
    return { kind: "literal_i1", value: true, type: I1 };
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "Object" &&
    expr.callee.property.type === "Identifier" &&
    (expr.callee.property.value === "keys" ||
      expr.callee.property.value === "values" ||
      expr.callee.property.value === "entries")
  ) {
    const method = expr.callee.property.value;
    const obj = lowerExpr(expr.arguments[0].expression);
    const objCoerced = coerce(obj, DYNOBJ);
    if (method === "keys") {
      const stringArrayType: HIRType = { kind: "array", element: I8PTR };
      return {
        kind: "runtime_call",
        func: "cs2_dynobj_keys",
        args: [objCoerced],
        returnType: stringArrayType,
        type: stringArrayType,
      };
    }
    return {
      kind: "runtime_call",
      func: method === "values" ? "cs2_dynobj_values" : "cs2_dynobj_entries",
      args: [objCoerced],
      returnType: DYNARRAY,
      type: DYNARRAY,
    };
  }

  if (
    expr.callee.type === "MemberExpression" &&
    expr.callee.object.type === "Identifier" &&
    expr.callee.object.value === "Array" &&
    expr.callee.property.type === "Identifier" &&
    expr.callee.property.value === "from"
  ) {
    const arg = lowerExpr(expr.arguments[0].expression);
    if (arg.type.kind === "set") {
      const st = arg.type as { kind: "set"; element: HIRType };
      const prefix = setPrefix(st.element);
      const arrayType: HIRType = { kind: "array", element: st.element };
      return {
        kind: "runtime_call",
        func: `${prefix}_values`,
        args: [arg],
        returnType: arrayType,
        type: arrayType,
      };
    }
    if (arg.type.kind === "array" || arg.type.kind === "dynarray") return arg;
    return arg;
  }

  if (expr.callee.type === "MemberExpression") {
    const obj = lowerExpr(expr.callee.object);
    if (obj.type.kind === "i8ptr") {
      return lowerStringMethodCall(expr, obj);
    }
    if (obj.type.kind === "array") {
      return lowerArrayMethodCall(expr, obj);
    }
    if (obj.type.kind === "map") {
      return lowerMapMethodCall(expr, obj);
    }
    if (obj.type.kind === "set") {
      return lowerSetMethodCall(expr, obj);
    }
    if (obj.type.kind === "regex") {
      return lowerRegexMethodCall(expr, obj);
    }
    if (obj.type.kind === "dynarray") {
      return lowerDynarrayMethodCall(expr, obj);
    }
    if (obj.type.kind === "dynobj" || obj.type.kind === "boxed") {
      const methodName = (expr.callee as MemberExpression).property;
      if (methodName.type === "Identifier") {
        const mn = (methodName as Identifier).value;
        const isArrayMethod = mn === "filter" || mn === "map" || mn === "flatMap" || mn === "forEach" || mn === "find" || mn === "findIndex" || mn === "every" || mn === "some" || mn === "push" || mn === "length";
        if (isArrayMethod) {
          const asArr: HIRExpr = obj.type.kind === "boxed" ? coerce(obj, DYNARRAY) : { ...obj, type: DYNARRAY };
          return lowerDynarrayMethodCall(expr, asArr);
        }
        const isStringMethod = mn === "charAt" || mn === "indexOf" || mn === "includes" || mn === "startsWith" || mn === "endsWith" || mn === "slice" || mn === "substring" || mn === "toUpperCase" || mn === "toLowerCase" || mn === "trim" || mn === "repeat" || mn === "replace" || mn === "charCodeAt" || mn === "split" || mn === "padStart" || mn === "padEnd" || mn === "trimStart" || mn === "trimEnd" || mn === "lastIndexOf" || mn === "at" || mn === "replaceAll";
        if (isStringMethod) {
          const asStr: HIRExpr = coerce(obj, I8PTR);
          return lowerStringMethodCall(expr, asStr);
        }
      }
    }
    if (obj.type.kind === "f64" || obj.type.kind === "i64") {
      const numObj: HIRExpr = obj.type.kind === "i64" ? coerce(obj, F64) : obj;
      const method = ((expr.callee as MemberExpression).property as Identifier).value;
      if (method === "toString") {
        return { kind: "runtime_call", func: "cs2_number_to_string", args: [numObj], returnType: I8PTR, type: I8PTR };
      }
      if (method === "toFixed") {
        const digits = expr.arguments.length > 0 ? coerce(lowerExpr(expr.arguments[0].expression), F64) : { kind: "literal_f64" as const, value: 0, type: F64 };
        return { kind: "runtime_call", func: "cs2_number_to_fixed", args: [numObj, digits], returnType: I8PTR, type: I8PTR };
      }
      compileError(`unsupported number method: ${method}`, expr.span);
    }
    if (obj.type.kind === "boxed") {
      const method = ((expr.callee as MemberExpression).property as Identifier).value;
      if (method === "toString") {
        return { kind: "runtime_call", func: "cs2_boxed_to_string", args: [obj], returnType: I8PTR, type: I8PTR };
      }
      compileError(`unsupported boxed method: ${method}`, expr.span);
    }
    if (obj.type.kind === "ptr") {
      const pointee = (obj.type as { kind: "ptr"; pointee: string }).pointee;
      if (pointee === "Buffer") {
        return lowerBufferMethodCall(expr, obj);
      }
      if (pointee === "HttpServer") {
        return lowerHttpServerMethodCall(expr, obj);
      }
      if (pointee === "HttpResponse") {
        return lowerHttpResponseMethodCall(expr, obj);
      }
      if (pointee === "Date") {
        return lowerDateMethodCall(expr, obj);
      }
      return lowerClassMethodCall(expr, obj);
    }
  }

  if (expr.callee.type === "Identifier") {
    const calleeName_ = expr.callee.value;
    if (calleeName_ === "setTimeout" || calleeName_ === "setInterval") {
      const callbackExpr = lowerExpr(expr.arguments[0].expression);
      let delayExpr = lowerExpr(expr.arguments[1].expression);
      if (delayExpr.type.kind !== "f64") delayExpr = coerce(delayExpr, F64);
      const func = calleeName_ === "setTimeout" ? "cs2_set_timeout" : "cs2_set_interval";
      return {
        kind: "runtime_call",
        func,
        args: [callbackExpr, delayExpr],
        returnType: I8PTR,
        type: I8PTR,
      };
    }
    if (calleeName_ === "clearTimeout" || calleeName_ === "clearInterval") {
      const handleExpr = lowerExpr(expr.arguments[0].expression);
      return {
        kind: "runtime_call",
        func: "cs2_clear_timer",
        args: [handleExpr],
        returnType: VOID,
        type: VOID,
      };
    }
    if (calleeName_ === "Number") {
      const arg = lowerExpr(expr.arguments[0].expression);
      if (arg.type.kind === "i8ptr") {
        return {
          kind: "runtime_call",
          func: "cs2_parse_float",
          args: [arg],
          returnType: F64,
          type: F64,
        };
      }
      return coerce(arg, F64);
    }
    if (calleeName_ === "String") {
      const arg = lowerExpr(expr.arguments[0].expression);
      if (arg.type.kind === "f64" || arg.type.kind === "i64") {
        return {
          kind: "runtime_call",
          func: "cs2_number_to_string",
          args: [coerce(arg, F64)],
          returnType: I8PTR,
          type: I8PTR,
        };
      }
      return arg;
    }
    if (calleeName_ === "isNaN") {
      return {
        kind: "runtime_call",
        func: "cs2_number_is_nan",
        args: [coerce(lowerExpr(expr.arguments[0].expression), F64)],
        returnType: I1,
        type: I1,
      };
    }
    if (calleeName_ === "isFinite") {
      return {
        kind: "runtime_call",
        func: "cs2_number_is_finite",
        args: [coerce(lowerExpr(expr.arguments[0].expression), F64)],
        returnType: I1,
        type: I1,
      };
    }
    if (calleeName_ === "parseFloat") {
      return {
        kind: "runtime_call",
        func: "cs2_parse_float",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: F64,
        type: F64,
      };
    }
    if (calleeName_ === "parseInt") {
      return {
        kind: "runtime_call",
        func: "cs2_parse_int",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: F64,
        type: F64,
      };
    }
    if (calleeName_ === "fetch") {
      return {
        kind: "runtime_call",
        func: "cs2_fetch_sync",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: I8PTR,
        type: I8PTR,
      };
    }
    if (calleeName_ === "execSync") {
      return {
        kind: "runtime_call",
        func: "cs2_exec_sync",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: I8PTR,
        type: I8PTR,
      };
    }

    if (
      genericFunctionTemplates.has(expr.callee.value) &&
      (expr as any).typeArguments?.params?.length
    ) {
      return lowerGenericFunctionCall(expr);
    }

    const local = locals.get(expr.callee.value);
    if (local && local.type.kind === "closure") {
      const closureType = local.type as { kind: "closure"; params: HIRType[]; returnType: HIRType };
      const args = expr.arguments.map((a, i) => {
        let arg = lowerExpr(a.expression);
        if (closureType.params[i]) arg = coerce(arg, closureType.params[i]);
        return arg;
      });
      return {
        kind: "call_closure",
        callee: { kind: "local_get", id: local.id, type: local.type },
        args,
        returnType: closureType.returnType,
        type: closureType.returnType,
      };
    }

    const globalInfo = globals.get(expr.callee.value);
    if (globalInfo && globalInfo.type.kind === "closure") {
      const closureType = globalInfo.type as {
        kind: "closure";
        params: HIRType[];
        returnType: HIRType;
      };
      const args = expr.arguments.map((a, i) => {
        let arg = lowerExpr(a.expression);
        if (closureType.params[i]) arg = coerce(arg, closureType.params[i]);
        return arg;
      });
      return {
        kind: "call_closure",
        callee: { kind: "global_get", name: expr.callee.value, type: globalInfo.type },
        args,
        returnType: closureType.returnType,
        type: closureType.returnType,
      };
    }

    const bi = builtinImports.get(expr.callee.value);
    if (bi) {
      const syntheticCallee = {
        type: "MemberExpression" as const,
        span: expr.span,
        object: { type: "Identifier" as const, span: expr.span, value: bi.module, optional: false },
        property: {
          type: "Identifier" as const,
          span: expr.span,
          value: bi.imported,
          optional: false,
        },
      };
      return lowerCall({ ...expr, callee: syntheticCallee as any });
    }

    const calleeName = fnAliases.get(expr.callee.value) || expr.callee.value;
    let fnInfo = functionRegistry.get(calleeName);
    let resolvedCallee = calleeName;
    if (!fnInfo && genericFunctionTemplates.has(calleeName)) {
      const template = genericFunctionTemplates.get(calleeName)!;
      const anyArgs = template.typeParams.map(() => BOXED);
      const mangledAny = mangleGenericName(calleeName, anyArgs);
      if (!genericSpecializations.has(mangledAny)) {
        const specialized = specializeFunction(calleeName, anyArgs);
        if (specialized) pendingFunctions.push(specialized);
      }
      fnInfo = functionRegistry.get(mangledAny);
      if (fnInfo) resolvedCallee = mangledAny;
    }
    if (!fnInfo) {
      compileError(`call to undeclared function '${expr.callee.value}'`, expr.span);
    }
    const restIdx = restParamRegistry.get(resolvedCallee);
    if (restIdx !== undefined) {
      const args: HIRExpr[] = [];
      for (let i = 0; i < restIdx; i++) {
        let arg = lowerExpr(expr.arguments[i].expression);
        if (fnInfo.params[i]) arg = coerce(arg, fnInfo.params[i].type);
        args.push(arg);
      }
      const restParam = fnInfo.params[restIdx];
      const elemType =
        restParam.type.kind === "array"
          ? (restParam.type as { kind: "array"; element: HIRType }).element
          : F64;
      const restArgs: HIRExpr[] = [];
      for (let i = restIdx; i < expr.arguments.length; i++) {
        let arg = lowerExpr(expr.arguments[i].expression);
        arg = coerce(arg, elemType);
        restArgs.push(arg);
      }
      const restArray: HIRExpr = {
        kind: "alloc_array",
        elementType: elemType,
        initialValues: restArgs,
        type: { kind: "array", element: elemType },
      };
      args.push(restArray);
      return {
        kind: "call",
        callee: resolvedCallee,
        args,
        returnType: fnInfo.returnType,
        type: fnInfo.returnType,
      };
    }
    const args: HIRExpr[] = expr.arguments.map((a, i) => {
      const paramType = fnInfo.params[i]?.type;
      if (paramType?.kind === "ptr" || paramType?.kind === "i8ptr") setExpectedDeclType(paramType);
      let arg = lowerExpr(a.expression);
      if (paramType?.kind === "ptr" || paramType?.kind === "i8ptr") setExpectedDeclType(null);
      if (fnInfo.params[i]) {
        arg = coerce(arg, fnInfo.params[i].type);
      }
      return arg;
    });
    for (let i = args.length; i < fnInfo.params.length; i++) {
      const p = fnInfo.params[i];
      if (p.defaultValue) {
        args.push(coerce(p.defaultValue, p.type));
      } else {
        args.push(defaultValue(p.type));
      }
    }
    return {
      kind: "call",
      callee: resolvedCallee,
      args,
      returnType: fnInfo.returnType,
      type: fnInfo.returnType,
    };
  }

  compileError(`unsupported call expression: callee is ${expr.callee.type}`, expr.span);
}

export function lowerNewExpr(expr: any): HIRExpr {
  if (expr.callee.type !== "Identifier") {
    compileError("new expression requires identifier callee", expr.span);
  }
  const className = expr.callee.value;

  if (className === "RegExp") {
    const patternArg =
      expr.arguments?.length > 0
        ? lowerExpr(expr.arguments[0].expression)
        : ({ kind: "literal_string" as const, value: "", type: I8PTR } as HIRExpr);
    const flagsArg =
      expr.arguments?.length > 1
        ? lowerExpr(expr.arguments[1].expression)
        : ({ kind: "literal_string" as const, value: "", type: I8PTR } as HIRExpr);
    return {
      kind: "runtime_call",
      func: "cs2_regex_new",
      args: [patternArg, flagsArg],
      returnType: REGEX,
      type: REGEX,
    };
  }

  if (className === "Map") {
    let keyType: HIRType = I8PTR;
    let valueType: HIRType = BOXED;
    if (expr.typeArguments?.params?.length === 2) {
      keyType = resolveTypeAnnotation(expr.typeArguments.params[0]);
      valueType = resolveTypeAnnotation(expr.typeArguments.params[1]);
    }
    const prefix = mapPrefix(keyType, valueType);
    const resultType: HIRType = { kind: "map", key: keyType, value: valueType };
    return {
      kind: "runtime_call",
      func: `${prefix}_new`,
      args: [],
      returnType: resultType,
      type: resultType,
    };
  }

  if (className === "Set") {
    let elemType: HIRType | null = null;
    let initElements: HIRExpr[] = [];
    if (expr.typeArguments?.params?.length === 1) {
      elemType = resolveTypeAnnotation(expr.typeArguments.params[0]);
    }
    if (expr.arguments?.length > 0 && expr.arguments[0].expression.type === "ArrayExpression") {
      const elems = (expr.arguments[0].expression.elements || []).filter((e: any) => e !== null);
      for (const elem of elems) {
        const lowered = lowerExpr(elem.expression);
        if (!elemType) elemType = lowered.type;
        initElements.push(coerce(lowered, elemType!));
      }
    }
    if (elemType) {
      const resultType: HIRType = { kind: "set", element: elemType };
      if (initElements.length > 0) {
        return {
          kind: "alloc_set",
          element: elemType,
          elements: initElements,
          type: resultType,
        };
      }
      return {
        kind: "runtime_call",
        func: `${setPrefix(elemType)}_new`,
        args: [],
        returnType: resultType,
        type: resultType,
      };
    }
  }

  if (className === "Uint8Array") {
    const sizeArg =
      expr.arguments?.length > 0
        ? coerce(lowerExpr(expr.arguments[0].expression), F64)
        : ({ kind: "literal_f64" as const, value: 0, type: F64 } as HIRExpr);
    const resultType: HIRType = { kind: "ptr", pointee: "Uint8Array" };
    return {
      kind: "runtime_call",
      func: "cs2_uint8array_new",
      args: [sizeArg],
      returnType: resultType,
      type: resultType,
    };
  }

  if (className === "Float64Array") {
    const sizeArg =
      expr.arguments?.length > 0
        ? coerce(lowerExpr(expr.arguments[0].expression), F64)
        : ({ kind: "literal_f64" as const, value: 0, type: F64 } as HIRExpr);
    const resultType: HIRType = { kind: "ptr", pointee: "Float64Array" };
    return {
      kind: "runtime_call",
      func: "cs2_float64array_new",
      args: [sizeArg],
      returnType: resultType,
      type: resultType,
    };
  }

  if (className === "Date") {
    const dateType: HIRType = { kind: "ptr", pointee: "Date" };
    if (expr.arguments?.length > 0) {
      const msArg = coerce(lowerExpr(expr.arguments[0].expression), F64);
      return {
        kind: "runtime_call",
        func: "cs2_date_new",
        args: [msArg],
        returnType: dateType,
        type: dateType,
      };
    }
    return {
      kind: "runtime_call",
      func: "cs2_date_new_now",
      args: [],
      returnType: dateType,
      type: dateType,
    };
  }

  if (className === "Error") {
    if (expr.arguments?.length > 0) {
      return coerce(lowerExpr(expr.arguments[0].expression), I8PTR);
    }
    return { kind: "literal_string", value: "Error", type: I8PTR };
  }

  if (genericClassTemplates.has(className) && expr.typeArguments?.params?.length) {
    return lowerGenericNewExpr(expr);
  }

  const classInfo = classRegistry.get(className);
  if (!classInfo) {
    compileError(`new expression for unknown class '${className}'`, expr.span);
  }

  const ctorInfo = functionRegistry.get(`${className}_constructor`);
  const args: HIRExpr[] = (expr.arguments || []).map((a: any, i: number) => {
    let arg = lowerExpr(a.expression);
    if (ctorInfo && ctorInfo.params[i]) {
      arg = coerce(arg, ctorInfo.params[i].type);
    }
    return arg;
  });
  if (ctorInfo) {
    for (let i = args.length; i < ctorInfo.params.length; i++) {
      const p = ctorInfo.params[i];
      args.push(p.defaultValue ? coerce(p.defaultValue, p.type) : defaultValue(p.type));
    }
  }

  const resultType: HIRType = { kind: "ptr", pointee: className };
  return {
    kind: "call",
    callee: `${className}_constructor`,
    args,
    returnType: resultType,
    type: resultType,
  };
}




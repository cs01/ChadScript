import type {
  CallExpression,
  MemberExpression,
  Identifier,
} from "@swc/core";

import type { HIRExpr, HIRType } from "./types.js";
import { F64, I64, I1, I8PTR, VOID, BOXED, DYNOBJ } from "./types.js";
import { compileError } from "../errors.js";
import { classRegistry, coerce } from "./lower-state.js";
import { lowerExpr } from "./lower-expr.js";

export function lowerProcessCall(expr: CallExpression): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "exit": {
      const code =
        expr.arguments.length > 0
          ? coerce(lowerExpr(expr.arguments[0].expression), I64)
          : ({ kind: "literal_i64", value: 0, type: I64 } as HIRExpr);
      return {
        kind: "runtime_call",
        func: "cs2_process_exit",
        args: [code],
        returnType: VOID,
        type: VOID,
      };
    }
    case "cwd":
      return {
        kind: "runtime_call",
        func: "cs2_process_cwd",
        args: [],
        returnType: I8PTR,
        type: I8PTR,
      };
    default:
      throw new Error(`unsupported process method: ${method}`);
  }
}

export function lowerPathCall(expr: CallExpression): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "join": {
      const args = expr.arguments.map((a) => lowerExpr(a.expression));
      if (args.length === 0) return { kind: "literal_string", value: ".", type: I8PTR };
      if (args.length === 1) return args[0];
      let result: HIRExpr = args[0];
      for (let i = 1; i < args.length; i++) {
        result = {
          kind: "runtime_call",
          func: "cs2_path_join",
          args: [result, args[i]],
          returnType: I8PTR,
          type: I8PTR,
        };
      }
      return result;
    }
    case "resolve": {
      const arg =
        expr.arguments.length > 0
          ? lowerExpr(expr.arguments[0].expression)
          : ({ kind: "literal_string" as const, value: "", type: I8PTR } as HIRExpr);
      return {
        kind: "runtime_call",
        func: "cs2_path_resolve",
        args: [arg],
        returnType: I8PTR,
        type: I8PTR,
      };
    }
    case "dirname":
      return {
        kind: "runtime_call",
        func: "cs2_path_dirname",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: I8PTR,
        type: I8PTR,
      };
    case "basename":
      return {
        kind: "runtime_call",
        func: "cs2_path_basename",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: I8PTR,
        type: I8PTR,
      };
    case "extname":
      return {
        kind: "runtime_call",
        func: "cs2_path_extname",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: I8PTR,
        type: I8PTR,
      };
    default:
      throw new Error(`unsupported path method: ${method}`);
  }
}

export function lowerFsCall(expr: CallExpression): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "readFileSync":
      return {
        kind: "runtime_call",
        func: "cs2_fs_read_file_sync",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: I8PTR,
        type: I8PTR,
      };
    case "writeFileSync":
      return {
        kind: "runtime_call",
        func: "cs2_fs_write_file_sync",
        args: [lowerExpr(expr.arguments[0].expression), lowerExpr(expr.arguments[1].expression)],
        returnType: VOID,
        type: VOID,
      };
    case "copyFileSync":
      return {
        kind: "runtime_call",
        func: "cs2_fs_copy_file_sync",
        args: [lowerExpr(expr.arguments[0].expression), lowerExpr(expr.arguments[1].expression)],
        returnType: VOID,
        type: VOID,
      };
    case "existsSync":
      return {
        kind: "runtime_call",
        func: "cs2_fs_exists_sync",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: I1,
        type: I1,
      };
    case "readdirSync":
      return {
        kind: "runtime_call",
        func: "cs2_fs_readdir_sync",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: { kind: "array", element: I8PTR },
        type: { kind: "array", element: I8PTR },
      };
    case "mkdirSync":
      return {
        kind: "runtime_call",
        func: "cs2_fs_mkdir_sync",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: VOID,
        type: VOID,
      };
    case "unlinkSync":
      return {
        kind: "runtime_call",
        func: "cs2_fs_unlink_sync",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: VOID,
        type: VOID,
      };
    case "statSync":
      throw new Error(
        "fs.statSync is not supported directly — use fs.existsSync, or statSync().isFile()/isDirectory() pattern",
      );
    default:
      throw new Error(`unsupported fs method: ${method}`);
  }
}

export function matchCryptoChain(expr: CallExpression): HIRExpr | null {
  if (expr.callee.type !== "MemberExpression") return null;
  const outerMember = expr.callee as MemberExpression;
  if (outerMember.property.type !== "Identifier") return null;
  if (outerMember.object.type !== "CallExpression") return null;

  const outerMethod = (outerMember.property as Identifier).value;
  const midCall = outerMember.object as CallExpression;

  if (outerMethod === "toString" && midCall.callee.type === "MemberExpression") {
    const midMember = midCall.callee as MemberExpression;
    if (
      midMember.object.type === "Identifier" &&
      (midMember.object as Identifier).value === "crypto" &&
      midMember.property.type === "Identifier" &&
      (midMember.property as Identifier).value === "randomBytes"
    ) {
      const nArg = lowerExpr(midCall.arguments[0].expression);
      return {
        kind: "runtime_call",
        func: "cs2_crypto_random_bytes_hex",
        args: [coerce(nArg, F64)],
        returnType: I8PTR,
        type: I8PTR,
      };
    }
  }

  if (outerMethod === "digest" && midCall.callee.type === "MemberExpression") {
    const midMember = midCall.callee as MemberExpression;
    if (
      midMember.property.type === "Identifier" &&
      (midMember.property as Identifier).value === "update" &&
      midMember.object.type === "CallExpression"
    ) {
      const innerCall = midMember.object as CallExpression;
      const isCreateHash =
        (innerCall.callee.type === "MemberExpression" &&
          (innerCall.callee as MemberExpression).object.type === "Identifier" &&
          ((innerCall.callee as MemberExpression).object as Identifier).value === "crypto" &&
          (innerCall.callee as MemberExpression).property.type === "Identifier" &&
          ((innerCall.callee as MemberExpression).property as Identifier).value === "createHash") ||
        (innerCall.callee.type === "Identifier" &&
          (innerCall.callee as Identifier).value === "createHash");
      if (isCreateHash) {
        const algoArg = lowerExpr(innerCall.arguments[0].expression);
        const dataArg = lowerExpr(midCall.arguments[0].expression);
        const encodingArg = lowerExpr(expr.arguments[0].expression);
        return {
          kind: "runtime_call",
          func: "cs2_crypto_hash",
          args: [algoArg, dataArg, encodingArg],
          returnType: I8PTR,
          type: I8PTR,
        };
      }
    }
  }

  return null;
}

const BUFFER_PTR: HIRType = { kind: "ptr", pointee: "Buffer" };

export function lowerBufferStaticCall(expr: CallExpression): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "from": {
      const strArg = lowerExpr(expr.arguments[0].expression);
      const encoding =
        expr.arguments.length > 1
          ? lowerExpr(expr.arguments[1].expression)
          : ({ kind: "literal_string" as const, value: "utf8", type: I8PTR } as HIRExpr);
      return {
        kind: "runtime_call",
        func: "cs2_buffer_from_string",
        args: [strArg, encoding],
        returnType: BUFFER_PTR,
        type: BUFFER_PTR,
      };
    }
    case "alloc": {
      const sizeArg = lowerExpr(expr.arguments[0].expression);
      return {
        kind: "runtime_call",
        func: "cs2_buffer_alloc",
        args: [coerce(sizeArg, F64)],
        returnType: BUFFER_PTR,
        type: BUFFER_PTR,
      };
    }
    default:
      throw new Error(`unsupported Buffer static method: ${method}`);
  }
}

export function lowerDateMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  const dateMethods: Record<string, { func: string; returnType: HIRType }> = {
    getTime: { func: "cs2_date_get_time", returnType: F64 },
    getFullYear: { func: "cs2_date_get_full_year", returnType: F64 },
    getMonth: { func: "cs2_date_get_month", returnType: F64 },
    getDate: { func: "cs2_date_get_date", returnType: F64 },
    getHours: { func: "cs2_date_get_hours", returnType: F64 },
    getMinutes: { func: "cs2_date_get_minutes", returnType: F64 },
    getSeconds: { func: "cs2_date_get_seconds", returnType: F64 },
    getDay: { func: "cs2_date_get_day", returnType: F64 },
    toISOString: { func: "cs2_date_to_iso_string", returnType: I8PTR },
    toString: { func: "cs2_date_to_string", returnType: I8PTR },
    getMilliseconds: { func: "cs2_date_get_milliseconds", returnType: F64 },
    getTimezoneOffset: { func: "cs2_date_get_timezone_offset", returnType: F64 },
    valueOf: { func: "cs2_date_value_of", returnType: F64 },
    toDateString: { func: "cs2_date_to_date_string", returnType: I8PTR },
    toTimeString: { func: "cs2_date_to_time_string", returnType: I8PTR },
  };

  const setMethods: Record<string, string> = {
    setTime: "cs2_date_set_time",
    setFullYear: "cs2_date_set_full_year",
    setMonth: "cs2_date_set_month",
    setDate: "cs2_date_set_date",
    setHours: "cs2_date_set_hours",
    setMinutes: "cs2_date_set_minutes",
    setSeconds: "cs2_date_set_seconds",
  };

  if (typeof setMethods[method] === "string") {
    const arg = coerce(lowerExpr(expr.arguments[0].expression), F64);
    return {
      kind: "runtime_call",
      func: setMethods[method],
      args: [obj, arg],
      returnType: VOID,
      type: VOID,
    };
  }

  const info = dateMethods[method];
  if (!info) compileError(`unsupported Date method: ${method}`, expr.span);

  return {
    kind: "runtime_call",
    func: info.func,
    args: [obj],
    returnType: info.returnType,
    type: info.returnType,
  };
}

export function lowerBufferMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "toString": {
      const encoding =
        expr.arguments.length > 0
          ? lowerExpr(expr.arguments[0].expression)
          : ({ kind: "literal_string" as const, value: "utf8", type: I8PTR } as HIRExpr);
      return {
        kind: "runtime_call",
        func: "cs2_buffer_to_string",
        args: [obj, encoding],
        returnType: I8PTR,
        type: I8PTR,
      };
    }
    default:
      throw new Error(`unsupported Buffer method: ${method}`);
  }
}

export function lowerChildProcessCall(expr: CallExpression): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "execSync":
      return {
        kind: "runtime_call",
        func: "cs2_exec_sync",
        args: [lowerExpr(expr.arguments[0].expression)],
        returnType: I8PTR,
        type: I8PTR,
      };
    default:
      throw new Error(`unsupported child_process method: ${method}`);
  }
}

const HTTP_SERVER: HIRType = { kind: "ptr", pointee: "HttpServer" };

export function ensureHttpTypesRegistered(): void {
  if (!classRegistry.has("HttpRequest")) {
    classRegistry.set("HttpRequest", {
      fields: [
        { name: "method", type: I8PTR },
        { name: "url", type: I8PTR },
      ],
      methods: new Map(),
    });
  }
  if (!classRegistry.has("HttpResponse")) {
    classRegistry.set("HttpResponse", {
      fields: [],
      methods: new Map(),
    });
  }
}

export function lowerHttpCall(expr: CallExpression): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "createServer": {
      ensureHttpTypesRegistered();
      const cbAst = expr.arguments[0].expression as any;
      if (cbAst.type === "ArrowFunctionExpression" || cbAst.type === "FunctionExpression") {
        const params = cbAst.params || [];
        const typeNames = ["HttpRequest", "HttpResponse"];
        for (let i = 0; i < Math.min(params.length, 2); i++) {
          const pat = params[i].pat || params[i];
          if (pat.type === "Identifier") {
            pat.typeAnnotation = {
              type: "TsTypeAnnotation",
              span: pat.span,
              typeAnnotation: {
                type: "TsTypeReference",
                span: pat.span,
                typeName: {
                  type: "Identifier",
                  span: pat.span,
                  value: typeNames[i],
                  optional: false,
                },
              },
            };
          }
        }
      }
      const callbackExpr = lowerExpr(expr.arguments[0].expression);
      return {
        kind: "runtime_call",
        func: "cs2_http_create_server",
        args: [callbackExpr],
        returnType: HTTP_SERVER,
        type: HTTP_SERVER,
      };
    }
    default:
      throw new Error(`unsupported http method: ${method}`);
  }
}

export function lowerHttpServerMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "listen": {
      let portExpr = lowerExpr(expr.arguments[0].expression);
      if (portExpr.type.kind !== "f64") portExpr = coerce(portExpr, F64);
      const callbackExpr =
        expr.arguments.length > 1
          ? lowerExpr(expr.arguments[1].expression)
          : ({ kind: "literal_null" as const, type: I8PTR } as HIRExpr);
      return {
        kind: "runtime_call",
        func: "cs2_http_server_listen",
        args: [obj, portExpr, callbackExpr],
        returnType: VOID,
        type: VOID,
      };
    }
    case "close":
      return {
        kind: "runtime_call",
        func: "cs2_http_server_close",
        args: [obj],
        returnType: VOID,
        type: VOID,
      };
    default:
      throw new Error(`unsupported HttpServer method: ${method}`);
  }
}

export function lowerHttpResponseMethodCall(expr: CallExpression, obj: HIRExpr): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "writeHead": {
      let statusExpr = lowerExpr(expr.arguments[0].expression);
      if (statusExpr.type.kind !== "f64") statusExpr = coerce(statusExpr, F64);
      const ctExpr =
        expr.arguments.length > 1
          ? lowerExpr(expr.arguments[1].expression)
          : ({ kind: "literal_string" as const, value: "text/plain", type: I8PTR } as HIRExpr);
      return {
        kind: "runtime_call",
        func: "cs2_http_res_write_head",
        args: [obj, statusExpr, ctExpr],
        returnType: VOID,
        type: VOID,
      };
    }
    case "end": {
      const bodyExpr =
        expr.arguments.length > 0
          ? lowerExpr(expr.arguments[0].expression)
          : ({ kind: "literal_string" as const, value: "", type: I8PTR } as HIRExpr);
      return {
        kind: "runtime_call",
        func: "cs2_http_res_end",
        args: [obj, bodyExpr],
        returnType: VOID,
        type: VOID,
      };
    }
    default:
      throw new Error(`unsupported HttpResponse method: ${method}`);
  }
}

export function lowerMathCall(expr: CallExpression): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;
  const args = expr.arguments.map((a) => lowerExpr(a.expression));

  switch (method) {
    case "random":
      return {
        kind: "runtime_call",
        func: "cs2_math_random",
        args: [],
        returnType: F64,
        type: F64,
      };
    case "sign":
      return { kind: "runtime_call", func: "cs_math_sign", args, returnType: F64, type: F64 };
    case "clz32":
      return { kind: "runtime_call", func: "cs_math_clz32", args, returnType: F64, type: F64 };
    default: {
      const func = `cs_math_${method}`;
      return { kind: "runtime_call", func, args, returnType: F64, type: F64 };
    }
  }
}

export function lowerJSONCall(expr: CallExpression): HIRExpr {
  const member = expr.callee as MemberExpression;
  const method = (member.property as Identifier).value;

  switch (method) {
    case "stringify": {
      const arg = lowerExpr(expr.arguments[0].expression);
      const argType = arg.type;
      let func: string;
      let args: HIRExpr[];

      switch (argType.kind) {
        case "f64":
          func = "cs2_json_stringify_f64";
          args = [arg];
          break;
        case "i64":
          func = "cs2_json_stringify_i64";
          args = [arg];
          break;
        case "i8ptr":
          func = "cs2_json_stringify_str";
          args = [arg];
          break;
        case "i1":
          func = "cs2_json_stringify_bool";
          args = [arg];
          break;
        case "boxed":
        case "dynobj":
          func = "cs2_json_stringify_boxed";
          args = [coerce(arg, BOXED)];
          break;
        case "array": {
          const elemType = (argType as { kind: "array"; element: HIRType }).element;
          switch (elemType.kind) {
            case "f64":
            case "i64":
              func = "cs2_json_stringify_num_array";
              break;
            case "i8ptr":
              func = "cs2_json_stringify_str_array";
              break;
            default:
              throw new Error(
                `unsupported array element type for JSON.stringify: ${elemType.kind}`,
              );
          }
          args = [arg];
          break;
        }
        default:
          throw new Error(`unsupported type for JSON.stringify: ${argType.kind}`);
      }

      return {
        kind: "runtime_call",
        func,
        args,
        returnType: I8PTR,
        type: I8PTR,
      };
    }
    case "parse": {
      let arg = lowerExpr(expr.arguments[0].expression);
      if (arg.type.kind !== "i8ptr") arg = coerce(arg, I8PTR);
      return {
        kind: "runtime_call",
        func: "cs2_json_parse_obj",
        args: [arg],
        returnType: DYNOBJ,
        type: DYNOBJ,
      };
    }
    default:
      compileError(`unsupported JSON method: ${method}`, expr.span);
  }
}

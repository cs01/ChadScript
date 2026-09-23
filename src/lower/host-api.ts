// Lowering of the host APIs (node:net, and the network modules built on it): module functions
// (`net.createServer(...)`), methods on host handles (`socket.write(...)`), and property reads
// (`server.address().port`). Every entry is a direct runtime call.
//
// The tables below ARE the admitted surface: a unit test (tests/unit/host-api.test.ts) checks that
// every member stdlib/globals.d.ts declares on a host type has an entry here and vice versa, so a
// declared member can never reach lowering without one (it would ice), and an entry can never
// outlive its declaration.

import ts from "typescript";
import { ice } from "../diagnostics.js";
import type { HExpr } from "../hir/nodes.js";
import { VT } from "../hir/types.js";
import type { ValueType } from "../hir/types.js";
import { type LowerCtx, lowerExpr, symbolOf, unparen } from "./lower.js";
import { calleeIdentifier } from "./module-refs.js";
import { adaptCallback } from "./callback-adapt.js";
import { valueTypeOf, valueTypeOfTsType } from "./type-translation.js";
import { hostTypeName, qualifiedAmbientName } from "./host-types.js";

type MethodLowering = (call: ts.CallExpression, recv: HExpr, ctx: LowerCtx) => HExpr;
type FunctionLowering = (call: ts.CallExpression, ctx: LowerCtx) => HExpr;

function str(value: string): HExpr {
  return { kind: "stringLit", value, type: VT.string };
}

function rt(fn: string, args: HExpr[], type: ValueType): HExpr {
  return { kind: "runtimeCall", fn, args, type };
}

// A callback argument, adapted to the argument representations the runtime passes, which are the
// parameter types of the callback type the resolved overload declares.
function lowerCallback(call: ts.CallExpression, index: number, ctx: LowerCtx): HExpr {
  const arg = call.arguments[index] ?? ice(`lower: host callback argument ${index} missing`);
  const sig = ctx.checker.getResolvedSignature(call) ?? ice("lower: host call has no signature");
  const param = sig.getParameters()[index] ?? ice("lower: host callback parameter missing");
  const paramType = ctx.checker.getNonNullableType(
    ctx.checker.getTypeOfSymbolAtLocation(param, call),
  );
  const cbSig =
    paramType.getCallSignatures()[0] ?? ice("lower: host callback parameter is not a function");
  const passed = cbSig
    .getParameters()
    .map((p) =>
      valueTypeOfTsType(ctx.checker.getTypeOfSymbolAtLocation(p, call), call, ctx.checker),
    );
  return adaptCallback(lowerExpr(arg, ctx), passed);
}

function isFunctionArg(call: ts.CallExpression, index: number, ctx: LowerCtx): boolean {
  const arg = call.arguments[index];
  if (!arg) return false;
  return ctx.checker.getTypeAtLocation(arg).getCallSignatures().length > 0;
}

function isStringArg(call: ts.CallExpression, index: number, ctx: LowerCtx): boolean {
  const arg = call.arguments[index];
  if (!arg) return false;
  return (ctx.checker.getTypeAtLocation(arg).flags & ts.TypeFlags.StringLike) !== 0;
}

// The `port` and `host` of a `{ port, host? }` options literal (the validator admits only a
// literal, so its properties are visible here). A missing host is "", which the runtime reads as
// Node's default.
function connectOptions(call: ts.CallExpression, ctx: LowerCtx): [HExpr, HExpr] {
  const opts = unparen(call.arguments[0] ?? ice("lower: connect without options"));
  if (!ts.isObjectLiteralExpression(opts)) return ice("lower: connect options are not a literal");
  let port: HExpr | null = null;
  let host: HExpr = str("");
  for (const p of opts.properties) {
    const name = p.name && ts.isIdentifier(p.name) ? p.name.text : null;
    const value = ts.isPropertyAssignment(p)
      ? p.initializer
      : ts.isShorthandPropertyAssignment(p)
        ? p.name
        : ice("lower: connect option form");
    if (name === "port") port = lowerExpr(value, ctx);
    else if (name === "host") host = lowerExpr(value, ctx);
    else ice(`lower: connect option ${name}`);
  }
  return [port ?? ice("lower: connect without port"), host];
}

function thisType(recv: HExpr): ValueType {
  return recv.type;
}

// `on(event, listener)` for every host handle: the runtime maps the event name.
const onMethod: MethodLowering = (call, recv, ctx) =>
  rt(
    "cs_net_on",
    [recv, lowerExpr(call.arguments[0]!, ctx), lowerCallback(call, 1, ctx)],
    thisType(recv),
  );

export const HOST_METHODS: Record<string, MethodLowering> = {
  "Buffer.toString": (_call, recv) => rt("cs_buffer_to_string", [recv], VT.string),

  "net.Server.listen": (call, recv, ctx) => {
    const port = lowerExpr(call.arguments[0]!, ctx);
    const host = isStringArg(call, 1, ctx) ? lowerExpr(call.arguments[1]!, ctx) : str("");
    const cbIndex = call.arguments.findIndex((_, i) => i > 0 && isFunctionArg(call, i, ctx));
    return cbIndex > 0
      ? rt(
          "cs_net_listen_cb",
          [recv, port, host, lowerCallback(call, cbIndex, ctx)],
          thisType(recv),
        )
      : rt("cs_net_listen", [recv, port, host], thisType(recv));
  },
  "net.Server.address": (_call, recv) => rt("cs_net_address", [recv], VT.opaque("net.AddressInfo")),
  "net.Server.close": (call, recv, ctx) =>
    call.arguments.length > 0
      ? rt("cs_net_server_close_cb", [recv, lowerCallback(call, 0, ctx)], thisType(recv))
      : rt("cs_net_server_close", [recv], thisType(recv)),
  "net.Server.on": onMethod,

  "net.Socket.write": (call, recv, ctx) =>
    rt("cs_net_write", [recv, lowerExpr(call.arguments[0]!, ctx)], VT.boolean),
  "net.Socket.end": (call, recv, ctx) =>
    call.arguments.length > 0
      ? rt("cs_net_end_data", [recv, lowerExpr(call.arguments[0]!, ctx)], thisType(recv))
      : rt("cs_net_end", [recv], thisType(recv)),
  "net.Socket.setEncoding": (call, recv, ctx) =>
    rt("cs_net_set_encoding", [recv, lowerExpr(call.arguments[0]!, ctx)], thisType(recv)),
  "net.Socket.destroy": (_call, recv) => rt("cs_net_destroy", [recv], thisType(recv)),
  "net.Socket.on": onMethod,
};

export const HOST_PROPERTIES: Record<string, { entry: string; type: ValueType }> = {
  "Buffer.length": { entry: "cs_buffer_length", type: VT.number },
  "net.AddressInfo.port": { entry: "cs_net_addr_port", type: VT.number },
  "net.AddressInfo.address": { entry: "cs_net_addr_address", type: VT.string },
  "net.AddressInfo.family": { entry: "cs_net_addr_family", type: VT.string },
};

const netConnect: FunctionLowering = (call, ctx) => {
  const [port, host] = connectOptions(call, ctx);
  const type = valueTypeOf(call, ctx);
  return call.arguments.length > 1
    ? rt("cs_net_connect_cb", [port, host, lowerCallback(call, 1, ctx)], type)
    : rt("cs_net_connect", [port, host], type);
};

export const HOST_FUNCTIONS: Record<string, FunctionLowering> = {
  "net.createServer": (call, ctx) =>
    call.arguments.length > 0
      ? rt("cs_net_create_server_cb", [lowerCallback(call, 0, ctx)], valueTypeOf(call, ctx))
      : rt("cs_net_create_server", [], valueTypeOf(call, ctx)),
  "net.connect": netConnect,
  "net.createConnection": netConnect,
};

// The declaration a member access resolves to, qualified by its host type: "net.Socket.write".
function hostMemberKey(pa: ts.PropertyAccessExpression, ctx: LowerCtx): string | null {
  const host = hostTypeName(ctx.checker.getTypeAtLocation(pa.expression));
  return host === null ? null : `${host}.${pa.name.text}`;
}

// `recv.method(args)` on a host handle, or null when the receiver is not one.
export function lowerHostMethodCall(call: ts.CallExpression, ctx: LowerCtx): HExpr | null {
  const pa = call.expression;
  if (!ts.isPropertyAccessExpression(pa)) return null;
  const key = hostMemberKey(pa, ctx);
  if (key === null) return null;
  const lowering = HOST_METHODS[key] ?? ice(`lower: host method ${key} has no lowering`);
  return lowering(call, lowerExpr(pa.expression, ctx), ctx);
}

// `recv.prop` on a host handle, or null when the receiver is not one.
export function lowerHostProperty(pa: ts.PropertyAccessExpression, ctx: LowerCtx): HExpr | null {
  const key = hostMemberKey(pa, ctx);
  if (key === null) return null;
  const prop = HOST_PROPERTIES[key] ?? ice(`lower: host property ${key} has no lowering`);
  return rt(prop.entry, [lowerExpr(pa.expression, ctx)], prop.type);
}

// `net.createServer(...)` and the other module functions, called by name, through a namespace or
// through a default import. Dispatch is by the SYMBOL's declaration, so a program's own
// `createServer` stays a program function.
export function lowerHostFunctionCall(call: ts.CallExpression, ctx: LowerCtx): HExpr | null {
  const callee = calleeIdentifier(call, ctx.checker);
  if (!callee) return null;
  const decl = symbolOf(callee, ctx)?.declarations?.[0];
  if (!decl || !ts.isFunctionDeclaration(decl) || !decl.name) return null;
  const key = qualifiedAmbientName(decl, decl.name.text);
  if (key === null || !(key in HOST_FUNCTIONS)) return null;
  return HOST_FUNCTIONS[key]!(call, ctx);
}

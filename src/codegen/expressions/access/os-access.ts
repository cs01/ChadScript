// os-access.ts — Property access handlers for the os module.
// Handles compile-time constants: os.platform, os.arch, os.EOL

import { MemberAccessNode, VariableNode } from "../../../ast/types.js";
import type { MemberAccessGeneratorContext } from "./member.js";

interface ExprBase {
  type: string;
}

export function handleOsProperty(
  ctx: MemberAccessGeneratorContext,
  expr: MemberAccessNode,
): string | null {
  const exprObjBase = expr.object as ExprBase;
  if (exprObjBase.type !== "variable") return null;
  if ((expr.object as VariableNode).name !== "os") return null;

  const prop = expr.property;

  if (prop === "platform") {
    const platformStr = ctx.getTargetOS() || process.platform;
    return ctx.stringGen.doCreateStringConstant(platformStr);
  }
  if (prop === "arch") {
    const archStr = ctx.getTargetArch() || "x64";
    return ctx.stringGen.doCreateStringConstant(archStr);
  }
  if (prop === "EOL") {
    return ctx.stringGen.doCreateStringConstant("\n");
  }
  return null;
}

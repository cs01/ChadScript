import type { InterfaceFieldInfo } from "../../types/interface-struct-generator.js";
import type { MemberAccessGeneratorContext, JsonObjectMeta } from "./member.js";

interface ObjectMetadata {
  keys: string[];
  types: string[];
  tsTypes?: string[];
}

export function accessObjectWithMetadata(
  ctx: MemberAccessGeneratorContext,
  varName: string,
  property: string,
  metadata: ObjectMetadata,
): string {
  const propIndex = metadata.keys.indexOf(property);
  if (propIndex === -1) {
    const varType = ctx.getVariableType(varName) || "unknown";
    ctx.emitError(
      `Property '${property}' not found on object '${varName}' (llvmType=${varType}, keys=${metadata.keys.length}). Available properties: ${metadata.keys.join(", ")}`,
    );
  }

  const propType = metadata.types[propIndex];
  const structType = `{ ${metadata.types.join(", ")} }`;

  const varPtr = ctx.getVariableAlloca(varName);
  if (!varPtr) {
    throw new Error(`Variable ${varName} not found in symbol table`);
  }

  const objPtr = ctx.nextTemp();
  ctx.emit(`${objPtr} = load i8*, i8** ${varPtr}`);

  const typedPtr = ctx.nextTemp();
  ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);

  const fieldPtr = ctx.nextTemp();
  ctx.emit(
    `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`,
  );

  const value = ctx.nextTemp();
  ctx.emit(`${value} = load ${propType}, ${propType}* ${fieldPtr}`);
  ctx.setVariableType(value, propType);

  return value;
}

export function accessObjectProperty(
  ctx: MemberAccessGeneratorContext,
  objPtr: string,
  property: string,
  keys: string[],
  types: string[],
  _tsTypes?: string[],
): string {
  const propIndex = keys.indexOf(property);
  if (propIndex === -1) {
    return ctx.emitError(
      `Property '${property}' not found. Available properties: ${keys.join(", ")}`,
    );
  }

  const propType = types[propIndex];
  const structType = `{ ${types.join(", ")} }`;

  const typedPtr = ctx.nextTemp();
  ctx.emit(`${typedPtr} = bitcast i8* ${objPtr} to ${structType}*`);

  const fieldPtr = ctx.nextTemp();
  ctx.emit(
    `${fieldPtr} = getelementptr inbounds ${structType}, ${structType}* ${typedPtr}, i32 0, i32 ${propIndex}`,
  );

  const value = ctx.nextTemp();
  ctx.emit(`${value} = load ${propType}, ${propType}* ${fieldPtr}`);
  ctx.setVariableType(value, propType);

  return value;
}

// trampoline-emitter.ts — per-shape C-ABI trampoline generator.
//
// A trampoline takes an env pointer plus the shape's native args and forwards
// to a user function pointer stored inside the env struct. One trampoline is
// generated per unique LLVM callback signature; shapes are deduped by
// canonicalized `llvmSig`.
//
// PR1 scope: emit standalone trampoline functions that assume env is passed
// as the first argument. Bridges in later PRs will provide the shim that
// recovers env from the slot table (cs_tramp_get) before calling the
// trampoline — this file doesn't know about that yet.

export interface TrampolineShape {
  // Canonical LLVM signature string, e.g. "void(i8*)" or "void(i8*,double)".
  // Used as the dedup key. Does NOT include the env parameter — that's
  // implicit for every trampoline.
  llvmSig: string;
  // Ordered arg LLVM types for the C-ABI callback (excluding env).
  argTypes: string[];
  // Always "void" in PR1. Return-value closures aren't wired up yet.
  returnType: string;
}

export class TrampolineEmitter {
  private shapes: Map<string, TrampolineShape> = new Map();
  private shapeIds: Map<string, string> = new Map();

  // Register a shape. Idempotent by llvmSig. Returns the fully-qualified
  // LLVM function name (e.g. `@__cs_tramp_void_i8p_double`) that bridges
  // should point at.
  ensureTrampoline(shape: TrampolineShape): string {
    const existing = this.shapeIds.get(shape.llvmSig);
    if (existing !== undefined) return existing;
    const id = this.shapeIdFromSig(shape);
    const name = "@__cs_tramp_" + id;
    this.shapes.set(shape.llvmSig, shape);
    this.shapeIds.set(shape.llvmSig, name);
    return name;
  }

  // Emit every registered trampoline definition plus its env struct type.
  // Call once at module end. Idempotent output — emitting twice is wasteful
  // but not wrong.
  emitAll(): string {
    if (this.shapes.size === 0) return "";
    let ir = "";
    ir += "; --- C-ABI trampoline closures (per-shape dispatch) ---\n";
    ir += "; TODO(PR2): trampolines currently assume env is delivered as the\n";
    ir += ";            first arg. Future bridges will recover env via\n";
    ir += ";            cs_tramp_get(handle) and invoke these directly.\n";
    for (const shape of this.shapes.values()) {
      ir += this.emitOne(shape);
    }
    return ir;
  }

  // Visible for tests.
  listRegisteredNames(): string[] {
    return Array.from(this.shapeIds.values());
  }

  // Derive a safe identifier fragment from the shape. Maps pointer `*` to
  // `p`, commas to `_`, parens to nothing. "void(i8*,double)" -> "void_i8p_double".
  private shapeIdFromSig(shape: TrampolineShape): string {
    let id = shape.returnType;
    for (const t of shape.argTypes) {
      id += "_" + this.sanitizeType(t);
    }
    return id;
  }

  private sanitizeType(t: string): string {
    let out = "";
    for (let i = 0; i < t.length; i++) {
      const ch = t.charAt(i);
      if (ch === "*") out += "p";
      else if (ch === " ") continue;
      else if (ch === ",") out += "_";
      else out += ch;
    }
    return out;
  }

  private emitOne(shape: TrampolineShape): string {
    const id = this.shapeIdFromSig(shape);
    const envTy = "%__TrampEnv_S_" + id;
    const fnTy = this.userFnType(shape);

    // Env struct: { user_env_ptr, user_fn_ptr }. Both are i8* / function-ptr.
    let ir = "";
    ir += envTy + " = type { i8*, " + fnTy + " }\n";
    ir += "define " + shape.returnType + " @__cs_tramp_" + id + "(";
    ir += "i8* %env";
    for (let i = 0; i < shape.argTypes.length; i++) {
      ir += ", " + shape.argTypes[i] + " %arg" + i.toString();
    }
    ir += ") {\n";
    ir += "entry:\n";
    ir += "  %e = bitcast i8* %env to " + envTy + "*\n";
    ir += "  %ufp = getelementptr inbounds " + envTy + ", " + envTy + "* %e, i32 0, i32 0\n";
    ir += "  %ue = load i8*, i8** %ufp\n";
    ir += "  %fp = getelementptr inbounds " + envTy + ", " + envTy + "* %e, i32 0, i32 1\n";
    ir += "  %fn = load " + fnTy + ", " + fnTy + "* %fp\n";
    ir += "  ";
    if (shape.returnType === "void") {
      ir += "call void %fn(i8* %ue";
    } else {
      ir += "%r = call " + shape.returnType + " %fn(i8* %ue";
    }
    for (let i = 0; i < shape.argTypes.length; i++) {
      ir += ", " + shape.argTypes[i] + " %arg" + i.toString();
    }
    ir += ")\n";
    if (shape.returnType === "void") {
      ir += "  ret void\n";
    } else {
      ir += "  ret " + shape.returnType + " %r\n";
    }
    ir += "}\n\n";
    return ir;
  }

  // User function takes i8* env first, then the shape's native args.
  private userFnType(shape: TrampolineShape): string {
    let t = shape.returnType + " (i8*";
    for (const a of shape.argTypes) t += ", " + a;
    t += ")*";
    return t;
  }
}

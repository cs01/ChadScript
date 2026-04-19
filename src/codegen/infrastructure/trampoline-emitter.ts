// trampoline-emitter.ts — per-shape C-ABI trampoline generator.
//
// A trampoline takes an env pointer plus the shape's native args and forwards
// to a user function pointer stored inside the env struct. One trampoline is
// generated per unique LLVM callback signature; shapes are deduped by
// canonicalized `llvmSig`.
//
// Trampolines assume env is passed as the first argument. C bridges (e.g.
// child-process-spawn in PR2) recover env from the slot table via
// cs_tramp_get(handle) and then invoke the trampoline directly.

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
  // Parallel arrays keyed by llvmSig — avoids Map<string,TrampolineShape>
  // which the self-hosted native compiler struggles to iterate for interface
  // values. Dedup via indexOf on sigs.
  private sigs: string[] = [];
  private shapes: TrampolineShape[] = [];
  private names: string[] = [];

  // Register a shape. Idempotent by llvmSig. Returns the fully-qualified
  // LLVM function name (e.g. `@__cs_tramp_void_i8p_double`) that bridges
  // should point at.
  ensureTrampoline(shape: TrampolineShape): string {
    for (let i = 0; i < this.sigs.length; i++) {
      if (this.sigs[i] === shape.llvmSig) return this.names[i];
    }
    const id = this.shapeIdFromSig(shape);
    const name = "@__cs_tramp_" + id;
    this.sigs.push(shape.llvmSig);
    this.shapes.push(shape);
    this.names.push(name);
    return name;
  }

  // Emit every registered trampoline definition plus its env struct type.
  // Call once at module end. Idempotent output — emitting twice is wasteful
  // but not wrong.
  emitAll(): string {
    if (this.shapes.length === 0) return "";
    let ir = "";
    ir += "; --- C-ABI trampoline closures (per-shape dispatch) ---\n";
    ir += "; Env is delivered as the first arg by the C bridge (post-cs_tramp_get).\n";
    for (let i = 0; i < this.shapes.length; i++) {
      ir += this.emitOne(this.shapes[i]);
    }
    return ir;
  }

  // Visible for tests.
  listRegisteredNames(): string[] {
    return this.names.slice(0);
  }

  // Derive a safe identifier fragment from the shape. Maps pointer `*` to
  // `p`, commas to `_`, parens to nothing. "void(i8*,double)" -> "void_i8p_double".
  private shapeIdFromSig(shape: TrampolineShape): string {
    let id = shape.returnType;
    for (let i = 0; i < shape.argTypes.length; i++) {
      id += "_" + this.sanitizeType(shape.argTypes[i]);
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

    // Env struct: { user_env_ptr (i8*), user_fn_ptr_as_i8 (i8*) }.
    // Storing the user fn as `i8*` sidesteps the codegen store-type validator
    // (which doesn't handle parenthesised LLVM function-pointer types); the
    // trampoline bitcasts back to the real shape before dispatch.
    let ir = "";
    ir += envTy + " = type { i8*, i8* }\n";
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
    ir += "  %fn_i8 = load i8*, i8** %fp\n";
    ir += "  %fn = bitcast i8* %fn_i8 to " + fnTy + "\n";
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
    for (let i = 0; i < shape.argTypes.length; i++) t += ", " + shape.argTypes[i];
    t += ")*";
    return t;
  }
}

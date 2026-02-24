// Target type definitions — dependency-free so both target.ts and
// native-compiler-lib.ts can import without pulling in Node's os module.

export type LibC = "gnu" | "system";

export interface TargetInfo {
  triple: string;
  os: string;
  arch: string;
  cpu: string;
  platformString: string;
  archString: string;
  dataLayout: string;
  libc: LibC;
}

let x: number | null = 42;
console.log(x ?? -1);
x = null;
console.log(x ?? -1);
function useIt(v: string | null): string {
  return v ?? "was-null";
}
console.log(useIt("hi"));
console.log(useIt(null));
const y: string | undefined = undefined;
console.log(y ?? "def");

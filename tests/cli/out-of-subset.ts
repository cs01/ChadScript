// Outside the compiled subset (an enum): `chad run` reports it and runs nothing.
enum Color {
  Red,
  Green,
}
const args: string[] = process.argv.slice(2);
console.log("color", Color.Green, "args", args.join(","));
process.exit(3);

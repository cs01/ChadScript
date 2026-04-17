interface P {
  x: number;
  y: string;
}
function make(): P[] {
  return [
    { x: 1, y: "a" },
    { x: 2, y: "b" },
  ];
}
function main(): void {
  const last = make()[1];
  if (last.x === 2 && last.y === "b") console.log("TEST_PASSED");
}
main();

const colors: Record<string, number> = { red: 1, green: 2, blue: 3 };
console.log(colors["red"]);
console.log(colors["green"]);
console.log(colors["blue"]);

const names: Record<string, string> = { first: "chad", last: "smith" };
console.log(names["first"]);
console.log(names["last"]);

function getColor(m: Record<string, number>, key: string): number {
  return m[key];
}
console.log(getColor(colors, "red"));
console.log(getColor(colors, "blue"));

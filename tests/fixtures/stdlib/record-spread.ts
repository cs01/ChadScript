const base: Record<string, number> = { x: 1, y: 2, z: 3 };
const extended: Record<string, number> = { ...base, z: 30, w: 4 };
console.log(extended["x"]);
console.log(extended["y"]);
console.log(extended["z"]);
console.log(extended["w"]);

const orig: Record<string, string> = { name: "chad", lang: "ts" };
const updated: Record<string, string> = { ...orig, lang: "chadscript" };
console.log(updated["name"]);
console.log(updated["lang"]);

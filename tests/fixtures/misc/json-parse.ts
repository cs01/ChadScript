const n = JSON.parse("42") as number;
console.log(n);

const s = JSON.parse('"hello"') as string;
console.log(s);

const b = JSON.parse("true") as boolean;
console.log(b);

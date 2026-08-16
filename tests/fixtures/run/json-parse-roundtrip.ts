// stringify → parse → stringify must be a fixed point for every shape in the subset, which is a
// stronger statement than either direction alone.
interface Config {
  name: string;
  retries: number;
  verbose: boolean;
  hosts: string[];
}

const original: Config = {
  name: "svc",
  retries: 3,
  verbose: false,
  hosts: ["a.example", "b.example"],
};
const text = JSON.stringify(original);
const back: Config = JSON.parse(text);
console.log(text);
console.log(JSON.stringify(back));
console.log(JSON.stringify(back) === text);

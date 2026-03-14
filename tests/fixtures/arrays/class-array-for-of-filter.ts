class Task {
  name: string;
  done: boolean;
  constructor(n: string, d: boolean) {
    this.name = n;
    this.done = d;
  }
}

const tasks = [new Task("a", true), new Task("b", false), new Task("c", true)];
const done = tasks.filter((t: Task): boolean => t.done);

const names: string[] = [];
for (const t of done) {
  names.push(t.name);
}
console.log(names.join(","));

const sorted = tasks.sort((a: Task, b: Task): number => {
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
});
const sortedNames: string[] = [];
for (const t of sorted) {
  sortedNames.push(t.name);
}
console.log(sortedNames.join(","));

console.log("TEST_PASSED");

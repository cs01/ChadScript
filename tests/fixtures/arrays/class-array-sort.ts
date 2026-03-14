class Student {
  name: string;
  score: number;
  constructor(name: string, score: number) {
    this.name = name;
    this.score = score;
  }
}

const students: Student[] = [];
students.push(new Student("Alice", 85));
students.push(new Student("Bob", 92));
students.push(new Student("Charlie", 78));

students.sort((a: Student, b: Student): number => a.score - b.score);

let pass: boolean = true;
if (students[0].name !== "Charlie") {
  console.log("FAIL first: " + students[0].name);
  pass = false;
}
if (students[1].name !== "Alice") {
  console.log("FAIL second: " + students[1].name);
  pass = false;
}
if (students[2].name !== "Bob") {
  console.log("FAIL third: " + students[2].name);
  pass = false;
}

students.sort((a: Student, b: Student): number => b.score - a.score);

if (students[0].name !== "Bob") {
  console.log("FAIL desc first: " + students[0].name);
  pass = false;
}
if (students[2].name !== "Charlie") {
  console.log("FAIL desc last: " + students[2].name);
  pass = false;
}

if (pass) {
  console.log("TEST_PASSED");
}

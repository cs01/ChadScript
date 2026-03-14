class Student {
  name: string;
  grade: number;
  constructor(name: string, grade: number) {
    this.name = name;
    this.grade = grade;
  }
}

class Course {
  title: string;
  students: Student[];
  constructor(title: string) {
    this.title = title;
    this.students = [];
  }

  enroll(name: string, grade: number): void {
    this.students.push(new Student(name, grade));
  }

  average(): number {
    if (this.students.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.students.length; i++) {
      sum = sum + this.students[i].grade;
    }
    return sum / this.students.length;
  }
}

function main(): void {
  const math = new Course("Math");
  math.enroll("Alice", 90);
  math.enroll("Bob", 80);
  math.enroll("Charlie", 100);
  const avg = math.average();
  if (avg === 90) {
    console.log("TEST_PASSED");
  }
}

main();

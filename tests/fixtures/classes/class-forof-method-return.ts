class Task {
  name: string;
  priority: number;
  constructor(name: string, priority: number) {
    this.name = name;
    this.priority = priority;
  }
}

function getTasks(): Task[] {
  const tasks: Task[] = [];
  tasks.push(new Task("build", 1));
  tasks.push(new Task("test", 2));
  tasks.push(new Task("deploy", 3));
  return tasks;
}

let total = 0;
let names = "";
for (const task of getTasks()) {
  total = total + task.priority;
  names = names + task.name;
}

if (total === 6 && names === "buildtestdeploy") {
  console.log("TEST_PASSED");
}

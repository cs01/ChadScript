// @category: cli
// @args: add write-report add call-bob add ship-release done 2 list rm 1 list
// A todo-list CLI that keeps its state in todos.json in the working directory. Several commands
// can be chained on one command line.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

interface Todo {
  id: number;
  title: string;
  done: boolean;
}

interface Store {
  nextId: number;
  todos: Todo[];
}

const FILE = "todos.json";

function load(): Store {
  if (!existsSync(FILE)) return { nextId: 1, todos: [] };
  return JSON.parse(readFileSync(FILE, "utf8")) as Store;
}

function save(store: Store): void {
  writeFileSync(FILE, JSON.stringify(store, null, 2) + "\n");
}

function findTodo(store: Store, raw: string | undefined): Todo {
  const id = Number(raw);
  const todo = store.todos.find((t) => t.id === id);
  if (!todo) throw new Error(`no todo with id ${raw}`);
  return todo;
}

function run(args: string[]): void {
  const store = load();
  let i = 0;
  while (i < args.length) {
    const cmd = args[i++];
    switch (cmd) {
      case "add": {
        const title = (args[i++] ?? "").replace(/-/g, " ");
        const todo = { id: store.nextId++, title, done: false };
        store.todos.push(todo);
        console.log(`added #${todo.id}: ${todo.title}`);
        break;
      }
      case "done": {
        const todo = findTodo(store, args[i++]);
        todo.done = true;
        console.log(`completed #${todo.id}`);
        break;
      }
      case "rm": {
        const todo = findTodo(store, args[i++]);
        store.todos = store.todos.filter((t) => t !== todo);
        console.log(`removed #${todo.id}`);
        break;
      }
      case "list": {
        const open = store.todos.filter((t) => !t.done).length;
        console.log(`${store.todos.length} todos, ${open} open`);
        for (const t of store.todos) console.log(`  [${t.done ? "x" : " "}] ${t.id}. ${t.title}`);
        break;
      }
      default:
        console.log(`unknown command: ${cmd}`);
        process.exit(64);
    }
  }
  save(store);
}

run(process.argv.slice(2));

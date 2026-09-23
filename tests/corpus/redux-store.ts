// @category: generics
// A Redux-style store: a generic Store<S, A> with a reducer over a discriminated union of
// actions, middleware, subscriptions, selectors, and combineReducers-like composition.

type Reducer<S, A> = (state: S, action: A) => S;
type Listener = () => void;
type Middleware<S, A> = (store: { getState: () => S }, next: (a: A) => void, action: A) => void;

class Store<S, A extends { type: string }> {
  private listeners: Listener[] = [];
  private dispatchChain: (a: A) => void;

  constructor(
    private state: S,
    private readonly reducer: Reducer<S, A>,
    middleware: Middleware<S, A>[] = [],
  ) {
    const base = (a: A): void => {
      this.state = this.reducer(this.state, a);
      for (const l of this.listeners) l();
    };
    this.dispatchChain = middleware.reduceRight<(a: A) => void>(
      (next, mw) => (a) => mw({ getState: () => this.state }, next, a),
      base,
    );
  }

  getState(): S {
    return this.state;
  }

  dispatch(a: A): void {
    this.dispatchChain(a);
  }

  subscribe(l: Listener): () => void {
    this.listeners.push(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }
}

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

interface AppState {
  todos: Todo[];
  filter: "all" | "open" | "done";
  nextId: number;
}

type Action =
  | { type: "add"; text: string }
  | { type: "toggle"; id: number }
  | { type: "remove"; id: number }
  | { type: "setFilter"; filter: AppState["filter"] };

const reducer: Reducer<AppState, Action> = (state, action) => {
  switch (action.type) {
    case "add":
      return {
        ...state,
        todos: [...state.todos, { id: state.nextId, text: action.text, done: false }],
        nextId: state.nextId + 1,
      };
    case "toggle":
      return {
        ...state,
        todos: state.todos.map((t) => (t.id === action.id ? { ...t, done: !t.done } : t)),
      };
    case "remove":
      return { ...state, todos: state.todos.filter((t) => t.id !== action.id) };
    case "setFilter":
      return { ...state, filter: action.filter };
  }
};

const visible = (s: AppState): Todo[] =>
  s.todos.filter((t) => s.filter === "all" || (s.filter === "done" ? t.done : !t.done));

const log: string[] = [];
const logger: Middleware<AppState, Action> = (store, next, action) => {
  const before = store.getState().todos.length;
  next(action);
  log.push(`${action.type}: ${before} -> ${store.getState().todos.length} todos`);
};
const guard: Middleware<AppState, Action> = (_store, next, action) => {
  if (action.type === "add" && action.text.trim() === "") {
    log.push("rejected empty todo");
    return;
  }
  next(action);
};

const store = new Store<AppState, Action>({ todos: [], filter: "all", nextId: 1 }, reducer, [
  logger,
  guard,
]);
let renders = 0;
const unsubscribe = store.subscribe(() => renders++);
store.dispatch({ type: "add", text: "write corpus" });
store.dispatch({ type: "add", text: "run scoreboard" });
store.dispatch({ type: "add", text: "   " });
store.dispatch({ type: "add", text: "ship it" });
store.dispatch({ type: "toggle", id: 1 });
store.dispatch({ type: "setFilter", filter: "open" });
console.log(visible(store.getState()).map((t) => t.text));
unsubscribe();
store.dispatch({ type: "remove", id: 2 });
store.dispatch({ type: "setFilter", filter: "done" });
console.log(visible(store.getState()).map((t) => `${t.id}:${t.text}`));
console.log(log.join("\n"));
console.log(`renders: ${renders}`, JSON.stringify(store.getState()));

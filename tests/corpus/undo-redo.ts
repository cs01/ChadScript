// @category: oop
// The command pattern in a text buffer: insert/delete/replace commands that know how to undo
// themselves, an undo/redo history with a limit, and macro commands. Saves the final text.
import { writeFileSync } from "node:fs";

interface Command {
  readonly label: string;
  execute(doc: TextDoc): void;
  undo(doc: TextDoc): void;
}

class TextDoc {
  text = "";
}

class Insert implements Command {
  readonly label: string;
  constructor(
    private at: number,
    private s: string,
  ) {
    this.label = `insert "${s}" at ${at}`;
  }
  execute(doc: TextDoc): void {
    doc.text = doc.text.slice(0, this.at) + this.s + doc.text.slice(this.at);
  }
  undo(doc: TextDoc): void {
    doc.text = doc.text.slice(0, this.at) + doc.text.slice(this.at + this.s.length);
  }
}

class Delete implements Command {
  readonly label: string;
  private removed = "";
  constructor(
    private at: number,
    private length: number,
  ) {
    this.label = `delete ${length} at ${at}`;
  }
  execute(doc: TextDoc): void {
    this.removed = doc.text.slice(this.at, this.at + this.length);
    doc.text = doc.text.slice(0, this.at) + doc.text.slice(this.at + this.length);
  }
  undo(doc: TextDoc): void {
    doc.text = doc.text.slice(0, this.at) + this.removed + doc.text.slice(this.at);
  }
}

class ReplaceAll implements Command {
  readonly label: string;
  private before = "";
  constructor(
    private find: string,
    private replacement: string,
  ) {
    this.label = `replace "${find}" -> "${replacement}"`;
  }
  execute(doc: TextDoc): void {
    this.before = doc.text;
    doc.text = doc.text.split(this.find).join(this.replacement);
  }
  undo(doc: TextDoc): void {
    doc.text = this.before;
  }
}

class Macro implements Command {
  constructor(
    readonly label: string,
    private steps: Command[],
  ) {}
  execute(doc: TextDoc): void {
    for (const s of this.steps) s.execute(doc);
  }
  undo(doc: TextDoc): void {
    for (const s of [...this.steps].reverse()) s.undo(doc);
  }
}

class Editor {
  readonly doc = new TextDoc();
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  constructor(private limit: number) {}

  run(c: Command): void {
    c.execute(this.doc);
    this.undoStack.push(c);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.log(`do   ${c.label}`);
  }
  undo(): void {
    const c = this.undoStack.pop();
    if (!c) return this.log("undo (nothing to undo)");
    c.undo(this.doc);
    this.redoStack.push(c);
    this.log(`undo ${c.label}`);
  }
  redo(): void {
    const c = this.redoStack.pop();
    if (!c) return this.log("redo (nothing to redo)");
    c.execute(this.doc);
    this.undoStack.push(c);
    this.log(`redo ${c.label}`);
  }
  private log(action: string): void {
    console.log(`${action.padEnd(36)} | ${JSON.stringify(this.doc.text)}`);
  }
}

const ed = new Editor(5);
ed.run(new Insert(0, "Hello world"));
ed.run(new Insert(5, ","));
ed.run(new Insert(ed.doc.text.length, "!"));
ed.run(new ReplaceAll("o", "0"));
ed.undo();
ed.undo();
ed.redo();
ed.run(new Delete(0, 7));
ed.run(new Macro("shout", [new ReplaceAll("world", "WORLD"), new Insert(0, ">> ")]));
ed.undo();
ed.redo();
ed.redo();
for (let i = 0; i < 7; i++) ed.undo();
writeFileSync("buffer.txt", ed.doc.text);

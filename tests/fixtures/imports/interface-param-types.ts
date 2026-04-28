export interface Item {
  name: string;
  value: number;
}

export interface Container {
  items: Item[];
  label: string;
}

export type ItemKind = "alpha" | "beta";

export function processContainer(c: Container): void {
  for (const item of c.items) {
    console.log(item.name + ": " + item.value);
  }
  console.log("label: " + c.label);
}

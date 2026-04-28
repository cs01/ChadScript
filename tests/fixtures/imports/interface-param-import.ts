import type { Container, Item } from "./interface-param-types.ts";
import { processContainer } from "./interface-param-types.ts";

const items: Item[] = [
  { name: "foo", value: 10 },
  { name: "bar", value: 20 },
];

const c: Container = { items: items, label: "test" };
processContainer(c);

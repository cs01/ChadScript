interface Base {
  id: number;
  name: string;
}

interface TypeA extends Base {
  kind: string;
}

interface TypeB extends Base {
  value: number;
}

type Combined = TypeA | TypeB;

function getId(obj: Combined): number {
  return obj.id;
}

function getName(obj: Combined): string {
  return obj.name;
}

const a: TypeA = { id: 1, name: "alpha", kind: "foo" };
const b: TypeB = { id: 2, name: "beta", value: 42 };

const idA = getId(a);
const idB = getId(b);
const nameA = getName(a);
const nameB = getName(b);

if (idA === 1 && idB === 2 && nameA === "alpha" && nameB === "beta") {
  console.log("TEST_PASSED");
}

interface Item {
  name: string;
}

interface Container {
  items: Item[];
}

function getContainer(): Container {
  return {
    items: [
      { name: "one" },
      { name: "two" }
    ]
  };
}

const c = getContainer();
console.log(c.items.length);

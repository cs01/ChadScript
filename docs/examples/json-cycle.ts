// JSON.stringify of a value that contains itself throws Node's TypeError.
interface Folder {
  name: string;
  parent: Folder | null;
}

const root: Folder = { name: "root", parent: null };
root.parent = root;

try {
  console.log(JSON.stringify(root));
} catch (e) {
  if (e instanceof TypeError) {
    console.log(e.name);
    console.log(e.message);
  }
}

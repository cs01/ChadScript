interface Field {
  name: string;
  type: string;
}

const fields: Field[] = [];
fields.push({ name: "bar", type: "string" });

function findField(fieldName: string): Field | null {
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i] as { name: string; type: string };
    console.log("Comparing: '" + f.name + "' === '" + fieldName + "'");
    if (f.name === fieldName) {
      console.log("Match found!");
      return f;
    }
  }
  console.log("No match found");
  return null;
}

const result = findField("bar");
if (result !== null) {
  console.log("Found field: " + result.name);
} else {
  console.log("Field not found - BUG!");
}

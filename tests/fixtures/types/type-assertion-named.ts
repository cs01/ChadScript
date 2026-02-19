interface InterfaceField {
  name: string;
  type: string;
}

function getField(): InterfaceField {
  const f: InterfaceField = { name: "hello", type: "string" };
  return f;
}

function checkInlineAssertion(obj: InterfaceField): void {
  const inlined = obj as { name: string; type: string };
  console.log(inlined.name);
  console.log(inlined.type);
}

function checkNamedAssertion(obj: InterfaceField): void {
  const named = obj as InterfaceField;
  console.log(named.name);
  console.log(named.type);
}

const field = getField();
checkInlineAssertion(field);
checkNamedAssertion(field);

if (field.name === "hello" && field.type === "string") {
  console.log("TEST_PASSED");
}

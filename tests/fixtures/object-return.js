// Test returning object property directly
function getProperty() {
  const data = { value: 42, count: 7 };
  return data.value;
}

process.exit(getProperty());

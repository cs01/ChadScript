/**
 * Unsupported Features Detection and Error Messages
 *
 * ChadScript is an AOT compiler that compiles TypeScript to native code via LLVM.
 * Many JavaScript/TypeScript features that require V8's runtime or dynamic behavior
 * cannot be supported in a static AOT compilation model.
 *
 * This module provides:
 * 1. Detection of unsupported features in source code
 * 2. Clear, educational error messages explaining WHY features aren't supported
 * 3. Suggestions for alternatives or workarounds where applicable
 */

export interface UnsupportedFeatureError {
  feature: string;
  reason: string;
  suggestion?: string;
  examples?: { bad: string; good?: string }[];
}

/**
 * Comprehensive list of unsupported features with explanations
 */
export const UNSUPPORTED_FEATURES: Record<string, UnsupportedFeatureError> = {
  // ============================================
  // Dynamic Type Inspection
  // ============================================

  'typeof': {
    feature: "'typeof' operator",
    reason: `typeof is a dynamic runtime feature that requires V8's type system.
ChadScript compiles to native code with static types only - all type information
is resolved at compile time and doesn't exist at runtime.`,
    suggestion: `Use TypeScript type guards with explicit logic instead:

  function isString(value: any): boolean {
    // Implement your own runtime check
    return /* check logic */;
  }

Or better: use TypeScript's compile-time type system:

  function process(value: string | number) {
    if (typeof value === "string") {  // TypeScript knows the type here!
      // Use type narrowing at compile time
    }
  }`,
    examples: [
      {
        bad: `const type = typeof x;  // Runtime type inspection`,
      }
    ]
  },

  'instanceof': {
    feature: "'instanceof' operator",
    reason: `instanceof requires runtime type information and prototype chain inspection.
ChadScript uses static struct types with no runtime type metadata.`,
    suggestion: `Use TypeScript type guards or explicit field checks:

  class Animal { type: string = "animal"; }
  class Dog extends Animal { type: string = "dog"; }

  function isDog(animal: Animal): boolean {
    return animal.type === "dog";  // Check a field instead
  }`,
    examples: [
      {
        bad: `if (obj instanceof MyClass) { }`,
      }
    ]
  },

  'Object.keys': {
    feature: "'Object.keys()' method",
    reason: `Object.keys() requires runtime object introspection.
ChadScript objects are compiled to static structs with fixed fields - there's
no runtime metadata to enumerate properties.`,
    suggestion: `Define your own array of keys at compile time:

  interface Person { name: string; age: number; }
  const PERSON_KEYS = ["name", "age"];  // Define manually

  // Or use a class with an explicit method:
  class Person {
    keys(): string[] {
      return ["name", "age"];
    }
  }`,
    examples: [
      {
        bad: `const keys = Object.keys(obj);  // Runtime enumeration`,
      }
    ]
  },

  'Object.values': {
    feature: "'Object.values()' method",
    reason: `Object.values() requires runtime object introspection.
ChadScript structs have no runtime metadata for property enumeration.`,
    suggestion: `Manually collect values into an array:

  const person = { name: "Alice", age: 30 };
  const values = [person.name, person.age];  // Explicit list`,
    examples: [
      {
        bad: `const values = Object.values(obj);`,
      }
    ]
  },

  'Object.entries': {
    feature: "'Object.entries()' method",
    reason: `Object.entries() requires runtime reflection.
Static compilation means no runtime property enumeration.`,
    suggestion: `Build entries array manually:

  const person = { name: "Alice", age: 30 };
  const entries = [["name", person.name], ["age", person.age]];`,
    examples: [
      {
        bad: `const entries = Object.entries(obj);`,
      }
    ]
  },

  // ============================================
  // Async/Concurrency Features
  // ============================================

  'async': {
    feature: "'async' keyword",
    reason: `async/await syntax is not yet fully implemented.
ChadScript has Promise support, but the async/await syntax parser is still in development.`,
    suggestion: `Use Promise-based APIs directly:

  // ❌ Async syntax (coming soon)
  async function fetchData() {
    const response = await fetch(url);
    return response;
  }

  // ✅ Promise-based (supported)
  function fetchData(): void {
    Promise.resolve(fetch(url))
      .then(onSuccess)
      .catch(onError);
  }

Note: Promise.resolve(), Promise.reject(), .then(), .catch() are supported.`,
    examples: [
      {
        bad: `async function getData() { }`,
      }
    ]
  },

  'await': {
    feature: "'await' keyword",
    reason: `await syntax is not yet fully implemented.
Use Promise.then() for handling async results.`,
    suggestion: `Remove await and use .then() chaining:

  // ❌ Await syntax (coming soon)
  const data = await fetch(url);

  // ✅ Promise chaining (supported)
  fetch(url).then(handleData);`,
    examples: [
      {
        bad: `const result = await promise;`,
      }
    ]
  },

  // ============================================
  // Dynamic Code Features
  // ============================================

  'eval': {
    feature: "'eval()' function",
    reason: `eval() executes code strings at runtime.
ChadScript is AOT compiled - there's no runtime interpreter or compiler.
All code must be known at compile time.`,
    suggestion: `Restructure to use static functions:

  // ❌ Dynamic
  eval("console.log('hello')");

  // ✅ Static
  console.log("hello");  // Known at compile time`,
    examples: [
      {
        bad: `eval("x + y");`,
      }
    ]
  },

  // ============================================
  // Modern Syntax Features
  // ============================================

  'destructuring': {
    feature: 'Destructuring assignment',
    reason: `Destructuring is syntactic sugar that requires complex runtime support.
ChadScript uses simple struct field access only.`,
    suggestion: `Use explicit property access:

  // ❌ Destructuring
  const { x, y } = point;
  const [first, second] = array;

  // ✅ Explicit access
  const x = point.x;
  const y = point.y;
  const first = array[0];
  const second = array[1];`,
    examples: [
      {
        bad: `const { name, age } = person;`,
        good: `const name = person.name;\nconst age = person.age;`
      },
      {
        bad: `const [a, b] = [1, 2];`,
        good: `const arr = [1, 2];\nconst a = arr[0];\nconst b = arr[1];`
      }
    ]
  },

  'spread': {
    feature: 'Spread operator (...)',
    reason: `Spread requires runtime array/object iteration and copying.
This adds complexity and runtime overhead.`,
    suggestion: `Use explicit operations:

  // ❌ Spread
  const combined = [...arr1, ...arr2];
  const copy = { ...obj };

  // ✅ Explicit (use concat for arrays)
  const combined = arr1.concat(arr2);

  // For objects, manually copy fields:
  const copy = { name: obj.name, age: obj.age };`,
    examples: [
      {
        bad: `const copy = [...array];`,
        good: `const copy = array.slice(0, array.length);`
      }
    ]
  },

  'optional-chaining': {
    feature: 'Optional chaining (?.)',
    reason: `Optional chaining requires runtime null checks and short-circuit evaluation.
ChadScript uses simple pointer dereference with no safety checks (for performance).`,
    suggestion: `Use explicit null checks:

  // ❌ Optional chaining
  const name = user?.profile?.name;

  // ✅ Explicit checks
  let name = "";
  if (user) {
    if (user.profile) {
      name = user.profile.name;
    }
  }`,
    examples: [
      {
        bad: `const value = obj?.prop?.nested;`,
      }
    ]
  },

  'nullish-coalescing': {
    feature: 'Nullish coalescing (??)',
    reason: `Nullish coalescing requires distinguishing null/undefined from other falsy values.
ChadScript treats all falsy values the same (like C).`,
    suggestion: `Use ternary operator with explicit checks:

  // ❌ Nullish coalescing
  const value = config.timeout ?? 1000;

  // ✅ Ternary with explicit check
  const value = config.timeout !== 0 ? config.timeout : 1000;`,
    examples: [
      {
        bad: `const x = value ?? defaultValue;`,
        good: `const x = value !== 0 ? value : defaultValue;`
      }
    ]
  },

  // ============================================
  // Iteration Features
  // ============================================

  'for-in': {
    feature: "'for...in' loop",
    reason: `for...in iterates over object properties, requiring runtime enumeration.
Static structs have no property metadata at runtime.`,
    suggestion: `Use standard for loop with explicit field access:

  // ❌ for...in
  for (const key in obj) {
    console.log(obj[key]);
  }

  // ✅ Explicit iteration
  console.log(obj.field1);
  console.log(obj.field2);

  // Or use arrays with for loop:
  for (let i = 0; i < array.length; i++) {
    console.log(array[i]);
  }`,
    examples: [
      {
        bad: `for (const key in object) { }`,
      }
    ]
  },

  'for-of': {
    feature: "'for...of' loop (iterator protocol)",
    reason: `for...of requires the iterator protocol (Symbol.iterator) and generators.
ChadScript has no symbol support or runtime protocols.`,
    suggestion: `Use standard for loop:

  // ❌ for...of
  for (const item of array) {
    console.log(item);
  }

  // ✅ Standard for loop
  for (let i = 0; i < array.length; i++) {
    console.log(array[i]);
  }

  // Or forEach:
  array.forEach(item => console.log(item));`,
    examples: [
      {
        bad: `for (const item of items) { }`,
        good: `for (let i = 0; i < items.length; i++) {\n  const item = items[i];\n}`
      }
    ]
  },
};

/**
 * Format a nice error message for an unsupported feature
 */
export function formatUnsupportedFeatureError(
  feature: keyof typeof UNSUPPORTED_FEATURES,
  sourceContext?: string
): string {
  const info = UNSUPPORTED_FEATURES[feature];
  if (!info) {
    return `Unsupported feature: ${feature}`;
  }

  let message = `\x1b[31m\x1b[1merror:\x1b[0m ${info.feature} is not supported in ChadScript\n\n`;

  // Why it's not supported
  message += `\x1b[33mWhy this doesn't work:\x1b[0m\n`;
  message += info.reason.split('\n').map(line => `  ${line}`).join('\n') + '\n\n';

  // Suggestion for alternative
  if (info.suggestion) {
    message += `\x1b[36m\x1b[1mℹ suggestion:\x1b[0m\n`;
    message += info.suggestion.split('\n').map(line => `  ${line}`).join('\n') + '\n';
  }

  // Examples if provided
  if (info.examples && info.examples.length > 0) {
    message += '\n';
    for (const example of info.examples) {
      if (example.bad) {
        message += `  \x1b[31m❌ ${example.bad}\x1b[0m\n`;
      }
      if (example.good) {
        message += `  \x1b[32m✅ ${example.good}\x1b[0m\n`;
      }
    }
  }

  message += '\n\x1b[33mLearn more:\x1b[0m https://github.com/yourusername/chadscript#limitations\n';

  return message;
}

/**
 * Check if a feature keyword is unsupported
 */
export function isUnsupportedKeyword(keyword: string): boolean {
  const unsupportedKeywords = [
    'async', 'await', 'typeof', 'instanceof', 'eval',
  ];
  return unsupportedKeywords.includes(keyword);
}

/**
 * Check if an identifier refers to an unsupported API
 */
export function isUnsupportedAPI(name: string): boolean {
  const unsupportedAPIs = [
    'Object.keys', 'Object.values', 'Object.entries',
  ];
  return unsupportedAPIs.some(api => name.includes(api));
}

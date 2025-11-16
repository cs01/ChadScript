/**
 * ChadScript Built-in Global Types
 *
 * This file provides TypeScript type definitions for ChadScript's built-in
 * runtime APIs. These globals are available without imports in all ChadScript
 * programs and are compiled directly to native code via LLVM.
 *
 * Note: Standard JavaScript types (String, Number, Array, etc.) are provided
 * by TypeScript's ES2020 lib. This file only defines ChadScript-specific APIs.
 */

/**
 * Filesystem operations using POSIX file I/O
 */
declare namespace fs {
  /**
   * Synchronously reads the entire contents of a file as a string.
   * @param filename Path to the file to read
   * @returns The file contents as a string, or empty string if file doesn't exist
   */
  function readFileSync(filename: string): string;

  /**
   * Synchronously writes data to a file, replacing the file if it already exists.
   * @param filename Path to the file to write
   * @param data The string data to write
   * @returns 0 on success, -1 on error
   */
  function writeFileSync(filename: string, data: string): number;

  /**
   * Checks if a file exists.
   * @param filename Path to the file to check
   * @returns true if the file exists, false otherwise
   */
  function existsSync(filename: string): boolean;

  /**
   * Deletes a file from the filesystem.
   * @param filename Path to the file to delete
   * @returns 0 on success, -1 on error
   */
  function unlinkSync(filename: string): number;
}

/**
 * Console output operations
 */
declare namespace console {
  /**
   * Prints values to stdout with a newline.
   * @param args Values to print (currently only first argument is used)
   */
  function log(...args: any[]): void;

  /**
   * Prints values to stderr with a newline.
   * @param args Values to print (currently only first argument is used)
   */
  function error(...args: any[]): void;
}

/**
 * Process utilities and command-line arguments
 */
declare namespace process {
  /**
   * Exits the program with the specified exit code.
   * @param code Exit code (defaults to 0)
   */
  function exit(code?: number): never;

  /**
   * Array of command-line arguments passed to the program.
   * argv[0] is the program name, argv[1] is the first argument, etc.
   */
  const argv: string[];
}

/**
 * Mathematical operations using LLVM intrinsics
 */
declare namespace Math {
  /**
   * Returns the square root of a number.
   * @param x A numeric expression
   */
  function sqrt(x: number): number;

  /**
   * Returns the value of a base expression raised to a specified power.
   * @param base The base value
   * @param exp The exponent value
   */
  function pow(base: number, exp: number): number;

  /**
   * Returns the greatest integer less than or equal to its numeric argument.
   * @param x A numeric expression
   */
  function floor(x: number): number;

  /**
   * Returns the smallest integer greater than or equal to its numeric argument.
   * @param x A numeric expression
   */
  function ceil(x: number): number;

  /**
   * Returns a supplied numeric expression rounded to the nearest integer.
   * @param x A numeric expression
   */
  function round(x: number): number;

  /**
   * Returns the absolute value of a number.
   * @param x A numeric expression
   */
  function abs(x: number): number;
}

/**
 * JSON parsing and stringification
 */
declare namespace JSON {
  /**
   * Parses a JSON string and returns the resulting value.
   * @param str A valid JSON string
   * @returns The parsed value, or null if parsing fails
   */
  function parse(str: string): any;

  /**
   * Converts a value to a JSON string.
   * @param value The value to convert (currently supports strings and numbers)
   * @returns A JSON string representation of the value
   */
  function stringify(value: any): string;
}

/**
 * Path utilities using POSIX functions
 */
declare namespace path {
  /**
   * Resolves a path to an absolute path.
   * @param path The path to resolve
   * @returns The resolved absolute path, or the original path if resolution fails
   */
  function resolve(path: string): string;

  /**
   * Returns the directory name of a path.
   * @param path The path to process
   * @returns The directory portion of the path
   */
  function dirname(path: string): string;
}

// ============================================================================
// HTTP & Network Utilities
// ============================================================================

/**
 * Response object returned by fetch()
 * Contains parsed HTTP response data
 */
interface Response {
  /**
   * Get the response body as a string
   * @returns The HTTP response body
   */
  text(): string;

  /**
   * Parse the response body as JSON
   * @returns Parsed JSON value typed according to the generic parameter
   */
  json<T>(): T;

  /**
   * HTTP status code (200, 404, 500, etc.)
   */
  status: number;

  /**
   * True if status code indicates success (200-299)
   */
  ok: boolean;
}

/**
 * Performs an HTTP GET request using libcurl.
 * @param url The URL to fetch (must include protocol, e.g., "http://example.com")
 * @returns A Response object containing status, headers, and body
 */
declare function fetch(url: string): Response;

// ============================================================================
// Low-Level System Calls
// ============================================================================
// These functions provide direct access to POSIX system calls for advanced
// use cases like networking and manual memory management.

/**
 * Allocates memory on the heap.
 * @param size Number of bytes to allocate
 * @returns Pointer to the allocated memory as a number
 */
declare function malloc(size: number): number;

/**
 * Frees memory allocated by malloc. Use with caution.
 * @param ptr Memory pointer as a number
 */
declare function free(ptr: number): void;

/**
 * Parses a string into an integer with optional radix.
 * @param str The string to parse
 * @param radix Optional radix (base) for parsing (2-36)
 * @returns The parsed integer value
 */
declare function parseInt(str: string, radix?: number): number;

// ============================================================================
// Socket & Network Functions
// ============================================================================

/**
 * Creates a socket endpoint for communication.
 * @param domain Communication domain (e.g., AF_INET = 2)
 * @param type Socket type (e.g., SOCK_STREAM = 1)
 * @param protocol Protocol to use (usually 0 for default)
 * @returns Socket file descriptor, or -1 on error
 */
declare function socket(domain: number, type: number, protocol: number): number;

/**
 * Binds a socket to an address.
 * @param socket Socket file descriptor
 * @param addr Pointer to sockaddr structure
 * @param addrlen Size of the address structure
 * @returns 0 on success, -1 on error
 */
declare function bind(socket: number, addr: number, addrlen: number): number;

/**
 * Marks a socket as passive, ready to accept connections.
 * @param socket Socket file descriptor
 * @param backlog Maximum length of the pending connections queue
 * @returns 0 on success, -1 on error
 */
declare function listen(socket: number, backlog: number): number;

/**
 * Accepts a connection on a socket.
 * @param socket Socket file descriptor
 * @param addr Pointer to sockaddr structure to store client address
 * @param addrlen Pointer to size of address structure
 * @returns New socket file descriptor for the connection, or -1 on error
 */
declare function accept(socket: number, addr: number, addrlen: number): number;

/**
 * Converts a 16-bit number from host byte order to network byte order.
 * @param hostshort 16-bit value in host byte order
 * @returns Value in network byte order (big-endian)
 */
declare function htons(hostshort: number): number;

// ============================================================================
// Low-Level I/O Functions
// ============================================================================

/**
 * Closes a file descriptor.
 * @param fd File descriptor to close
 * @returns 0 on success, -1 on error
 */
declare function close(fd: number): number;

/**
 * Reads data from a file descriptor into a buffer.
 * @param fd File descriptor to read from
 * @param buf Pointer to buffer to store data
 * @param count Maximum number of bytes to read
 * @returns Number of bytes read, 0 on EOF, or -1 on error
 */
declare function read(fd: number, buf: number, count: number): number;

/**
 * Writes data from a buffer to a file descriptor.
 * @param fd File descriptor to write to
 * @param buf Pointer to buffer containing data
 * @param count Number of bytes to write
 * @returns Number of bytes written, or -1 on error
 */
declare function write(fd: number, buf: number, count: number): number;

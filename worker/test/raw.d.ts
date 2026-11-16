// Vite gives the text of a file for an import that ends with `?raw`. Tests use it to read source code.
declare module "*?raw" {
  const text: string;
  export default text;
}

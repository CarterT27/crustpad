declare module "monaco-editor/esm/vs/editor/editor.api" {
  export * from "monaco-editor";
}

declare module "*.css";

declare module "*?raw" {
  const source: string;
  export default source;
}

declare namespace JSX {
  type Element = import("react").ReactElement;
}

declare module "monaco-editor/esm/vs/editor/editor.api" {
  export * from "monaco-editor";
}

declare module "*.css";

declare module "*?raw" {
  const source: string;
  export default source;
}

declare module "*?url" {
  const url: string;
  export default url;
}

declare module "*?worker" {
  const workerConstructor: {
    new (): Worker;
  };
  export default workerConstructor;
}

declare module "picoc-web" {
  export function RunDefault(sourceCode: string): Promise<{
    stdout: string;
    stderr: string;
  }>;
}

declare module "@eduoj/wasm-clang" {
  export class API {
    constructor(options: {
      cdnUrl?: string;
      hostWrite?: (text: string) => void;
      readBuffer?: (url: string) => Promise<ArrayBuffer>;
      compileStreaming?: (url: string) => Promise<WebAssembly.Module>;
    });
  }
}

declare namespace JSX {
  type Element = import("react").ReactElement;
}

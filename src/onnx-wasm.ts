import wasmModuleUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url";
import wasmBinaryUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url";

export const wasmPaths = {
  mjs: new URL(wasmModuleUrl, import.meta.url).href,
  wasm: new URL(wasmBinaryUrl, import.meta.url).href,
};

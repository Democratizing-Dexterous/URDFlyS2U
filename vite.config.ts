import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import Icons from "unplugin-icons/vite";

const wasmAsUrl = (): Plugin => ({
  name: "wasm-as-url",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (!source.endsWith(".wasm")) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    if (!resolved || resolved.id.includes("?")) return resolved;
    return `${resolved.id}?url`;
  },
});

const OCCT_NODE_BUILTINS = new Set([
  "path",
  "fs",
  "crypto",
  "url",
  "module",
  "node:path",
  "node:fs",
  "node:crypto",
  "node:url",
  "node:module",
]);
const OCCT_EMPTY_ID = "\0occt-node-builtin-stub";

const stubOcctNodeBuiltins = (): Plugin => ({
  name: "stub-occt-node-builtins",
  enforce: "pre",
  resolveId(source, importer) {
    if (source === OCCT_EMPTY_ID) return OCCT_EMPTY_ID;
    if (!importer || !OCCT_NODE_BUILTINS.has(source)) return null;
    if (!importer.includes("occt-wasm")) return null;
    return OCCT_EMPTY_ID;
  },
  load(id) {
    if (id !== OCCT_EMPTY_ID) return null;
    return "export default {};";
  },
});

const stripOcctSourcemaps = (): Plugin => ({
  name: "strip-occt-sourcemaps",
  enforce: "pre",
  load(id) {
    const file = id.split("?")[0];
    if (!file.includes("occt-wasm") || !file.endsWith(".js")) return null;
    if (!existsSync(file)) return null;
    const code = readFileSync(file, "utf-8");
    if (!code.includes("sourceMappingURL")) return null;
    return {
      code: code.replace(/^[^\S\r\n]*\/\/# sourceMappingURL=.*$/gm, ""),
      map: null,
    };
  },
});

export default defineConfig({
  plugins: [
    wasmAsUrl(),
    stubOcctNodeBuiltins(),
    stripOcctSourcemaps(),
    vue(),
    Icons({ compiler: "vue3", scale: 1 }),
  ],
  assetsInclude: ["**/*.wasm"],
  optimizeDeps: {
    exclude: ["occt-wasm"],
    include: ["gl-matrix", "comlink", "fflate"],
  },
  worker: {
    format: "es",
    plugins: () => [wasmAsUrl(), stubOcctNodeBuiltins(), stripOcctSourcemaps()],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5678,
    open: true,
    forwardConsole: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        chunkFileNames: "assets/js/[name]-[hash].js",
        entryFileNames: "assets/js/[name]-[hash].js",
        assetFileNames: "assets/[ext]/[name]-[hash].[ext]",
      },
    },
  },
});

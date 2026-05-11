import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  outDir: "dist",
  clean: true,
  external: ["@kilocode/plugin", "@vectorize-io/hindsight-client"],
  treeshake: true,
  minify: false,
  dts: true,
});
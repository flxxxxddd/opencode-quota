import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["tests/network.test.ts", "tests/preferences.test.ts", "tests/click.test.ts"],
  format: ["esm"],
  target: "node18",
  outDir: ".test-dist",
  clean: true,
  removeNodeProtocol: false,
})

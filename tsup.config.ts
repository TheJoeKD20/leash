import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  splitting: false,
  // tsup preserves the `#!/usr/bin/env node` shebang in src/cli.ts so the
  // built `dist/cli.js` is directly executable as the `leash` bin.
});

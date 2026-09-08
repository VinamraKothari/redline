import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "public/bridge.js"]),
  {
    rules: {
      // Reading browser-only state (localStorage, the iframe DOM) after mount is
      // a legitimate effect; keep the compiler hint as a warning, not a build error.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;

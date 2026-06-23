import js from "@eslint/js";
import globals from "globals";

// Configuração base e propositalmente leve. O alvo do `npm run lint` é o código
// Node de back-end e build (scripts, lib, api, tests); o front-end em assets/js
// pode ser incluído depois, de forma incremental, para não afogar em ruído.
export default [
  {
    ignores: [
      "node_modules/**",
      ".vercel/**",
      "eventos-data.json",
      "assets/docs/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["scripts/**/*.{js,mjs}", "lib/**/*.{js,mjs}", "api/**/*.js", "tests/**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
];

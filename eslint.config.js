// Formatting is enforced by Prettier (`npm run format-check`), so only non-stylistic rules are configured here.

const js = require("@eslint/js");
const globals = require("globals");
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
    js.configs.recommended,
    tseslint.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: globals.node,
        },
        rules: {
            "no-var": "error",
            "no-warning-comments": "error",
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
            "@typescript-eslint/no-empty-object-type": [
                "error",
                { allowInterfaces: "with-single-extends" },
            ],
        },
    },
    {
        // chai property assertions, e.g. `expect(x).to.be.true`, are expressions by design
        files: ["test/**/*.ts"],
        rules: {
            "@typescript-eslint/no-unused-expressions": "off",
        },
    },
);

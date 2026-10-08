import tsEslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'

export default [
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
    }
  },
  {
    rules: {
      "no-unused-vars": "warn",
      "no-empty-pattern": "error",
      "no-implicit-coercion": "error",
      "no-return-await": "error"
    }
  }
]

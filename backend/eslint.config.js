import js from '@eslint/js';
import globals from 'globals';
import unusedImports from 'eslint-plugin-unused-imports';

// ESLint 9 flat config for the JAMIE Node/Express backend (ESM).
// Same philosophy as the frontend: unused imports are errors (keep the tree
// lean), unused vars are warnings, empty catch is an allowed fire-and-forget
// pattern. Node globals everywhere; Vitest globals added in tests/.
export default [
  {
    ignores: [
      'node_modules/**', 'public/**', 'uploads/**', 'coverage/**',
      'eslint.config.js', 'vitest.config.js',
    ],
  },

  js.configs.recommended,

  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: { 'unused-imports': unusedImports },
    rules: {
      'no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['warn', {
        vars: 'all', varsIgnorePattern: '^_',
        args: 'after-used', argsIgnorePattern: '^_',
        caughtErrors: 'all', caughtErrorsIgnorePattern: '^_',
      }],
      // Best-effort cleanup / fire-and-forget catches are intentional here.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Vitest tests (config has globals: true; the files also import from 'vitest')
  {
    files: ['tests/**', '**/*.{test,spec}.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: 'readonly', it: 'readonly', test: 'readonly', expect: 'readonly',
        vi: 'readonly', beforeEach: 'readonly', afterEach: 'readonly',
        beforeAll: 'readonly', afterAll: 'readonly',
      },
    },
  },
];

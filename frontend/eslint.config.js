import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import unusedImports from 'eslint-plugin-unused-imports';

// ESLint 9 flat config for the JAMIE React/Vite app.
// Philosophy: real problems are errors (unused imports, hook misuse, missing
// keys); style/cosmetics are off or warnings so `npm run lint` stays signal,
// not noise. unused-imports is the dead-code guard that keeps the tree lean.
export default [
  {
    ignores: [
      'dist/**', 'dev-dist/**', 'node_modules/**',
      'android/**', 'ios/**', 'public/**',
      'eslint.config.js', 'vite.config.js', 'vitest.setup.js', 'pwa-assets.config.js',
      // Underscore-prefixed root scripts are one-off Node dev tools (i18n
      // audits), not shipped app code — keep them out of the app lint.
      '**/_*.mjs', '**/_*.js',
    ],
  },

  js.configs.recommended,

  // ── App source (browser) ──────────────────────────────────────────────
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    settings: { react: { version: 'detect' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'unused-imports': unusedImports,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,

      // Real bugs → error
      'react-hooks/rules-of-hooks': 'error',
      'react/jsx-key': 'error',

      // Dead-code guard: unused imports are errors (keep the tree lean),
      // unused vars are warnings (and `_`-prefixed ones are intentional).
      'no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['warn', {
        vars: 'all', varsIgnorePattern: '^_',
        args: 'after-used', argsIgnorePattern: '^_',
        caughtErrors: 'all', caughtErrorsIgnorePattern: '^_',
      }],

      // Empty catch blocks are an intentional fire-and-forget pattern here
      // (analytics, cache busting, best-effort cleanup) — allow them; flag
      // any OTHER empty block.
      'no-empty': ['error', { allowEmptyCatch: true }],

      // Helpful but noisy → warn
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // Off: not how this project is written (no PropTypes, new JSX transform,
      // German UI copy with apostrophes/quotes in JSX text).
      'react/prop-types': 'off',
      'react/display-name': 'off',
      'react/no-unescaped-entities': 'off',
    },
  },

  // ── Service worker (self, caches, clients, …) ─────────────────────────
  {
    files: ['**/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.worker } },
  },

  // ── Vitest tests (config has globals: true) ───────────────────────────
  {
    files: ['**/*.{test,spec}.{js,jsx}', '**/__tests__/**'],
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

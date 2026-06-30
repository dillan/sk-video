// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      // Set the rules explicitly rather than spreading a preset whose shape varies across plugin
      // majors — keeps this config stable when eslint-plugin-react-hooks bumps.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // The vite config is a Node module, not browser code.
  {
    files: ['vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  // The service worker runs in the ServiceWorkerGlobalScope (self, caches, clients, …).
  {
    files: ['public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.browser } },
  },
);

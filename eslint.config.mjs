// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // The web app is its own project with its own eslint config (browser/React globals); the plugin's
  // root lint stays focused on the Node plugin. public/ is the built bundle.
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'webapp/**', 'public/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);

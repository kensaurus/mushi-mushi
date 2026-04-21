import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import noEmptyOnClick from './rules/no-empty-onclick.js';

// Local plugin that exposes -era custom rules (currently just one) so
// every workspace inherits them without needing a published npm package.
const mushiPlugin = {
  rules: {
    'no-empty-onclick': noEmptyOnClick,
  },
};

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.*'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      mushi: mushiPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'mushi/no-empty-onclick': 'error',
    },
  },
];

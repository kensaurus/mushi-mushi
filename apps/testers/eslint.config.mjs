import baseConfig from '@mushi-mushi/eslint-config';
import mushiPlugin from 'eslint-plugin-mushi-mushi';

export default [
  { ignores: ['.next/**', 'node_modules/**'] },
  ...baseConfig,
  // The monorepo's own preset: recommended plus the design-system rules.
  mushiPlugin.configs.internal,
  {
    rules: {
      'no-console': 'off',
    },
  },
];

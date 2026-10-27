import baseConfig from '@mushi-mushi/eslint-config';
import mushiPlugin from 'eslint-plugin-mushi-mushi';

export default [
  ...baseConfig,
  // The monorepo's own preset: recommended plus the design-system rules.
  mushiPlugin.configs.internal,
  {
    files: ['src/**/*.tsx'],
    rules: {
      'mushi-mushi/no-raw-palette-color': 'warn',
      'mushi-mushi/no-text-3xs-on-interactive': 'warn',
    },
  },
];

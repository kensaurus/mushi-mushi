import baseConfig from '@mushi-mushi/eslint-config';
import mushiPlugin from 'eslint-plugin-mushi-mushi';

export default [
  ...baseConfig,
  mushiPlugin.configs.recommended,
  {
    rules: {
      'no-console': 'off',
      'mushi-mushi/no-raw-palette-color': 'error',
    },
  },
];

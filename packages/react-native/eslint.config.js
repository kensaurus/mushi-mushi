import baseConfig from '@mushi-mushi/eslint-config';
import mushiPlugin from 'eslint-plugin-mushi-mushi';

export default [
  ...baseConfig,
  mushiPlugin.configs.recommended,
  {
    files: ['src/**/*.tsx'],
    rules: {
      'mushi-mushi/no-raw-hex-in-widget': 'error',
    },
  },
];

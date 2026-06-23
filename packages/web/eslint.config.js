import baseConfig from '@mushi-mushi/eslint-config';
import mushiPlugin from 'eslint-plugin-mushi-mushi';

export default [
  ...baseConfig,
  mushiPlugin.configs.recommended,
  {
    files: ['src/styles.ts', 'src/build-widget-theme.ts'],
    rules: {
      'mushi-mushi/no-raw-hex-in-widget': 'error',
    },
  },
];

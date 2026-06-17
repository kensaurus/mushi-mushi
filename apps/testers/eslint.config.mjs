import baseConfig from '@mushi-mushi/eslint-config';
import mushiPlugin from 'eslint-plugin-mushi-mushi';

export default [
  { ignores: ['.next/**', 'node_modules/**'] },
  ...baseConfig,
  mushiPlugin.configs.recommended,
  {
    rules: {
      'no-console': 'off',
    },
  },
];

import baseConfig from '@mushi-mushi/eslint-config';

export default [
  { ignores: ['.next/**', 'node_modules/**'] },
  ...baseConfig,
  {
    rules: {
      'no-console': 'off',
    },
  },
];

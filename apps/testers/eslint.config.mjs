import baseConfig from '@mushi-mushi/eslint-config';

export default [
  ...baseConfig,
  {
    rules: {
      'no-console': 'off',
    },
  },
];

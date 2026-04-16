import baseConfig from '@mushi/eslint-config';

export default [
  ...baseConfig,
  {
    rules: {
      'no-console': 'off',
    },
  },
];

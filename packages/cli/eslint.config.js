import baseConfig from '@mushi-mushi/eslint-config';

// CLIs print to stdout/stderr — that's their entire user interface. The
// shared base disallows `console.log`; for this package we override that
// to allow stdout output in `src/**/*.ts`.
export default [
  ...baseConfig,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];

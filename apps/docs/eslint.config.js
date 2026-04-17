import baseConfig from '@mushi-mushi/eslint-config';

export default [
  ...baseConfig,
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'playground/**'],
  },
];

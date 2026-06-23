import baseConfig from '@mushi-mushi/eslint-config';
import mushiPlugin from 'eslint-plugin-mushi-mushi';

export default [
  ...baseConfig,
  mushiPlugin.configs.recommended,
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'playground/**', 'out/**'],
  },
  {
    files: ['components/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
    rules: {
      'mushi-mushi/no-raw-palette-color': 'error',
    },
  },
];

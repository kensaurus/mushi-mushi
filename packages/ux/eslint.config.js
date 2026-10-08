import baseConfig from '@mushi-mushi/eslint-config'

// mushi-ux is a CLI: stdout is its interface. Same override as @mushi-mushi/cli.
export default [
  ...baseConfig,
  {
    files: ['src/cli.ts'],
    rules: {
      'no-console': 'off',
    },
  },
]

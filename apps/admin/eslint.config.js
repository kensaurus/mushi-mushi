import baseConfig from '@mushi-mushi/eslint-config';
import mushiPlugin from 'eslint-plugin-mushi-mushi';

export default [
  ...baseConfig,
  mushiPlugin.configs.recommended,
  {
    rules: {
      'no-console': 'off',
      'mushi-mushi/no-raw-palette-color': 'error',
      'mushi-mushi/no-text-3xs-on-interactive': 'error',
      'mushi-mushi/no-raw-semantic-on-muted': 'error',
      'mushi-mushi/no-hand-rolled-tablist': [
        'error',
        { pageFilesOnly: true, pagePattern: 'Page\\.tsx$' },
      ],
      'mushi-mushi/no-raw-css-var-text': 'error',
      'mushi-mushi/no-legacy-shadcn-tokens': 'error',
      'mushi-mushi/no-accent-for-selection': 'warn',
      // Scaffold anti-drift (Start-here cluster first; warn → error after clean).
      'mushi-mushi/no-legacy-page-header-in-pages': 'error',
      'mushi-mushi/no-page-root-padding': 'error',
      'mushi-mushi/no-arbitrary-length-value': 'error',
      'mushi-mushi/prefer-card-primitive': 'error',
      'mushi-mushi/no-card-elevated-outside-allowlist': [
        'warn',
        {
          pagePattern: 'Page\\.tsx$',
          allowlist: [
            'PageHero.tsx',
            'QuickstartMegaCta.tsx',
            'OnboardingModeIntroCard.tsx',
            'BetaBanner.tsx',
            '/illustrations/',
            '/onboarding/',
            '/report-detail/',
            '/tester/',
            'Tester',
            'PublicHomePage.tsx',
            'SetupGatePage.tsx',
            'LoginPage.tsx',
            'CliAuthPage.tsx',
            'ReportDetailPage.tsx',
          ],
        },
      ],
      // Brand marks (Slack #4A154B, Discord #5865F2, Teams #6264A7) require exact hex in SVG paths.
      // mushi-mushi-allowlist: third-party brand icon fill
      'mushi-mushi/no-missing-page-posture': [
        'warn',
        {
          pagePattern: 'Page\\.tsx$',
          skipBasenames: [
            'AcceptInvitePage.tsx',
            'CliAuthPage.tsx',
            'ContentQualityDetailPage.tsx',
            'DocsBridgePage.tsx',
            'IntegrationsRouteGate.tsx',
            'LoginPage.tsx',
            'PublicHomePage.tsx',
            'PublicIntegrationsPage.tsx',
            'ReportDetailPage.tsx',
            'ResetPasswordPage.tsx',
            'SetupGatePage.tsx',
            'TesterSubmissionsReviewPage.tsx',
            'TesterAppsPage.tsx',
            'TesterHomePage.tsx',
            'TesterLearnPage.tsx',
            'TesterSettingsPage.tsx',
            'TesterSubmissionsPage.tsx',
            'TesterWalletPage.tsx',
          ],
        },
      ],
    },
  },
  {
    files: ['src/components/connect/**/*.tsx', 'src/components/sdk-install/**/*.tsx', 'src/components/hero-flow/**/*.tsx', 'src/components/projects/**/*.tsx'],
    rules: {
      'mushi-mushi/no-hand-rolled-tablist': ['error', { pageFilesOnly: false }],
      'mushi-mushi/no-raw-css-var-text': 'error',
    },
  },
];

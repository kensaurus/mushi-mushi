import baseConfig from '@mushi-mushi/eslint-config';
import mushiPlugin from 'eslint-plugin-mushi-mushi';

export default [
  ...baseConfig,
  mushiPlugin.configs.recommended,
  {
    rules: {
      'no-console': 'off',
      'mushi-mushi/no-raw-palette-color': 'error',
      'mushi-mushi/no-hand-rolled-tablist': [
        'warn',
        { pageFilesOnly: true, pagePattern: 'Page\\.tsx$' },
      ],
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
];

/**
 * Sidebar order for the Migration Hub. Grouped by category in the same
 * order as `apps/docs/content/migrations/_catalog.ts` so the catalog,
 * sidebar, and hub grid all read top-to-bottom in sync. When you add a
 * guide, update the catalog AND this file.
 */
export default {
  index: 'Overview',

  // Mobile / hybrid
  'capacitor-to-react-native': 'Capacitor → React Native',
  'cordova-to-capacitor': 'Cordova → Capacitor',
  'cordova-to-react-native': 'Cordova → React Native',
  'react-native-cli-to-expo': 'React Native CLI ↔ Expo',
  'native-to-hybrid': 'Native iOS / Android → Hybrid',

  // Web framework
  'cra-to-vite': 'Create React App → Vite',
  'nextjs-pages-to-app-router': 'Next.js Pages → App Router',
  'vue-2-to-vue-3': 'Vue 2 → Vue 3',
  'spa-to-ssr': 'SPA → SSR',

  // Switch to Mushi Mushi
  'sentry-to-mushi': 'Sentry + Mushi Mushi (enrich or standalone)',
  'instabug-to-mushi': 'Instabug (Luciq) → Mushi Mushi',
  'shake-to-mushi': 'Shake → Mushi Mushi',
  'logrocket-feedback-to-mushi': 'LogRocket Feedback → Mushi Mushi',
  'bugherd-to-mushi': 'BugHerd → Mushi Mushi',
  'pendo-feedback-to-mushi': 'Pendo Feedback → Mushi Mushi',

  // Mushi Mushi SDK upgrade rail
  'mushi-sdk-upgrade': 'Mushi Mushi SDK upgrades (0.x → 1.x)',
}

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

  // Switch to Mushi
  'instabug-to-mushi': 'Instabug (Luciq) → Mushi',
  'shake-to-mushi': 'Shake → Mushi',
  'logrocket-feedback-to-mushi': 'LogRocket Feedback → Mushi',
  'bugherd-to-mushi': 'BugHerd → Mushi',
  'pendo-feedback-to-mushi': 'Pendo Feedback → Mushi',

  // Mushi SDK upgrade rail
  'mushi-sdk-upgrade': '@mushi-mushi/* 0.x → 1.0',
}

import { createApp } from 'vue'
import { MushiPlugin } from '@mushi-mushi/vue'
import App from './App.vue'

createApp(App)
  .use(MushiPlugin, {
    reporterToken: 'demo_pub_playground',
    endpoint: 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api',
    shortcut: 'mod+shift+b',
  })
  .mount('#app')

import { createApp } from 'vue'
import { MushiPlugin } from '@mushi-mushi/vue'
import App from './App.vue'

const app = createApp(App)

app.use(MushiPlugin, {
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey: import.meta.env.VITE_MUSHI_API_KEY,
})

app.mount('#app')

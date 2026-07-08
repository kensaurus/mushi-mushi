import { mount } from 'svelte'
import { initMushi } from '@mushi-mushi/svelte'
import App from './App.svelte'

initMushi({
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey: import.meta.env.VITE_MUSHI_API_KEY,
})

const app = mount(App, { target: document.getElementById('app')! })

export default app

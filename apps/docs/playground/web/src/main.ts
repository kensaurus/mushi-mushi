import { createMushiWidget } from '@mushi-mushi/web'

const widget = createMushiWidget({
  reporterToken: 'demo_pub_playground',
  endpoint: 'https://demo.api.mushimushi.dev',
  shortcut: 'mod+shift+b',
  i18n: { locale: 'en' },
})

document.getElementById('open')?.addEventListener('click', () => widget.open())

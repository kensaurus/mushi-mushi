import { MushiWidget, type WidgetCallbacks } from '../src/widget'

const status = document.getElementById('status')
const log = (msg: string) => {
  if (status) status.textContent = msg
  console.log('[ask-harness]', msg)
}

const callbacks: WidgetCallbacks = {
  onSubmit: async (data) => {
    log(`Report submitted: ${data.category}`)
    return { reportId: `QA-TEST-${Date.now()}` }
  },
  onOpen: () => log('Widget opened'),
  onClose: () => log('Widget closed'),
  assistantEnabled: true,
  assistantLabel: 'Ask',
  assistantGreeting: 'Ask about this page — harness mock.',
  assistantSuggestions: ['How do I reset?', 'What is this page?'],
  onAssistantAsk: async (message, threadId) => {
    log(`Ask: ${message.slice(0, 40)} (thread=${threadId ?? 'new'})`)
    await new Promise((r) => setTimeout(r, 400))
    if (/reset|password|clarify|もっと/i.test(message)) {
      return {
        kind: 'clarify',
        question: 'Which reset path do you mean?',
        options: ['Password reset', 'Factory reset'],
        threadId: threadId ?? 'harness-thread-1',
      }
    }
    if (/unsure|わからない|don't know/i.test(message)) {
      return {
        kind: 'answer',
        text: "I'm not sure — I don't have enough context on this page.",
        threadId: threadId ?? 'harness-thread-1',
      }
    }
    return {
      kind: 'answer',
      text: `Harness answer for: ${message}`,
      threadId: threadId ?? 'harness-thread-1',
    }
  },
}

const widget = new MushiWidget({ trigger: 'auto', position: 'bottom-right' }, callbacks)
widget.mount()
log('Widget mounted — open FAB → Ask')

// Expose for inspection in Playwright evaluate
;(window as unknown as { __mushiAskHarness: MushiWidget }).__mushiAskHarness = widget

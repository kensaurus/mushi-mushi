import type { MushiLocale } from './types';

export const en: MushiLocale = {
  widget: {
    trigger: 'Report Issue',
    title: 'Report an Issue',
    close: 'Close',
    back: 'Back',
    submit: 'Submit',
    submitting: 'Submitting…',
    submitted: 'Thank you! Your report has been submitted.',
    error: 'Something went wrong. Please try again.',
  },
  step1: {
    heading: 'What kind of issue?',
    categories: {
      bug: 'Bug',
      slow: 'Slow / Laggy',
      visual: 'Visual Glitch',
      confusing: 'Confusing',
      other: 'Other',
    },
    categoryDescriptions: {
      bug: 'Something is broken or not working',
      slow: 'Performance issue or slow loading',
      visual: 'Layout, styling, or display problem',
      confusing: 'Hard to understand or navigate',
      other: 'Something else',
    },
  },
  step2: {
    heading: 'What happened?',
    intents: {
      bug: ['Crash', 'Unresponsive', 'Data loss', 'Wrong result', 'Other'],
      slow: ['Page load', 'Interaction', 'API call', 'Animation', 'Other'],
      visual: ['Layout broken', 'Overlapping', 'Missing element', 'Wrong color/font', 'Other'],
      confusing: ['Unclear label', 'Missing help', 'Unexpected flow', 'Lost navigation', 'Other'],
      other: ['Feature request', 'Accessibility', 'Typo', 'Other'],
    },
  },
  step3: {
    heading: 'Tell us more',
    descriptionPlaceholder: 'Describe what happened…',
    screenshotButton: 'Attach Screenshot',
    screenshotAttached: 'Screenshot attached',
    elementButton: 'Select Element',
    elementSelected: 'Element selected',
    optional: '(optional)',
  },
};

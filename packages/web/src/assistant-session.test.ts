import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ASSISTANT_SESSION_STORAGE_KEY,
  clearAssistantSession,
  loadAssistantSession,
  saveAssistantSession,
} from './widget-helpers';

describe('assistant sessionStorage helpers', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('save + load round-trips turns and threadId', () => {
    saveAssistantSession({
      threadId: 'thread-abc',
      turns: [
        { role: 'user', text: 'How do I reset?' },
        {
          role: 'assistant',
          text: 'Could you clarify?',
          options: ['Password', 'Email'],
          offerReport: true,
        },
      ],
    });
    expect(loadAssistantSession()).toEqual({
      threadId: 'thread-abc',
      turns: [
        { role: 'user', text: 'How do I reset?' },
        {
          role: 'assistant',
          text: 'Could you clarify?',
          options: ['Password', 'Email'],
          offerReport: true,
        },
      ],
    });
  });

  it('clearAssistantSession removes the key', () => {
    saveAssistantSession({
      threadId: null,
      turns: [{ role: 'user', text: 'hi' }],
    });
    clearAssistantSession();
    expect(sessionStorage.getItem(ASSISTANT_SESSION_STORAGE_KEY)).toBeNull();
    expect(loadAssistantSession()).toBeNull();
  });

  it('rejects malformed payloads', () => {
    sessionStorage.setItem(ASSISTANT_SESSION_STORAGE_KEY, '{"turns":"nope"}');
    expect(loadAssistantSession()).toBeNull();
  });
});

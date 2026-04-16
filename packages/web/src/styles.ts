export function getWidgetStyles(theme: 'light' | 'dark'): string {
  const isDark = theme === 'dark';
  const accent = '#7c3aed';
  const accentHover = '#6d28d9';
  const accentBgLight = isDark ? '#2e2440' : '#f5f3ff';
  const accentBgSelected = isDark ? '#2e2440' : '#ede9fe';
  const border = isDark ? '#3f3f46' : '#e4e4e7';
  const bgSurface = isDark ? '#18181b' : '#ffffff';
  const bgMuted = isDark ? '#27272a' : '#fafafa';
  const textMuted = isDark ? '#a1a1aa' : '#71717a';

  return `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: ${isDark ? '#e4e4e7' : '#18181b'};
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    /* Trigger button */
    .mushi-trigger {
      position: fixed;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      background: ${bgMuted};
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .mushi-trigger:hover {
      transform: scale(1.08);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    }
    .mushi-trigger.bottom-right { bottom: 20px; right: 20px; }
    .mushi-trigger.bottom-left  { bottom: 20px; left: 20px; }
    .mushi-trigger.top-right    { top: 20px; right: 20px; }
    .mushi-trigger.top-left     { top: 20px; left: 20px; }

    /* Panel */
    .mushi-panel {
      position: fixed;
      width: 380px;
      max-height: 560px;
      border-radius: 12px;
      background: ${bgSurface};
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
      border: 1px solid ${border};
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .mushi-panel.open {
      animation: mushi-slide-in 0.25s ease forwards;
    }
    .mushi-panel.closed { display: none; }
    .mushi-panel.bottom-right { bottom: 76px; right: 20px; }
    .mushi-panel.bottom-left  { bottom: 76px; left: 20px; }
    .mushi-panel.top-right    { top: 76px; right: 20px; }
    .mushi-panel.top-left     { top: 76px; left: 20px; }

    @keyframes mushi-slide-in {
      from { opacity: 0; transform: translateY(8px) scale(0.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* Header */
    .mushi-header {
      padding: 14px 16px;
      border-bottom: 1px solid ${border};
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .mushi-header h3 {
      font-size: 15px;
      font-weight: 600;
      flex: 1;
    }
    .mushi-close, .mushi-back {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 18px;
      color: ${textMuted};
      padding: 4px;
      border-radius: 4px;
      line-height: 1;
    }
    .mushi-close:hover, .mushi-back:hover {
      background: ${bgMuted};
    }

    /* Body */
    .mushi-body {
      padding: 12px 16px;
      overflow-y: auto;
      flex: 1;
    }

    /* Step 1: Category options */
    .mushi-option-btn {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 12px 14px;
      margin-bottom: 8px;
      border-radius: 10px;
      border: 1px solid ${border};
      background: ${bgMuted};
      cursor: pointer;
      font-size: 14px;
      color: inherit;
      text-align: left;
      transition: border-color 0.15s, background 0.15s, transform 0.1s;
    }
    .mushi-option-btn:hover {
      border-color: ${isDark ? '#a78bfa' : accent};
      background: ${accentBgLight};
      transform: translateX(2px);
    }
    .mushi-option-btn:focus-visible {
      outline: 2px solid ${accent};
      outline-offset: 2px;
    }
    .mushi-option-icon { font-size: 20px; flex-shrink: 0; }
    .mushi-option-text { display: flex; flex-direction: column; gap: 2px; }
    .mushi-option-label { font-weight: 500; }
    .mushi-option-desc { font-size: 12px; color: ${textMuted}; }

    /* Step 2: Intent chips */
    .mushi-selected-category {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 8px;
      background: ${accentBgSelected};
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 12px;
    }
    .mushi-intents {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .mushi-intent-btn {
      padding: 8px 16px;
      border-radius: 20px;
      border: 1px solid ${border};
      background: ${bgMuted};
      cursor: pointer;
      font-size: 13px;
      color: inherit;
      transition: border-color 0.15s, background 0.15s;
    }
    .mushi-intent-btn:hover {
      border-color: ${isDark ? '#a78bfa' : accent};
      background: ${accentBgLight};
    }
    .mushi-intent-btn:focus-visible {
      outline: 2px solid ${accent};
      outline-offset: 2px;
    }

    /* Step 3: Details */
    .mushi-textarea {
      width: 100%;
      min-height: 90px;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid ${border};
      background: ${bgMuted};
      color: inherit;
      font-family: inherit;
      font-size: 14px;
      resize: vertical;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .mushi-textarea:focus {
      border-color: ${isDark ? '#a78bfa' : accent};
      box-shadow: 0 0 0 2px ${isDark ? 'rgba(167,139,250,0.2)' : 'rgba(124,58,237,0.1)'};
    }

    .mushi-attachments {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }
    .mushi-attach-btn {
      padding: 6px 12px;
      border-radius: 6px;
      border: 1px solid ${border};
      background: none;
      cursor: pointer;
      font-size: 12px;
      color: ${textMuted};
      transition: border-color 0.15s, color 0.15s;
    }
    .mushi-attach-btn:hover {
      border-color: ${isDark ? '#a78bfa' : accent};
      color: inherit;
    }
    .mushi-attach-btn.active {
      border-color: ${isDark ? '#a78bfa' : accent};
      color: ${isDark ? '#a78bfa' : accent};
      background: ${accentBgLight};
    }

    /* Footer */
    .mushi-footer {
      padding: 12px 16px;
      border-top: 1px solid ${border};
      display: flex;
      align-items: center;
      justify-content: flex-end;
    }
    .mushi-submit {
      padding: 8px 24px;
      border-radius: 8px;
      border: none;
      background: ${accent};
      color: #ffffff;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }
    .mushi-submit:hover { background: ${accentHover}; }
    .mushi-submit:disabled { opacity: 0.5; cursor: not-allowed; }
    .mushi-submit:focus-visible {
      outline: 2px solid ${accent};
      outline-offset: 2px;
    }

    /* Step indicator dots */
    .mushi-step-indicator {
      display: flex;
      justify-content: center;
      gap: 6px;
      padding: 10px;
    }
    .mushi-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: ${border};
      transition: background 0.2s, transform 0.2s;
    }
    .mushi-dot.active {
      background: ${accent};
      transform: scale(1.3);
    }
    .mushi-dot.done {
      background: ${isDark ? '#a78bfa' : '#8b5cf6'};
    }

    /* Success */
    .mushi-success {
      text-align: center;
      padding: 32px 16px;
    }
    .mushi-success-icon {
      font-size: 40px;
      margin-bottom: 12px;
    }
    .mushi-success p {
      color: ${textMuted};
      font-size: 14px;
    }

    /* Error */
    .mushi-error {
      color: #ef4444;
      font-size: 12px;
      margin-top: 8px;
    }
  `;
}

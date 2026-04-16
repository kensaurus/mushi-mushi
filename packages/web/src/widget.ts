import type { MushiReportCategory, MushiWidgetConfig } from '@mushi/core';
import { getLocale, type MushiLocale } from './i18n';
import { getWidgetStyles } from './styles';

type WidgetStep = 'category' | 'intent' | 'details' | 'success';

const CATEGORY_ICONS: Record<MushiReportCategory, string> = {
  bug: '\u26A0\uFE0F',
  slow: '\uD83D\uDC0C',
  visual: '\uD83C\uDFA8',
  confusing: '\uD83D\uDE15',
  other: '\uD83D\uDCDD',
};

export interface WidgetCallbacks {
  onSubmit(data: { category: MushiReportCategory; description: string; intent?: string }): void;
  onOpen(): void;
  onClose(): void;
  onScreenshotRequest(): void;
  onElementSelectorRequest?(): void;
}

export class MushiWidget {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private config: Required<MushiWidgetConfig>;
  private callbacks: WidgetCallbacks;
  private locale: MushiLocale;
  private isOpen = false;
  private step: WidgetStep = 'category';
  private selectedCategory: MushiReportCategory | null = null;
  private selectedIntent: string | null = null;
  private screenshotAttached = false;
  private elementSelected = false;
  private submitting = false;

  constructor(config: MushiWidgetConfig = {}, callbacks: WidgetCallbacks) {
    this.config = {
      position: config.position ?? 'bottom-right',
      theme: config.theme ?? 'auto',
      triggerText: config.triggerText ?? '\uD83D\uDC1B',
      expandedTitle: config.expandedTitle ?? '',
      mode: config.mode ?? 'conversational',
      locale: config.locale ?? 'auto',
      zIndex: config.zIndex ?? 99999,
    };
    this.callbacks = callbacks;
    this.locale = getLocale(this.config.locale === 'auto' ? undefined : this.config.locale);

    this.host = document.createElement('div');
    this.host.id = 'mushi-mushi-widget';
    this.shadow = this.host.attachShadow({ mode: 'closed' });
  }

  mount(): void {
    document.body.appendChild(this.host);
    this.render();
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.step = 'category';
    this.selectedCategory = null;
    this.selectedIntent = null;
    this.screenshotAttached = false;
    this.elementSelected = false;
    this.submitting = false;
    this.render();
    this.callbacks.onOpen();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.render();
    this.callbacks.onClose();
  }

  getIsOpen(): boolean {
    return this.isOpen;
  }

  setScreenshotAttached(attached: boolean): void {
    this.screenshotAttached = attached;
    if (this.isOpen) this.render();
  }

  setElementSelected(selected: boolean): void {
    this.elementSelected = selected;
    if (this.isOpen) this.render();
  }

  destroy(): void {
    this.host.remove();
  }

  private getTheme(): 'light' | 'dark' {
    if (this.config.theme !== 'auto') return this.config.theme;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  private render(): void {
    const theme = this.getTheme();
    const pos = this.config.position;
    const t = this.locale;

    this.shadow.innerHTML = '';

    const style = document.createElement('style');
    style.textContent = getWidgetStyles(theme);
    this.shadow.appendChild(style);

    const trigger = document.createElement('button');
    trigger.className = `mushi-trigger ${pos}`;
    trigger.textContent = this.config.triggerText;
    trigger.setAttribute('aria-label', t.widget.trigger);
    trigger.style.zIndex = String(this.config.zIndex);
    trigger.addEventListener('click', () => {
      if (this.isOpen) this.close();
      else this.open();
    });
    this.shadow.appendChild(trigger);

    const panel = document.createElement('div');
    panel.className = `mushi-panel ${pos}${this.isOpen ? ' open' : ' closed'}`;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', t.widget.title);
    panel.style.zIndex = String(this.config.zIndex + 1);

    if (this.isOpen) {
      panel.innerHTML = this.renderStep();
      this.shadow.appendChild(panel);
      this.attachHandlers(panel);
      this.trapFocus(panel);
    }
  }

  private renderStep(): string {
    switch (this.step) {
      case 'category': return this.renderCategoryStep();
      case 'intent': return this.renderIntentStep();
      case 'details': return this.renderDetailsStep();
      case 'success': return this.renderSuccessStep();
    }
  }

  private renderHeader(title: string, showBack = false): string {
    const t = this.locale;
    return `
      <div class="mushi-header">
        ${showBack ? `<button class="mushi-back" data-action="back" aria-label="${t.widget.back}">\u2190</button>` : ''}
        <h3>${title}</h3>
        <button class="mushi-close" data-action="close" aria-label="${t.widget.close}">\u2715</button>
      </div>
    `;
  }

  private renderCategoryStep(): string {
    const t = this.locale;
    const categories = (['bug', 'slow', 'visual', 'confusing', 'other'] as MushiReportCategory[])
      .map((id) => `
        <button class="mushi-option-btn" data-category="${id}" role="radio" aria-checked="false">
          <span class="mushi-option-icon">${CATEGORY_ICONS[id]}</span>
          <div class="mushi-option-text">
            <span class="mushi-option-label">${t.step1.categories[id]}</span>
            <span class="mushi-option-desc">${t.step1.categoryDescriptions[id]}</span>
          </div>
        </button>
      `).join('');

    return `
      ${this.renderHeader(t.step1.heading)}
      <div class="mushi-body" role="radiogroup" aria-label="${t.step1.heading}">
        ${categories}
      </div>
      <div class="mushi-step-indicator">
        <span class="mushi-dot active"></span>
        <span class="mushi-dot"></span>
        <span class="mushi-dot"></span>
      </div>
    `;
  }

  private renderIntentStep(): string {
    const t = this.locale;
    const cat = this.selectedCategory!;
    const intents = t.step2.intents[cat] || [];

    const options = intents.map((intent) => `
      <button class="mushi-intent-btn" data-intent="${intent}">
        ${intent}
      </button>
    `).join('');

    return `
      ${this.renderHeader(t.step2.heading, true)}
      <div class="mushi-body">
        <div class="mushi-selected-category">
          <span>${CATEGORY_ICONS[cat]}</span>
          <span>${t.step1.categories[cat]}</span>
        </div>
        <div class="mushi-intents">
          ${options}
        </div>
      </div>
      <div class="mushi-step-indicator">
        <span class="mushi-dot done"></span>
        <span class="mushi-dot active"></span>
        <span class="mushi-dot"></span>
      </div>
    `;
  }

  private renderDetailsStep(): string {
    const t = this.locale;

    return `
      ${this.renderHeader(t.step3.heading, true)}
      <div class="mushi-body">
        <textarea
          class="mushi-textarea"
          placeholder="${t.step3.descriptionPlaceholder}"
          rows="4"
          aria-label="${t.step3.heading}"
          autofocus
        ></textarea>
        <div class="mushi-attachments">
          <button class="mushi-attach-btn${this.screenshotAttached ? ' active' : ''}" data-action="screenshot">
            \uD83D\uDCF8 ${this.screenshotAttached ? t.step3.screenshotAttached : t.step3.screenshotButton}
          </button>
          <button class="mushi-attach-btn${this.elementSelected ? ' active' : ''}" data-action="element">
            \uD83C\uDFAF ${this.elementSelected ? t.step3.elementSelected : t.step3.elementButton}
          </button>
        </div>
        <div class="mushi-error" style="display:none" role="alert"></div>
      </div>
      <div class="mushi-footer">
        <button class="mushi-submit" data-action="submit"${this.submitting ? ' disabled' : ''}>
          ${this.submitting ? t.widget.submitting : t.widget.submit}
        </button>
      </div>
      <div class="mushi-step-indicator">
        <span class="mushi-dot done"></span>
        <span class="mushi-dot done"></span>
        <span class="mushi-dot active"></span>
      </div>
    `;
  }

  private renderSuccessStep(): string {
    const t = this.locale;
    return `
      ${this.renderHeader(t.widget.title)}
      <div class="mushi-body">
        <div class="mushi-success">
          <div class="mushi-success-icon">\u2705</div>
          <p>${t.widget.submitted}</p>
        </div>
      </div>
    `;
  }

  private attachHandlers(panel: HTMLElement): void {
    const t = this.locale;

    panel.querySelector('[data-action="close"]')?.addEventListener('click', () => this.close());
    panel.querySelector('[data-action="back"]')?.addEventListener('click', () => {
      if (this.step === 'intent') { this.step = 'category'; this.selectedCategory = null; }
      else if (this.step === 'details') { this.step = 'intent'; this.selectedIntent = null; }
      this.render();
    });

    panel.querySelectorAll('[data-category]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedCategory = (btn as HTMLElement).dataset.category as MushiReportCategory;
        this.step = 'intent';
        this.render();
      });
    });

    panel.querySelectorAll('[data-intent]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedIntent = (btn as HTMLElement).dataset.intent ?? null;
        this.step = 'details';
        this.render();
      });
    });

    panel.querySelector('[data-action="screenshot"]')?.addEventListener('click', () => {
      this.callbacks.onScreenshotRequest();
    });

    panel.querySelector('[data-action="element"]')?.addEventListener('click', () => {
      this.callbacks.onElementSelectorRequest?.();
    });

    panel.querySelector('[data-action="submit"]')?.addEventListener('click', () => {
      const textarea = panel.querySelector('.mushi-textarea') as HTMLTextAreaElement | null;
      const description = textarea?.value?.trim() ?? '';
      const errorEl = panel.querySelector('.mushi-error') as HTMLElement | null;

      if (description.length < 5) {
        if (errorEl) {
          errorEl.textContent = t.widget.error;
          errorEl.style.display = 'block';
        }
        return;
      }

      this.submitting = true;
      this.render();

      this.callbacks.onSubmit({
        category: this.selectedCategory!,
        description,
        intent: this.selectedIntent ?? undefined,
      });

      setTimeout(() => {
        this.submitting = false;
        this.step = 'success';
        this.render();
        setTimeout(() => { if (this.step === 'success') this.close(); }, 2500);
      }, 500);
    });

    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  private trapFocus(panel: HTMLElement): void {
    requestAnimationFrame(() => {
      const focusable = panel.querySelectorAll('button, textarea, [tabindex]');
      if (focusable.length > 0) (focusable[0] as HTMLElement).focus();
    });
  }
}

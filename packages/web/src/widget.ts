/**
 * FILE: packages/web/src/widget.ts
 * PURPOSE: The bug-capture widget — floating trigger + multi-step report
 *          panel — that mounts into a customer's app via `Mushi.init()`.
 *
 * DESIGN: Visual styling lives in `./styles.ts` ("Mushi Mushi Editorial":
 *         paper + sumi ink + 朱 vermillion, serif display + monospace
 *         metadata, ledger-style step counter, hanko stamp animation on
 *         success). This file owns the DOM structure, state, and all
 *         user-facing ARIA / keyboard wiring.
 */

import type { MushiReportCategory, MushiWidgetConfig } from '@mushi-mushi/core';
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

/** The two-digit padded step number used in the header ledger ("01 / 03"). */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const TOTAL_STEPS = 3;
const STEP_NUMBER: Record<Exclude<WidgetStep, 'success'>, number> = {
  category: 1,
  intent: 2,
  details: 3,
};

/** Detects modifier-key presses for the Ctrl/Cmd+Enter submit shortcut.
 *  metaKey covers macOS, ctrlKey covers Windows/Linux/ChromeOS. */
function isSubmitShortcut(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.key === 'Enter';
}

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
  private triggerVisible = true;
  private triggerShrunk = false;
  private triggerHiddenByScroll = false;
  private attachedLaunchers: Array<() => void> = [];
  private smartHideCleanup: (() => void) | null = null;
  private smartHideTimer: ReturnType<typeof setTimeout> | null = null;
  /** Captured at the moment of submit so the success ledger metadata
   *  ("REPORT · 14:23:07 JST") doesn't drift while the success step
   *  is on screen. */
  private submittedAt: Date | null = null;
  /** Pending success-state + auto-close timers. Tracked so destroy()
   *  can clear them — otherwise a host that unmounts mid-submit leaks
   *  this MushiWidget reference (and re-renders into a detached shadow
   *  root) for up to ~3.3s after destroy. */
  private successTimer: ReturnType<typeof setTimeout> | null = null;
  private autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: MushiWidgetConfig = {}, callbacks: WidgetCallbacks) {
    this.config = {
      position: config.position ?? 'bottom-right',
      theme: config.theme ?? 'auto',
      // Falsy-OR (NOT `??`) on purpose: `triggerText: ''` is semantically
      // nonsense — it would render a labelless, glyphless trigger button
      // that users can't see or aim at. Treat empty string the same as
      // omitted so any caller that wires this to a cleared form input or
      // pastes a legacy snippet that emitted `triggerText: ""` (see
      // apps/admin/src/lib/sdkSnippets.ts widgetLines history) still gets
      // the default 🐛 and a visible button.
      triggerText: config.triggerText || '\uD83D\uDC1B',
      expandedTitle: config.expandedTitle ?? '',
      mode: config.mode ?? 'conversational',
      locale: config.locale ?? 'auto',
      zIndex: config.zIndex ?? 99999,
      trigger: config.trigger ?? 'auto',
      attachToSelector: config.attachToSelector ?? '',
      inset: config.inset ?? {},
      respectSafeArea: config.respectSafeArea ?? true,
      hideOnSelector: config.hideOnSelector ?? '',
      hideOnRoutes: config.hideOnRoutes ?? [],
      environments: config.environments ?? {},
      smartHide: config.smartHide ?? false,
      draggable: config.draggable ?? false,
    };
    this.callbacks = callbacks;
    this.locale = getLocale(this.config.locale === 'auto' ? undefined : this.config.locale);

    this.host = document.createElement('div');
    this.host.id = 'mushi-mushi-widget';
    this.shadow = this.host.attachShadow({ mode: 'closed' });
  }

  mount(): void {
    document.body.appendChild(this.host);
    this.syncAttachedLaunchers();
    this.syncSmartHide();
    this.render();
  }

  updateConfig(config: MushiWidgetConfig = {}): void {
    this.config = {
      ...this.config,
      ...(config.position ? { position: config.position } : {}),
      ...(config.theme ? { theme: config.theme } : {}),
      ...(config.triggerText !== undefined ? { triggerText: config.triggerText || '\uD83D\uDC1B' } : {}),
      ...(config.expandedTitle !== undefined ? { expandedTitle: config.expandedTitle } : {}),
      ...(config.mode ? { mode: config.mode } : {}),
      ...(config.locale ? { locale: config.locale } : {}),
      ...(config.zIndex !== undefined ? { zIndex: config.zIndex } : {}),
      ...(config.trigger ? { trigger: config.trigger } : {}),
      ...(config.attachToSelector !== undefined ? { attachToSelector: config.attachToSelector } : {}),
      ...(config.inset !== undefined ? { inset: config.inset } : {}),
      ...(config.respectSafeArea !== undefined ? { respectSafeArea: config.respectSafeArea } : {}),
      ...(config.hideOnSelector !== undefined ? { hideOnSelector: config.hideOnSelector } : {}),
      ...(config.hideOnRoutes !== undefined ? { hideOnRoutes: config.hideOnRoutes } : {}),
      ...(config.environments !== undefined ? { environments: config.environments } : {}),
      ...(config.smartHide !== undefined ? { smartHide: config.smartHide } : {}),
      ...(config.draggable !== undefined ? { draggable: config.draggable } : {}),
    };
    this.locale = getLocale(this.config.locale === 'auto' ? undefined : this.config.locale);
    this.syncAttachedLaunchers();
    this.syncSmartHide();
    this.render();
  }

  open(options?: { category?: MushiReportCategory }): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.screenshotAttached = false;
    this.elementSelected = false;
    this.submitting = false;
    this.submittedAt = null;

    if (options?.category) {
      this.selectedCategory = options.category;
      this.selectedIntent = null;
      this.step = 'intent';
    } else {
      this.selectedCategory = null;
      this.selectedIntent = null;
      this.step = 'category';
    }

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

  showTrigger(): void {
    this.triggerVisible = true;
    this.render();
  }

  hideTrigger(): void {
    this.triggerVisible = false;
    this.render();
  }

  setTrigger(trigger: NonNullable<MushiWidgetConfig['trigger']>): void {
    this.updateConfig({ trigger });
  }

  attachTo(selectorOrElement: string | Element, options: MushiWidgetConfig = {}): () => void {
    const elements = typeof selectorOrElement === 'string'
      ? Array.from(document.querySelectorAll(selectorOrElement))
      : [selectorOrElement];
    const cleanups = elements.map((el) => {
      const onClick = (event: Event) => {
        event.preventDefault();
        this.updateConfig(options);
        this.open();
      };
      el.addEventListener('click', onClick);
      return () => el.removeEventListener('click', onClick);
    });
    return () => cleanups.forEach((cleanup) => cleanup());
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
    if (this.successTimer !== null) {
      clearTimeout(this.successTimer);
      this.successTimer = null;
    }
    if (this.autoCloseTimer !== null) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
    if (this.smartHideTimer !== null) {
      clearTimeout(this.smartHideTimer);
      this.smartHideTimer = null;
    }
    this.smartHideCleanup?.();
    this.smartHideCleanup = null;
    this.attachedLaunchers.forEach((cleanup) => cleanup());
    this.attachedLaunchers = [];
    this.host.remove();
  }

  private syncAttachedLaunchers(): void {
    this.attachedLaunchers.forEach((cleanup) => cleanup());
    this.attachedLaunchers = [];
    if (this.config.trigger !== 'attach' || !this.config.attachToSelector) return;
    if (typeof document === 'undefined') return;
    this.attachedLaunchers.push(this.attachTo(this.config.attachToSelector));
  }

  private syncSmartHide(): void {
    this.smartHideCleanup?.();
    this.smartHideCleanup = null;
    this.triggerShrunk = false;
    this.triggerHiddenByScroll = false;
    if (!this.config.smartHide || typeof window === 'undefined') return;

    const smart = this.config.smartHide === true
      ? { onMobile: 'edge-tab' as const, onScroll: 'shrink' as const, onIdleMs: 900 }
      : this.config.smartHide;
    if (!smart.onScroll) return;

    const onScroll = () => {
      if (smart.onScroll === 'hide') {
        this.triggerHiddenByScroll = true;
      } else {
        this.triggerShrunk = true;
      }
      this.render();
      if (this.smartHideTimer !== null) clearTimeout(this.smartHideTimer);
      this.smartHideTimer = setTimeout(() => {
        this.triggerHiddenByScroll = false;
        this.triggerShrunk = false;
        this.render();
      }, smart.onIdleMs ?? 900);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    this.smartHideCleanup = () => window.removeEventListener('scroll', onScroll);
  }

  private shouldRenderTrigger(): boolean {
    if (!this.triggerVisible) return false;
    if (this.triggerHiddenByScroll) return false;
    if (this.config.trigger === 'manual' || this.config.trigger === 'hidden' || this.config.trigger === 'attach') {
      return false;
    }
    if (this.isMobileSmartHidden()) return false;
    if (this.isRouteHidden()) return false;
    if (this.config.hideOnSelector && document.querySelector(this.config.hideOnSelector)) return false;
    const action = this.config.environments[this.detectEnvironment()];
    return action !== 'never' && action !== 'manual';
  }

  private effectiveTrigger(): NonNullable<MushiWidgetConfig['trigger']> {
    if (!this.config.smartHide || typeof window === 'undefined') return this.config.trigger;
    const smart = this.config.smartHide === true
      ? { onMobile: 'edge-tab' as const }
      : this.config.smartHide;
    if (window.matchMedia('(max-width: 768px)').matches && smart.onMobile === 'edge-tab') {
      return 'edge-tab';
    }
    return this.config.trigger;
  }

  private isMobileSmartHidden(): boolean {
    if (!this.config.smartHide || typeof window === 'undefined') return false;
    const smart = this.config.smartHide === true ? { onMobile: 'edge-tab' as const } : this.config.smartHide;
    return window.matchMedia('(max-width: 768px)').matches && smart.onMobile === 'hide';
  }

  private detectEnvironment(): 'production' | 'staging' | 'development' {
    const host = typeof location !== 'undefined' ? location.hostname : '';
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return 'development';
    if (/\b(staging|stage|preview|dev)\b/i.test(host)) return 'staging';
    return 'production';
  }

  private isRouteHidden(): boolean {
    if (!this.config.hideOnRoutes.length || typeof location === 'undefined') return false;
    return this.config.hideOnRoutes.some((route) => location.pathname.includes(route));
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

    if (this.shouldRenderTrigger()) {
      const effectiveTrigger = this.effectiveTrigger();
      const trigger = document.createElement('button');
      trigger.className = `mushi-trigger ${pos}${effectiveTrigger === 'edge-tab' ? ' edge-tab' : ''}${this.triggerShrunk ? ' shrunk' : ''}`;
      trigger.textContent = this.config.triggerText;
      trigger.setAttribute('aria-label', t.widget.trigger);
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.setAttribute('aria-expanded', String(this.isOpen));
      trigger.style.zIndex = String(this.config.zIndex);
      this.applyInsetVars(trigger);
      trigger.addEventListener('click', () => {
        if (this.isOpen) this.close();
        else this.open();
      });
      this.shadow.appendChild(trigger);
    }

    const panel = document.createElement('div');
    panel.className = `mushi-panel ${pos}${this.isOpen ? ' open' : ' closed'}`;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', t.widget.title);
    panel.style.zIndex = String(this.config.zIndex + 1);
    this.applyInsetVars(panel);

    if (this.isOpen) {
      panel.innerHTML = this.renderStep();
      this.shadow.appendChild(panel);
      this.attachHandlers(panel);
      this.trapFocus(panel);
    }
  }

  private applyInsetVars(el: HTMLElement): void {
    const { inset } = this.config;
    if (!this.config.respectSafeArea) {
      (['top', 'right', 'bottom', 'left'] as const).forEach((edge) => {
        if (inset[edge] === undefined) el.style.setProperty(`--mushi-${edge}`, '24px');
      });
    }
    (['top', 'right', 'bottom', 'left'] as const).forEach((edge) => {
      const value = inset[edge];
      if (value === undefined) return;
      el.style.setProperty(`--mushi-${edge}`, value === 'auto' ? 'auto' : `${value}px`);
    });
    el.style.setProperty('--mushi-safe-area', this.config.respectSafeArea ? '1' : '0');
  }

  private renderStep(): string {
    switch (this.step) {
      case 'category': return this.renderCategoryStep();
      case 'intent': return this.renderIntentStep();
      case 'details': return this.renderDetailsStep();
      case 'success': return this.renderSuccessStep();
    }
  }

  /**
   * Editorial masthead. Always carries:
   *   • the brand mark (虫 kanji on vermillion, "MUSHI" in mono above)
   *   • the page title (serif display)
   *   • the close affordance
   *
   * On sub-steps it additionally renders a back button (replacing the
   * "MUSHI" eyebrow with a "← BACK" mono link) and a step counter
   * ledger ("02 / 03") on the far right.
   */
  private renderHeader(opts: {
    title: string;
    showBack?: boolean;
    step?: number;
    eyebrow?: string;
  }): string {
    const t = this.locale;
    const { title, showBack = false, step, eyebrow } = opts;

    const eyebrowHtml = showBack
      ? `<button type="button" class="mushi-back" data-action="back" aria-label="${t.widget.back}">\u2190 ${t.widget.back}</button>`
      : `<span class="mushi-header-eyebrow">${eyebrow ?? 'Mushi \u00B7 Report'}</span>`;

    const counterHtml = step
      ? `<span class="mushi-step-counter" aria-label="Step ${step} of ${TOTAL_STEPS}"><b>${pad2(step)}</b> / ${pad2(TOTAL_STEPS)}</span>`
      : '';

    return `
      <div class="mushi-header">
        <div class="mushi-header-mark" aria-hidden="true">\u866B</div>
        <div class="mushi-header-titles">
          ${eyebrowHtml}
          <h3>${title}</h3>
        </div>
        <div class="mushi-header-meta">
          ${counterHtml}
          <button type="button" class="mushi-close" data-action="close" aria-label="${t.widget.close}">\u2715</button>
        </div>
      </div>
    `;
  }

  /**
   * Numeral step indicator: "01 — 02 — 03", with the active step in
   * vermillion serif and completed steps struck through in mono.
   * Replaces the original three-dot indicator (a generic SaaS pattern).
   */
  private renderStepIndicator(currentStep: number): string {
    const segments: string[] = [];
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      const cls =
        i < currentStep ? 'mushi-step-num done' :
        i === currentStep ? 'mushi-step-num active' :
        'mushi-step-num';
      segments.push(`<span class="${cls}">${pad2(i)}</span>`);
      if (i < TOTAL_STEPS) segments.push('<span class="mushi-step-sep" aria-hidden="true"></span>');
    }
    return `<div class="mushi-step-indicator" aria-hidden="true">${segments.join('')}</div>`;
  }

  private renderCategoryStep(): string {
    const t = this.locale;
    const categories = (['bug', 'slow', 'visual', 'confusing', 'other'] as MushiReportCategory[])
      .map((id) => `
        <button type="button" class="mushi-option-btn" data-category="${id}" role="radio" aria-checked="false">
          <span class="mushi-option-icon" aria-hidden="true">${CATEGORY_ICONS[id]}</span>
          <div class="mushi-option-text">
            <span class="mushi-option-label">${t.step1.categories[id]}</span>
            <span class="mushi-option-desc">${t.step1.categoryDescriptions[id]}</span>
          </div>
          <span class="mushi-option-arrow" aria-hidden="true">\u2192</span>
        </button>
      `).join('');

    return `
      ${this.renderHeader({ title: t.step1.heading, step: STEP_NUMBER.category })}
      <div class="mushi-body" role="radiogroup" aria-label="${t.step1.heading}">
        ${categories}
      </div>
      ${this.renderStepIndicator(STEP_NUMBER.category)}
    `;
  }

  private renderIntentStep(): string {
    const t = this.locale;
    const cat = this.selectedCategory!;
    const intents = t.step2.intents[cat] || [];

    const options = intents.map((intent) => `
      <button type="button" class="mushi-intent-btn" data-intent="${intent}">
        ${intent}
      </button>
    `).join('');

    return `
      ${this.renderHeader({ title: t.step2.heading, showBack: true, step: STEP_NUMBER.intent })}
      <div class="mushi-body">
        <div class="mushi-selected-category">
          <span aria-hidden="true">${CATEGORY_ICONS[cat]}</span>
          <span>${t.step1.categories[cat]}</span>
        </div>
        <div class="mushi-intents">
          ${options}
        </div>
      </div>
      ${this.renderStepIndicator(STEP_NUMBER.intent)}
    `;
  }

  private renderDetailsStep(): string {
    const t = this.locale;

    return `
      ${this.renderHeader({ title: t.step3.heading, showBack: true, step: STEP_NUMBER.details })}
      <div class="mushi-body">
        <textarea
          class="mushi-textarea"
          placeholder="${t.step3.descriptionPlaceholder}"
          rows="4"
          aria-label="${t.step3.heading}"
          autofocus
        ></textarea>
        <div class="mushi-attachments">
          <button type="button" class="mushi-attach-btn${this.screenshotAttached ? ' active' : ''}" data-action="screenshot">
            \uD83D\uDCF8 ${this.screenshotAttached ? t.step3.screenshotAttached : t.step3.screenshotButton}
          </button>
          <button type="button" class="mushi-attach-btn${this.elementSelected ? ' active' : ''}" data-action="element">
            \uD83C\uDFAF ${this.elementSelected ? t.step3.elementSelected : t.step3.elementButton}
          </button>
        </div>
        <div class="mushi-error" style="display:none" role="alert"></div>
      </div>
      <div class="mushi-footer">
        <span class="mushi-footer-hint" aria-hidden="true">\u2318 + ENTER \u2192 send</span>
        <button type="button" class="mushi-submit" data-action="submit"${this.submitting ? ' disabled' : ''}>
          <span>${this.submitting ? t.widget.submitting : t.widget.submit}</span>
          <span class="mushi-submit-arrow" aria-hidden="true">\u2192</span>
        </button>
      </div>
      ${this.renderStepIndicator(STEP_NUMBER.details)}
    `;
  }

  /**
   * Editorial success state: 朱印-style red stamp ring with the kanji
   * 受 ("received") at its centre, the localised "thank you" string
   * in serif below, and a mono ledger receipt ("REPORT · HH:MM:SS").
   * The ring + label animations are defined in styles.ts so this stays
   * pure markup and `prefers-reduced-motion` flips them to the final
   * frame instantly.
   */
  private renderSuccessStep(): string {
    const t = this.locale;
    const stamp = this.submittedAt ?? new Date();
    const time = stamp.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

    return `
      ${this.renderHeader({ title: t.widget.title, eyebrow: 'Mushi \u00B7 Receipt' })}
      <div class="mushi-body">
        <div class="mushi-success">
          <div class="mushi-success-stamp" aria-hidden="true">
            <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"><circle cx="50" cy="50" r="44"/></svg>
            <span class="mushi-success-stamp-label">\u53D7</span>
          </div>
          <div class="mushi-success-headline">${t.widget.submitted}</div>
          <div class="mushi-success-meta">REPORT \u00B7 ${time}</div>
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

    const submitReport = (): void => {
      const textarea = panel.querySelector('.mushi-textarea') as HTMLTextAreaElement | null;
      const description = textarea?.value?.trim() ?? '';
      const errorEl = panel.querySelector('.mushi-error') as HTMLElement | null;

      // V5.3 §2.1: increased from 5 to 20 to filter low-value "doesn't work"
      // submissions that the LLM cannot meaningfully classify. Empirically this
      // removed ~30% of unactionable reports without measurable drop in valid ones.
      const MIN_DESCRIPTION_LENGTH = 20;
      if (description.length < MIN_DESCRIPTION_LENGTH) {
        if (errorEl) {
          errorEl.textContent = `${t.widget.error} (${description.length}/${MIN_DESCRIPTION_LENGTH})`;
          errorEl.style.display = 'block';
        }
        return;
      }

      this.submitting = true;
      this.submittedAt = new Date();
      this.render();

      this.callbacks.onSubmit({
        category: this.selectedCategory!,
        description,
        intent: this.selectedIntent ?? undefined,
      });

      this.successTimer = setTimeout(() => {
        this.successTimer = null;
        this.submitting = false;
        this.step = 'success';
        this.render();
        this.autoCloseTimer = setTimeout(() => {
          this.autoCloseTimer = null;
          if (this.step === 'success') this.close();
        }, 2800);
      }, 500);
    };

    panel.querySelector('[data-action="submit"]')?.addEventListener('click', submitReport);

    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
        return;
      }
      // Ctrl/Cmd+Enter submits from anywhere in the panel — primarily to
      // catch the textarea where Enter alone needs to insert a newline.
      // Only the details step has a submit action, so guard on that.
      if (this.step === 'details' && isSubmitShortcut(e)) {
        e.preventDefault();
        submitReport();
      }
    });
  }

  private trapFocus(panel: HTMLElement): void {
    requestAnimationFrame(() => {
      // Prefer the textarea on the details step so users can start typing
      // immediately without an extra Tab. Otherwise focus the first
      // interactive element so keyboard users can navigate the list.
      const textarea = panel.querySelector('textarea') as HTMLElement | null;
      if (textarea) {
        textarea.focus();
        return;
      }
      const focusable = panel.querySelectorAll('button, textarea, [tabindex]');
      if (focusable.length > 0) (focusable[0] as HTMLElement).focus();
    });
  }
}

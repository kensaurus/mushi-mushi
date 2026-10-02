import type { MushiReportCategory } from '@mushi-mushi/core';

export interface MushiLocale {
  widget: {
    trigger: string;
    title: string;
    close: string;
    back: string;
    submit: string;
    submitting: string;
    submitted: string;
    error: string;
  };
  step1: {
    /** @deprecated The 3-step flow is retired (Plan 018); unused since 1.30. */
    heading?: string;
    /** @deprecated Unused since 1.30. */
    reportSectionLabel?: string;
    /** @deprecated Unused since 1.30. */
    moreNavLabel?: string;
    /** Labels of the header overflow menu. */
    moreNav: {
      /** @deprecated Unused since 1.30 — see `panel.yourReports`. */
      yourReports?: string;
      /** @deprecated Unused since 1.30. */
      yourReportsDesc?: string;
      /** @deprecated Unused since 1.30. */
      unreadNew?: string;
      communityIdeas: string;
      /** @deprecated Unused since 1.30. */
      communityIdeasDesc?: string;
      leaderboard: string;
      joinCommunity: string;
      myAccount: string;
    };
    categories: Record<MushiReportCategory, string>;
    /** @deprecated Unused since 1.30. */
    categoryDescriptions?: Record<MushiReportCategory, string>;
    /** @deprecated Unused since 1.30. */
    moreCategoriesLabel?: string;
    /** @deprecated Unused since 1.30. */
    moreCategoriesCount?: string;
  };
  step2: {
    /** @deprecated Unused since 1.30. */
    heading?: string;
    /** Optional sub-chips shown after a type is picked (the first four, minus "Other"). */
    intents: Record<MushiReportCategory, string[]>;
  };
  step3: {
    /** @deprecated Unused since 1.30. */
    heading?: string;
    /** Placeholder of the one-screen report textarea. */
    descriptionPlaceholder: string;
    /** Placeholder when the Idea chip is picked. */
    featurePlaceholder: string;
    /** @deprecated Unused since 1.30. */
    featureExamples?: string[];
    /** @deprecated Unused since 1.30. */
    otherPlaceholder?: string;
    /** Footer shortcut hint; `{key}` is ⌘ on Apple platforms, Ctrl elsewhere. */
    submitHint: string;
    /** @deprecated Unused since 1.30 — the hint is "Add a few words". */
    charsNeeded?: string;
    screenshotButton: string;
    screenshotAttached: string;
    screenshotCapturing: string;
    /** @deprecated The web widget now shows `screenshotRetry` + `screenshotErrors`; kept for type compatibility. */
    screenshotFailed?: string;
    /** Screenshot button label after a failed capture. */
    screenshotRetry: string;
    /** Offered after a failed capture: user-consented tab share (getDisplayMedia). */
    screenshotShareTab: string;
    /** Why the last capture failed, shown under the attachment row. */
    screenshotErrors: {
      permission: string;
      unsupported: string;
      taint: string;
      timeout: string;
      csp: string;
      error: string;
    };
    /** Alt text for the attached-screenshot preview image. */
    screenshotPreviewAlt: string;
    /** Default privacy caption shown beside the screenshot preview. */
    screenshotSensitiveHint: string;
    elementButton: string;
    elementSelected: string;
    elementCapturing: string;
    elementFailed: string;
    elementSelectorHint: string;
    /** @deprecated Unused since 1.30. */
    optional?: string;
    /** @deprecated Unused since 1.30 — core `reporterCopy().ui.addWords`. */
    tooShort?: string;
    /** @deprecated Unused since 1.30. */
    examplePrompts?: string[];
  };
  /** One-screen report, header and notification copy (Plan 018 §1). */
  panel: {
    /** Report screen title. */
    title: string;
    /** "More…" chip: reveals the host's own categories. */
    more: string;
    /** Element picker button. */
    pointAt: string;
    remove: string;
    markUp: string;
    /** Privacy line under the attachments. */
    privacy: string;
    send: string;
    /** Header pill that opens "Your reports". */
    yourReports: string;
    /** Badge text on the pill; `{n}` placeholder. */
    newCount: string;
    /** Header overflow menu button label. */
    moreOptions: string;
    /** Title of the report detail view. */
    reportTitle: string;
    /** Receipt opt-in checkbox. */
    emailOptIn: string;
    emailLabel: string;
    save: string;
    /** After saving the email: double opt-in pending. */
    emailSaved: string;
    /** Web push opt-in button. */
    notifyMe: string;
    notifyOn: string;
    /** Toast after the developer replied. */
    toastReplied: string;
    view: string;
  };
  assistant: {
    defaultLabel: string;
    defaultGreeting: string;
    inputPlaceholder: string;
    sendAriaLabel: string;
    hubDescription: string;
    thinking: string;
    /** Primary recovery CTA when Ask cannot resolve (clarify / error). */
    fileReportCta: string;
    /** Softer footer escape when the thread already has turns. */
    stillStuckCta: string;
    errors: {
      noResponse: string;
      generic: string;
    };
  };
  flows: {
    /** @deprecated Unused since 1.30 (no brand eyebrow in the header). */
    eyebrows?: {
      inbox: string;
      roadmap: string;
      community: string;
      identity: string;
      signIn: string;
      allApps: string;
      receipt: string;
      thread: string;
    };
    reports: {
      title: string;
      loading: string;
      /** @deprecated Unused since 1.30 — core `ui.empty`. */
      empty?: string;
      /** @deprecated Unused since 1.30. */
      leaderboardLink?: string;
    };
    roadmap: {
      title: string;
      loading: string;
      empty: string;
      shipped: string;
      vote: string;
      voted: string;
      voteCount: string;
      untitled: string;
    };
    leaderboard: {
      title: string;
      loading: string;
      empty: string;
      signInPrompt: string;
      myRank: string;
      footer: string;
      anon: string;
    };
    account: {
      title: string;
      checkEmailTitle: string;
      joinTitle: string;
      emailLabel: string;
      emailPlaceholder: string;
      signInPrompt: string;
      magicLinkSent: string;
      resendEmail: string;
      sendLink: string;
      sending: string;
      crossAppReports: string;
      viewLeaderboard: string;
      signOut: string;
      rankSummary: string;
    };
    crossApp: {
      title: string;
      loading: string;
      empty: string;
      unknownApp: string;
    };
    thread: {
      /** @deprecated Unused since 1.30 — see `panel.reportTitle`. */
      title?: string;
      loading: string;
      /** @deprecated Unused since 1.30 — core `ui.noReplies`. */
      empty?: string;
      /** @deprecated Unused since 1.30 — core `ui.yes`. */
      confirmFixed?: string;
      /** @deprecated Unused since 1.30 — core `ui.notYet`. */
      notFixed?: string;
      replyPlaceholder: string;
      /** @deprecated Unused since 1.30 — see `panel.send`. */
      send?: string;
      /** @deprecated Unused since 1.30 — core `ui.loadError`. */
      loadFailed?: string;
      /** @deprecated Unused since 1.30 — core `ui.retry`. */
      retry?: string;
    };
    success: {
      /** @deprecated Unused since 1.30 — the receipt title is core `ui.sent`. */
      title?: string;
      /** Closes the panel from the success step. */
      done: string;
      trackReport: string;
      receipt: string;
      delivering: string;
      queuedOffline: string;
      queuedHint: string;
      rateLimited: string;
      rateLimitedHint: string;
      quotaBlocked: string;
      quotaBlockedHint: string;
      permanentFailed: string;
      permanentFailedHint: string;
      retrying: string;
      retryingHint: string;
      trackOnMushi: string;
      slaDefault: string;
      screenshotDropped: string;
    };
    featureRequest: {
      label: string;
      /** @deprecated Unused since 1.30. */
      description?: string;
    };
    /** Beta-mode strip on the category step. */
    betaStrip: {
      /** Default status line when the host sets no message; `{appName}` placeholder. */
      defaultMessage: string;
      /** Where reports land; `{email}` placeholder. */
      contactHint: string;
      /** aria-label for the strip. */
      ariaLabel: string;
    };
    /** Collapsible changelog row (beta mode). */
    changelog: {
      /** `{version}` placeholder. */
      whatsNew: string;
    };
    /** Link text of the "Bug reports by Mushi" mark (widget.brandFooter). No placeholders. */
    poweredBy: string;
  };
}

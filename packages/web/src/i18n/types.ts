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
    heading: string;
    /** Section label above the primary report categories. */
    reportSectionLabel: string;
    /** Collapsible overflow nav for inbox, assistant, community, etc. */
    moreNavLabel: string;
    moreNav: {
      yourReports: string;
      yourReportsDesc: string;
      unreadNew: string;
      communityIdeas: string;
      communityIdeasDesc: string;
      leaderboard: string;
      joinCommunity: string;
      myAccount: string;
    };
    categories: Record<MushiReportCategory, string>;
    categoryDescriptions: Record<MushiReportCategory, string>;
  };
  step2: {
    heading: string;
    intents: Record<MushiReportCategory, string[]>;
  };
  step3: {
    heading: string;
    descriptionPlaceholder: string;
    screenshotButton: string;
    screenshotAttached: string;
    screenshotCapturing: string;
    screenshotFailed: string;
    /** Alt text for the attached-screenshot preview image. */
    screenshotPreviewAlt: string;
    /** Default privacy caption shown beside the screenshot preview. */
    screenshotSensitiveHint: string;
    elementButton: string;
    elementSelected: string;
    elementCapturing: string;
    elementFailed: string;
    elementSelectorHint: string;
    optional: string;
    /** Inline validation: description is below the minimum length. */
    tooShort: string;
    /** Example starter chips rendered above the textarea to lower the barrier. */
    examplePrompts: string[];
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
    eyebrows: {
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
      empty: string;
      leaderboardLink: string;
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
      title: string;
      loading: string;
      empty: string;
      confirmFixed: string;
      notFixed: string;
      replyPlaceholder: string;
      send: string;
    };
    success: {
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
      description: string;
    };
    poweredBy: string;
  };
}

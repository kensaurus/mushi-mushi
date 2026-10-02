// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * FILE: reporter-ui.ts
 * PURPOSE: The one reporter-facing vocabulary shared by every SDK widget
 *          (web, React Native, Capacitor): report categories, the end-user
 *          status table, the timeline kinds and their copy in en/ja/es/th.
 *
 * OVERVIEW:
 * - `reporterStatus(report, locale)` maps all 14 internal `reports.status`
 *   values (plus the `awaiting_reporter` and duplicate-group overlays and the
 *   feature-request variants) onto eight end-user states. There is no branch
 *   that echoes the raw status: an unknown value reads as "Received".
 * - `reporterTimelineText(kind, params, locale)` renders pipeline events from
 *   a fixed template per kind. Stored notification payload text is never
 *   shown, so internal category / severity can not leak to a reporter.
 *
 * USAGE:
 * - `import { reporterStatus } from '@mushi-mushi/core/reporter-ui'`
 * - Shipped as a subpath so the main `@mushi-mushi/core` entry stays within
 *   its size budget; nothing here is re-exported from `index.ts`.
 *
 * Plan 018 (docs/execplans/reporter-loop-v2.md) §2.1 and §2.3.
 */

/** Every value `reports_status_check` allows. Pinned to the server list by a test. */
export const REPORTER_CANONICAL_STATUSES = [
  'new',
  'pending',
  'submitted',
  'queued',
  'classified',
  'grouped',
  'fixing',
  'fixed',
  'dismissed',
  'triaged',
  'in_progress',
  'resolved',
  'verified',
  'reopened',
] as const;

export type ReporterCanonicalStatus = (typeof REPORTER_CANONICAL_STATUSES)[number];

export const REPORTER_LOCALES = ['en', 'ja', 'es', 'th'] as const;
export type ReporterLocale = (typeof REPORTER_LOCALES)[number];

/** Optional type chips on the one-screen report form, in display order. */
export const REPORTER_CATEGORIES = ['bug', 'slow', 'visual', 'confusing', 'idea'] as const;
export type ReporterCategory = (typeof REPORTER_CATEGORIES)[number];

/** `closed_reason` values the `reports_closed_reason_check` constraint allows. */
export const REPORTER_CLOSED_REASONS = [
  'duplicate',
  'not_reproducible',
  'wont_fix',
  'working_as_intended',
  'spam',
] as const;
export type ReporterClosedReason = (typeof REPORTER_CLOSED_REASONS)[number];

export type ReporterTone =
  | 'neutral'
  | 'info'
  | 'attention'
  | 'progress'
  | 'success'
  | 'success-muted'
  | 'muted';

/** The end-user state a report is shown in. */
export type ReporterStatusKey =
  | 'received'
  | 'reviewing'
  | 'reviewing_again'
  | 'fixing'
  | 'verified'
  | 'fixed_next'
  | 'fixed_version'
  | 'fixed'
  | 'closed'
  | 'waiting';

/** Base state per internal status, before overlays. Exhaustive by type. */
const BASE_STATE: Record<ReporterCanonicalStatus, ReporterStatusKey> = {
  new: 'received',
  pending: 'received',
  submitted: 'received',
  queued: 'received',
  classified: 'reviewing',
  triaged: 'reviewing',
  grouped: 'reviewing',
  reopened: 'reviewing_again',
  fixing: 'fixing',
  in_progress: 'fixing',
  verified: 'verified',
  fixed: 'fixed_next',
  resolved: 'fixed',
  dismissed: 'closed',
};

const TONE: Record<ReporterStatusKey, ReporterTone> = {
  received: 'neutral',
  reviewing: 'info',
  reviewing_again: 'info',
  fixing: 'progress',
  verified: 'success-muted',
  fixed_next: 'success',
  fixed_version: 'success',
  fixed: 'success',
  closed: 'muted',
  waiting: 'attention',
};

/** Timeline entry kinds the reporter detail view renders (§2.3). */
export const REPORTER_TIMELINE_KINDS = [
  'received',
  'reviewing',
  'duplicate_linked',
  'info_requested',
  'comment',
  'reporter_comment',
  'fix_started',
  'fixed',
  'released',
  'verified',
  'reopened',
  'closed',
] as const;
export type ReporterTimelineKind = (typeof REPORTER_TIMELINE_KINDS)[number];

export interface ReporterCopy {
  status: Record<ReporterStatusKey, string>;
  detail: Record<ReporterStatusKey, string>;
  idea: { received: string; reviewing: string; fixing: string; shipped: string; shippedVersion: string };
  closedReason: Record<Exclude<ReporterClosedReason, 'spam'>, string> & { none: string };
  others: { few: string; many: string };
  timeline: Record<Exclude<ReporterTimelineKind, 'comment' | 'closed'>, string>;
  categories: Record<ReporterCategory, string>;
  ui: {
    yes: string;
    notYet: string;
    empty: string;
    loadError: string;
    retry: string;
    sending: string;
    sent: string;
    sendFailed: string;
    noReplies: string;
    you: string;
    developer: string;
    addWords: string;
    developerReplied: string;
    updates: string;
    /** Receipt after sending (replaces the form in place). */
    receipt: string;
    trackIt: string;
    done: string;
    /** Email opt-in on the receipt / report detail (never pre-ticked). */
    emailOptIn: string;
    emailPlaceholder: string;
    emailSubmit: string;
    emailCheckInbox: string;
    emailInvalid: string;
    emailFailed: string;
    /** Next-visit toast. */
    toastReplied: string;
    toastFixed: string;
    view: string;
  };
}

const EN: ReporterCopy = {
  status: {
    received: 'Received',
    reviewing: 'Looking into it',
    reviewing_again: 'Looking into it again',
    fixing: 'Fix in progress',
    verified: 'Confirmed fixed',
    fixed_next: 'Fixed — coming in the next update',
    fixed_version: 'Fixed in v{version}',
    fixed: 'Fixed',
    closed: 'Closed',
    waiting: 'Waiting on you',
  },
  detail: {
    received: 'We got it.',
    reviewing: 'The developer has it on their list.',
    reviewing_again: 'Thanks — we reopened it.',
    fixing: 'A fix is being worked on.',
    verified: 'You confirmed the fix. Thank you!',
    fixed_next: 'It ships in the next release.',
    fixed_version: 'Update to v{version}. Does it work for you now?',
    fixed: 'Does it work for you now?',
    closed: 'Closed.',
    waiting: 'The developer asked a question — reply below.',
  },
  idea: {
    received: 'Thanks for the idea',
    reviewing: 'Under consideration',
    fixing: 'Being built',
    shipped: 'Shipped',
    shippedVersion: 'Shipped in v{version}',
  },
  closedReason: {
    duplicate: "Same as an earlier report — we'll update you there.",
    not_reproducible: "We couldn't reproduce it. Reply if it happens again.",
    wont_fix: 'We decided not to change this.',
    working_as_intended: 'This is expected behaviour.',
    none: 'Closed.',
  },
  others: {
    few: 'You and a few others reported this',
    many: 'Many people reported this',
  },
  timeline: {
    received: 'You reported this',
    reviewing: 'The developer is looking into it',
    duplicate_linked: "Same as an existing report — we'll update you there",
    info_requested: 'The developer asked: {text}',
    reporter_comment: 'You',
    fix_started: 'A fix is in progress',
    fixed: 'Fixed — coming in the next update',
    released: 'Shipped in v{version} — update to get it',
    verified: "You confirmed it's fixed",
    reopened: 'Reopened',
  },
  categories: {
    bug: 'Bug',
    slow: 'Slow',
    visual: 'Looks wrong',
    confusing: 'Confusing',
    idea: 'Idea',
  },
  ui: {
    yes: 'Yes',
    notYet: 'Not yet',
    empty: 'Nothing yet — your reports will show up here with updates.',
    loadError: "Couldn't load updates",
    retry: 'Retry',
    sending: 'Sending…',
    sent: 'Sent',
    sendFailed: 'Failed',
    noReplies: 'No developer replies yet.',
    you: 'You',
    developer: 'Developer',
    addWords: 'Add a few words',
    developerReplied: 'Developer replied: “{text}”',
    updates: '{n} updates on your reports',
    receipt: "Sent. We'll let you know here when there's news.",
    trackIt: 'Track it',
    done: 'Done',
    emailOptIn: 'Get updates by email',
    emailPlaceholder: 'you@example.com',
    emailSubmit: 'Email me updates',
    emailCheckInbox: 'Check your inbox and tap the link to confirm.',
    emailInvalid: 'That does not look like an email address.',
    emailFailed: "Couldn't set up email updates. Try again later.",
    toastReplied: 'The developer replied to your report',
    toastFixed: 'Your bug is fixed',
    view: 'View',
  },
};

const JA: ReporterCopy = {
  status: {
    received: '受け付けました',
    reviewing: '確認中',
    reviewing_again: '再確認中',
    fixing: '修正中',
    verified: '修正を確認済み',
    fixed_next: '修正済み — 次のアップデートで反映',
    fixed_version: 'v{version} で修正済み',
    fixed: '修正済み',
    closed: '終了',
    waiting: 'あなたの返信待ち',
  },
  detail: {
    received: '報告を受け取りました。',
    reviewing: '開発者が対応リストに入れました。',
    reviewing_again: 'ありがとうございます。再度確認しています。',
    fixing: '修正に取り組んでいます。',
    verified: '修正を確認いただきありがとうございます！',
    fixed_next: '次のリリースで反映されます。',
    fixed_version: 'v{version} にアップデートしてください。解決しましたか？',
    fixed: '解決しましたか？',
    closed: '終了しました。',
    waiting: '開発者から質問があります。下から返信してください。',
  },
  idea: {
    received: 'アイデアをありがとうございます',
    reviewing: '検討中',
    fixing: '開発中',
    shipped: 'リリース済み',
    shippedVersion: 'v{version} でリリース済み',
  },
  closedReason: {
    duplicate: '以前の報告と同じ内容です。そちらで進捗をお知らせします。',
    not_reproducible: '再現できませんでした。再発したら返信してください。',
    wont_fix: 'この点は変更しないことにしました。',
    working_as_intended: 'これは想定どおりの動作です。',
    none: '終了しました。',
  },
  others: {
    few: 'あなたを含め数人が報告しています',
    many: '多くの人が報告しています',
  },
  timeline: {
    received: 'あなたが報告しました',
    reviewing: '開発者が確認しています',
    duplicate_linked: '既存の報告と同じ内容です。そちらで進捗をお知らせします',
    info_requested: '開発者からの質問: {text}',
    reporter_comment: 'あなた',
    fix_started: '修正中です',
    fixed: '修正済み — 次のアップデートで反映',
    released: 'v{version} でリリース — アップデートしてください',
    verified: '修正を確認しました',
    reopened: '再オープンしました',
  },
  categories: {
    bug: 'バグ',
    slow: '遅い',
    visual: '表示がおかしい',
    confusing: 'わかりにくい',
    idea: 'アイデア',
  },
  ui: {
    yes: 'はい',
    notYet: 'まだ',
    empty: 'まだありません。報告するとここに進捗が表示されます。',
    loadError: '更新を読み込めませんでした',
    retry: '再試行',
    sending: '送信中…',
    sent: '送信しました',
    sendFailed: '送信失敗',
    noReplies: '開発者からの返信はまだありません。',
    you: 'あなた',
    developer: '開発者',
    addWords: 'もう少し詳しく書いてください',
    developerReplied: '開発者からの返信:「{text}」',
    updates: 'あなたの報告に {n} 件の更新があります',
    receipt: '送信しました。進展があればここでお知らせします。',
    trackIt: '経過を見る',
    done: '閉じる',
    emailOptIn: 'メールで更新を受け取る',
    emailPlaceholder: 'you@example.com',
    emailSubmit: 'メールで受け取る',
    emailCheckInbox: '受信トレイのメールのリンクをタップして確認してください。',
    emailInvalid: 'メールアドレスの形式が正しくありません。',
    emailFailed: 'メール通知を設定できませんでした。後でもう一度お試しください。',
    toastReplied: '開発者があなたの報告に返信しました',
    toastFixed: 'あなたが報告した不具合が修正されました',
    view: '見る',
  },
};

const ES: ReporterCopy = {
  status: {
    received: 'Recibido',
    reviewing: 'Lo estamos revisando',
    reviewing_again: 'Lo revisamos de nuevo',
    fixing: 'Corrección en curso',
    verified: 'Corrección confirmada',
    fixed_next: 'Corregido — llega en la próxima actualización',
    fixed_version: 'Corregido en v{version}',
    fixed: 'Corregido',
    closed: 'Cerrado',
    waiting: 'Esperando tu respuesta',
  },
  detail: {
    received: 'Lo recibimos.',
    reviewing: 'El desarrollador lo tiene en su lista.',
    reviewing_again: 'Gracias, lo reabrimos.',
    fixing: 'Se está trabajando en una corrección.',
    verified: 'Confirmaste la corrección. ¡Gracias!',
    fixed_next: 'Llega en la próxima versión.',
    fixed_version: 'Actualiza a v{version}. ¿Ya funciona?',
    fixed: '¿Ya funciona?',
    closed: 'Cerrado.',
    waiting: 'El desarrollador hizo una pregunta: responde abajo.',
  },
  idea: {
    received: 'Gracias por la idea',
    reviewing: 'En consideración',
    fixing: 'En desarrollo',
    shipped: 'Publicado',
    shippedVersion: 'Publicado en v{version}',
  },
  closedReason: {
    duplicate: 'Es igual a un reporte anterior; te avisaremos allí.',
    not_reproducible: 'No pudimos reproducirlo. Responde si vuelve a pasar.',
    wont_fix: 'Decidimos no cambiar esto.',
    working_as_intended: 'Este es el comportamiento esperado.',
    none: 'Cerrado.',
  },
  others: {
    few: 'Tú y algunas personas más reportaron esto',
    many: 'Muchas personas reportaron esto',
  },
  timeline: {
    received: 'Reportaste esto',
    reviewing: 'El desarrollador lo está revisando',
    duplicate_linked: 'Es igual a un reporte existente; te avisaremos allí',
    info_requested: 'El desarrollador preguntó: {text}',
    reporter_comment: 'Tú',
    fix_started: 'Hay una corrección en curso',
    fixed: 'Corregido — llega en la próxima actualización',
    released: 'Publicado en v{version}: actualiza para tenerlo',
    verified: 'Confirmaste que está corregido',
    reopened: 'Reabierto',
  },
  categories: {
    bug: 'Error',
    slow: 'Lento',
    visual: 'Se ve mal',
    confusing: 'Confuso',
    idea: 'Idea',
  },
  ui: {
    yes: 'Sí',
    notYet: 'Todavía no',
    empty: 'Nada todavía: tus reportes aparecerán aquí con novedades.',
    loadError: 'No se pudieron cargar las novedades',
    retry: 'Reintentar',
    sending: 'Enviando…',
    sent: 'Enviado',
    sendFailed: 'Error al enviar',
    noReplies: 'El desarrollador aún no ha respondido.',
    you: 'Tú',
    developer: 'Desarrollador',
    addWords: 'Agrega algunas palabras',
    developerReplied: 'El desarrollador respondió: “{text}”',
    updates: '{n} novedades en tus reportes',
    receipt: 'Enviado. Te avisaremos aquí cuando haya novedades.',
    trackIt: 'Seguirlo',
    done: 'Listo',
    emailOptIn: 'Recibir novedades por correo',
    emailPlaceholder: 'tu@ejemplo.com',
    emailSubmit: 'Enviarme novedades',
    emailCheckInbox: 'Revisa tu correo y toca el enlace para confirmar.',
    emailInvalid: 'Eso no parece un correo electrónico.',
    emailFailed: 'No pudimos activar las novedades por correo. Inténtalo más tarde.',
    toastReplied: 'El desarrollador respondió a tu reporte',
    toastFixed: 'Tu error está corregido',
    view: 'Ver',
  },
};

const TH: ReporterCopy = {
  status: {
    received: 'ได้รับแล้ว',
    reviewing: 'กำลังตรวจสอบ',
    reviewing_again: 'กำลังตรวจสอบอีกครั้ง',
    fixing: 'กำลังแก้ไข',
    verified: 'ยืนยันว่าแก้แล้ว',
    fixed_next: 'แก้แล้ว — จะมาในอัปเดตถัดไป',
    fixed_version: 'แก้แล้วใน v{version}',
    fixed: 'แก้แล้ว',
    closed: 'ปิดแล้ว',
    waiting: 'รอคำตอบจากคุณ',
  },
  detail: {
    received: 'เราได้รับรายงานแล้ว',
    reviewing: 'นักพัฒนาใส่ไว้ในรายการแล้ว',
    reviewing_again: 'ขอบคุณ — เราเปิดเรื่องนี้อีกครั้งแล้ว',
    fixing: 'กำลังดำเนินการแก้ไข',
    verified: 'คุณยืนยันการแก้ไขแล้ว ขอบคุณ!',
    fixed_next: 'จะมาในรุ่นถัดไป',
    fixed_version: 'อัปเดตเป็น v{version} ตอนนี้ใช้ได้หรือยัง?',
    fixed: 'ตอนนี้ใช้ได้หรือยัง?',
    closed: 'ปิดแล้ว',
    waiting: 'นักพัฒนามีคำถาม — ตอบด้านล่าง',
  },
  idea: {
    received: 'ขอบคุณสำหรับไอเดีย',
    reviewing: 'กำลังพิจารณา',
    fixing: 'กำลังสร้าง',
    shipped: 'เปิดใช้แล้ว',
    shippedVersion: 'เปิดใช้แล้วใน v{version}',
  },
  closedReason: {
    duplicate: 'เหมือนกับรายงานก่อนหน้า — เราจะแจ้งความคืบหน้าที่นั่น',
    not_reproducible: 'เราทำให้เกิดซ้ำไม่ได้ ตอบกลับหากเกิดขึ้นอีก',
    wont_fix: 'เราตัดสินใจไม่เปลี่ยนส่วนนี้',
    working_as_intended: 'นี่เป็นการทำงานตามที่ตั้งใจไว้',
    none: 'ปิดแล้ว',
  },
  others: {
    few: 'คุณและอีกไม่กี่คนรายงานเรื่องนี้',
    many: 'มีหลายคนรายงานเรื่องนี้',
  },
  timeline: {
    received: 'คุณรายงานเรื่องนี้',
    reviewing: 'นักพัฒนากำลังตรวจสอบ',
    duplicate_linked: 'เหมือนกับรายงานที่มีอยู่ — เราจะแจ้งความคืบหน้าที่นั่น',
    info_requested: 'นักพัฒนาถามว่า: {text}',
    reporter_comment: 'คุณ',
    fix_started: 'กำลังแก้ไข',
    fixed: 'แก้แล้ว — จะมาในอัปเดตถัดไป',
    released: 'เปิดใช้ใน v{version} — อัปเดตเพื่อรับการแก้ไข',
    verified: 'คุณยืนยันว่าแก้แล้ว',
    reopened: 'เปิดอีกครั้ง',
  },
  categories: {
    bug: 'บั๊ก',
    slow: 'ช้า',
    visual: 'แสดงผลผิด',
    confusing: 'สับสน',
    idea: 'ไอเดีย',
  },
  ui: {
    yes: 'ใช่',
    notYet: 'ยังไม่',
    empty: 'ยังไม่มี — รายงานของคุณจะแสดงที่นี่พร้อมความคืบหน้า',
    loadError: 'โหลดความคืบหน้าไม่ได้',
    retry: 'ลองอีกครั้ง',
    sending: 'กำลังส่ง…',
    sent: 'ส่งแล้ว',
    sendFailed: 'ส่งไม่สำเร็จ',
    noReplies: 'ยังไม่มีคำตอบจากนักพัฒนา',
    you: 'คุณ',
    developer: 'นักพัฒนา',
    addWords: 'เพิ่มรายละเอียดอีกเล็กน้อย',
    developerReplied: 'นักพัฒนาตอบว่า: “{text}”',
    updates: 'มีความคืบหน้า {n} รายการในรายงานของคุณ',
    receipt: 'ส่งแล้ว เราจะแจ้งคุณที่นี่เมื่อมีความคืบหน้า',
    trackIt: 'ติดตาม',
    done: 'เสร็จ',
    emailOptIn: 'รับความคืบหน้าทางอีเมล',
    emailPlaceholder: 'you@example.com',
    emailSubmit: 'ส่งความคืบหน้าทางอีเมล',
    emailCheckInbox: 'ตรวจสอบกล่องจดหมายแล้วแตะลิงก์เพื่อยืนยัน',
    emailInvalid: 'ดูเหมือนจะไม่ใช่อีเมลที่ถูกต้อง',
    emailFailed: 'ตั้งค่าการแจ้งทางอีเมลไม่สำเร็จ ลองใหม่ภายหลัง',
    toastReplied: 'นักพัฒนาตอบกลับรายงานของคุณแล้ว',
    toastFixed: 'บั๊กที่คุณรายงานได้รับการแก้ไขแล้ว',
    view: 'ดู',
  },
};

const COPY: Record<ReporterLocale, ReporterCopy> = { en: EN, ja: JA, es: ES, th: TH };

/** Resolve a BCP-47 tag (`ja-JP`, `es-419`) to a supported locale; English otherwise. */
export function resolveReporterLocale(tag: string | null | undefined): ReporterLocale {
  const base = (tag ?? '').toLowerCase().split(/[-_]/)[0];
  return (REPORTER_LOCALES as readonly string[]).includes(base) ? (base as ReporterLocale) : 'en';
}

/** The full copy table for a locale (unknown tags fall back to English). */
export function reporterCopy(locale: string = 'en'): ReporterCopy {
  return COPY[resolveReporterLocale(locale)];
}

/** Replace `{name}` placeholders; a missing value leaves an empty string. */
export function fillReporterTemplate(
  template: string,
  params: Record<string, string | number | null | undefined> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    return value === null || value === undefined ? '' : String(value);
  });
}

/** Fields of a reporter-list row `reporterStatus` reads. All but `status` are optional. */
export interface ReporterStatusInput {
  status: string;
  /** True (or a timestamp) while the developer waits for the reporter. */
  awaiting_reporter?: boolean | null;
  awaiting_reporter_at?: string | null;
  fixed_in_version?: string | null;
  closed_reason?: string | null;
  /** Bucketed duplicate count; never a raw number. */
  group_bucket?: 'none' | 'few' | 'many' | null;
  /** `user_category`; "Feature request" / "idea" selects the idea labels. */
  user_category?: string | null;
}

export interface ReporterStatusView {
  key: ReporterStatusKey;
  label: string;
  tone: ReporterTone;
  detail: string;
  /** Show the Yes / Not yet verification buttons. */
  canVerify: boolean;
  /** "You and a few others reported this", or null. */
  othersNote: string | null;
  /** `closed_reason = 'spam'`: hide the report from the reporter entirely. */
  hidden: boolean;
}

const OPEN_KEYS: ReadonlySet<ReporterStatusKey> = new Set([
  'received',
  'reviewing',
  'reviewing_again',
  'fixing',
]);

function isCanonical(status: string): status is ReporterCanonicalStatus {
  return (REPORTER_CANONICAL_STATUSES as readonly string[]).includes(status);
}

/** True when the row is a feature request rather than a bug. */
export function isReporterIdea(input: Pick<ReporterStatusInput, 'user_category'>): boolean {
  const cat = (input.user_category ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  // The web widget and the ingest path send 'feature'; older clients sent
  // 'Feature request'. The server's isFeatureRequest() accepts the same set.
  return cat === 'feature' || cat === 'feature_request' || cat === 'idea';
}

/**
 * The end-user view of a report. Overlays are checked before the base
 * status: "Waiting on you" wins for any open report, and the duplicate-group
 * note is added on top of whatever the base state is.
 */
export function reporterStatus(input: ReporterStatusInput, locale: string = 'en'): ReporterStatusView {
  const copy = reporterCopy(locale);
  const status = (input.status ?? '').trim();
  // No raw passthrough: anything the table does not know reads as Received.
  let key: ReporterStatusKey = isCanonical(status) ? BASE_STATE[status] : 'received';

  const version = input.fixed_in_version?.trim() || null;
  if ((status === 'fixed' || status === 'resolved') && version) key = 'fixed_version';

  const awaiting = Boolean(input.awaiting_reporter) || Boolean(input.awaiting_reporter_at);
  if (awaiting && OPEN_KEYS.has(key)) key = 'waiting';

  const idea = isReporterIdea(input);
  let label = copy.status[key];
  let detail = copy.detail[key];
  if (idea) {
    if (key === 'received') label = copy.idea.received;
    else if (key === 'reviewing' || key === 'reviewing_again') label = copy.idea.reviewing;
    else if (key === 'fixing') label = copy.idea.fixing;
    else if (key === 'fixed_version') label = copy.idea.shippedVersion;
    else if (key === 'fixed_next' || key === 'fixed') label = copy.idea.shipped;
  }

  const reason = input.closed_reason ?? null;
  if (key === 'closed') {
    detail =
      reason && reason !== 'spam' && reason in copy.closedReason
        ? copy.closedReason[reason as keyof ReporterCopy['closedReason']]
        : copy.closedReason.none;
  }

  const bucket = input.group_bucket ?? 'none';
  const othersNote =
    OPEN_KEYS.has(key) || key === 'waiting'
      ? bucket === 'few'
        ? copy.others.few
        : bucket === 'many'
          ? copy.others.many
          : null
      : null;

  return {
    key,
    label: fillReporterTemplate(label, { version }),
    tone: TONE[key],
    detail: fillReporterTemplate(detail, { version }),
    canVerify: key === 'fixed_next' || key === 'fixed_version' || key === 'fixed',
    othersNote,
    hidden: key === 'closed' && reason === 'spam',
  };
}

/** Parameters a timeline template may interpolate. */
export interface ReporterTimelineParams {
  /** Verbatim developer text for `comment` and `info_requested`; the reporter's own for `reporter_comment`. */
  text?: string | null;
  version?: string | null;
  closed_reason?: string | null;
}

/**
 * Render one timeline entry. Pipeline kinds always come from the template for
 * their kind; only the developer's own words (`comment`, `info_requested`) are
 * passed through, verbatim.
 */
export function reporterTimelineText(
  kind: ReporterTimelineKind,
  params: ReporterTimelineParams = {},
  locale: string = 'en',
): string {
  const copy = reporterCopy(locale);
  if (kind === 'comment') return params.text ?? '';
  if (kind === 'closed') {
    const reason = params.closed_reason ?? '';
    return reason && reason !== 'spam' && reason in copy.closedReason
      ? copy.closedReason[reason as keyof ReporterCopy['closedReason']]
      : copy.closedReason.none;
  }
  if (kind === 'reporter_comment') return params.text ?? copy.timeline.reporter_comment;
  return fillReporterTemplate(copy.timeline[kind], { text: params.text, version: params.version });
}

/** Reporter-facing label for a category chip. */
export function reporterCategoryLabel(category: ReporterCategory, locale: string = 'en'): string {
  return reporterCopy(locale).categories[category];
}

// ---------------------------------------------------------------------------
// Widget rules shared by web and React Native (Plan 018 §1.1, §2.3, §4.2)
// ---------------------------------------------------------------------------

/** A few words are enough; an attachment speaks for itself (§1.1). */
export const REPORTER_MIN_DESCRIPTION = 8;

/** Characters Send needs: `min` (default 8), or 0 with a screenshot / element attached. */
export function reporterRequiredLength(min: number | undefined, hasAttachment: boolean): number {
  if (hasAttachment) return 0;
  return typeof min === 'number' && Number.isFinite(min) && min >= 0 ? Math.floor(min) : REPORTER_MIN_DESCRIPTION;
}

/** Whether Send is enabled: some text or an attachment, and enough words. */
export function reporterCanSend(text: string, hasAttachment: boolean, min?: number): boolean {
  const trimmed = text.trim();
  if (!trimmed && !hasAttachment) return false;
  return trimmed.length >= reporterRequiredLength(min, hasAttachment);
}

/** Wire category for an optional chip: none → `other` (triage sets the type); Idea → a feature request. */
export function reporterChipToReport(
  chip: ReporterCategory | null,
): { category: 'bug' | 'slow' | 'visual' | 'confusing' | 'other'; userCategory?: string } {
  if (!chip) return { category: 'other' };
  if (chip === 'idea') return { category: 'other', userCategory: 'feature' };
  return { category: chip };
}

/** One entry of `GET /v1/reporter/reports/:id` → `timeline` (subset the widgets read). */
export interface ReporterTimelineEntry {
  kind: string;
  text: string;
  /** Developer- or project-written text: show `text` as is. */
  custom?: boolean;
  body?: string;
  version?: string;
  closed_reason?: string;
}

/** True for the people talking (developer / reporter), false for pipeline events. */
export function isReporterConversation(entry: Pick<ReporterTimelineEntry, 'kind'>): boolean {
  return entry.kind === 'comment' || entry.kind === 'reporter_comment' || entry.kind === 'info_requested';
}

/** Text for one timeline entry in the reporter's locale; custom wording is shown as is. */
export function reporterTimelineEntryText(entry: ReporterTimelineEntry, locale: string = 'en'): string {
  if (entry.custom || !(REPORTER_TIMELINE_KINDS as readonly string[]).includes(entry.kind)) return entry.text;
  return reporterTimelineText(
    entry.kind as ReporterTimelineKind,
    { text: entry.body ?? null, version: entry.version ?? null, closed_reason: entry.closed_reason ?? null },
    locale,
  );
}

export const REPORTER_TOAST_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** The next-visit toast: one per session and at most one a day, only with something unread (§4.2). */
export function reporterShouldShowToast(input: {
  enabled: boolean;
  unreadTotal: number;
  shownThisSession: boolean;
  lastShownAt: number | null;
  now: number;
}): boolean {
  if (!input.enabled || input.unreadTotal <= 0 || input.shownThisSession) return false;
  return input.lastShownAt === null || input.now - input.lastShownAt >= REPORTER_TOAST_INTERVAL_MS;
}

/** "The developer replied…", "Your bug is fixed", or "3 updates on your reports". */
export function reporterToastMessage(
  updates: { unread_total: number; latest: Array<{ kind: string | null }> },
  locale: string = 'en',
): string {
  const ui = reporterCopy(locale).ui;
  const kind = updates.unread_total === 1 ? updates.latest[0]?.kind : null;
  if (kind === 'comment' || kind === 'info_requested') return ui.toastReplied;
  if (kind === 'fixed' || kind === 'released') return ui.toastFixed;
  return ui.updates.replace('{n}', String(updates.unread_total));
}

/** A typo screen for the email opt-in box; the server validates the address. */
export function isPlausibleReporterEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim());
}

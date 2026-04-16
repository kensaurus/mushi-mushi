import type { MushiLocale } from './types';

export const ja: MushiLocale = {
  widget: {
    trigger: '問題を報告',
    title: '問題を報告する',
    close: '閉じる',
    back: '戻る',
    submit: '送信',
    submitting: '送信中…',
    submitted: 'ありがとうございます！レポートが送信されました。',
    error: 'エラーが発生しました。もう一度お試しください。',
  },
  step1: {
    heading: 'どのような問題ですか？',
    categories: {
      bug: 'バグ',
      slow: '遅い・重い',
      visual: '表示の問題',
      confusing: 'わかりにくい',
      other: 'その他',
    },
    categoryDescriptions: {
      bug: '動作しない、壊れている',
      slow: 'パフォーマンスが悪い、読み込みが遅い',
      visual: 'レイアウト、デザイン、表示の問題',
      confusing: '理解しにくい、操作がわかりにくい',
      other: 'その他の問題',
    },
  },
  step2: {
    heading: '何が起きましたか？',
    intents: {
      bug: ['クラッシュ', '無反応', 'データ消失', '誤った結果', 'その他'],
      slow: ['ページ読込', '操作反応', 'API通信', 'アニメーション', 'その他'],
      visual: ['レイアウト崩れ', '要素の重なり', '要素が表示されない', '色/フォントが違う', 'その他'],
      confusing: ['ラベルが不明瞭', 'ヘルプがない', '予想外のフロー', 'ナビゲーション迷子', 'その他'],
      other: ['機能要望', 'アクセシビリティ', '誤字脱字', 'その他'],
    },
  },
  step3: {
    heading: '詳細を教えてください',
    descriptionPlaceholder: '何が起きたか説明してください…',
    screenshotButton: 'スクリーンショット添付',
    screenshotAttached: 'スクリーンショット添付済み',
    elementButton: '要素を選択',
    elementSelected: '要素選択済み',
    optional: '（任意）',
  },
};

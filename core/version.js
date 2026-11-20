// App version and the «وش الجديد» list shown to users. Newest first; RELEASES[0].v is the
// current version. Keep descriptions simple and non-technical (the user reads them).
export const RELEASES = [
  {
    v: '1.6', date: '2026-11-20',
    ar: ['«مصروفك اليومي»: كم تقدر تصرف كل يوم لين آخر الشهر', 'مصاريف ثابتة تُسجَّل تلقائياً كل شهر، وتقدر تخلي الشهر يبدأ يوم الراتب', 'تقارير آخر 6 أشهر وتصدير الحركات إلى Excel', 'زر «تراجع» بعد الحذف، والحركات مجمّعة باليوم مع بحث وفلتر', 'على الكمبيوتر: نافذة التسجيل في الوسط، واختيار الشهر من شبكة، واختصار N، والرئيسية صارت ملخصاً'],
    en: ['“Daily allowance”: how much you can spend each day until the month ends', 'Fixed expenses logged automatically every month, and months that can start on payday', 'Reports for the last 6 months and export of your transactions to Excel', '“Undo” after deleting, and transactions grouped by day with search and filters', 'On computers: a centred log dialog, a month grid, the N shortcut, and a summary on the home page'],
  },
  {
    v: '1.5', date: '2026-11-19',
    ar: ['على الكمبيوتر: المصاريف كلها في لوحة واحدة بدون تبويبات (الباقي، البنود، الحركات، الأقساط)', 'شريط يوضح كم صرفت من دخلك وكم مضى من الشهر', 'زرّا «سجّل صرف» و«عدّل الميزانية» في أعلى الصفحة، وقائمة جانبية أنحف'],
    en: ['On computers: all of Expenses on one board, no tabs (remaining, categories, transactions, installments)', 'A bar showing how much of your income you’ve spent and how much of the month has passed', '“Log spending” and “Edit budget” at the top, and a slimmer side menu'],
  },
  {
    v: '1.4', date: '2026-11-15',
    ar: ['كلام النماذج صار أوضح وأسهل في القراءة', 'خانة للاسم وخانة لطريقة التواصل في «راسلنا»', 'تقدر تشوف وش الجديد في كل تحديث'],
    en: ['Form text is clearer and easier to read', 'Separate name and contact fields in “Contact us”', 'See what’s new after every update'],
  },
  {
    v: '1.3', date: '2026-11-15',
    ar: ['تقدر ترسل لنا طلب أداة أو بلاغ عن مشكلة أو اقتراح من الصفحة الرئيسية'],
    en: ['Send us a tool request, a bug report or a suggestion from the home screen'],
  },
  {
    v: '1.2', date: '2026-11-15',
    ar: ['في الأقساط: اكتب القسط الشهري وعدد الأشهر، والتطبيق يحسب المجموع'],
    en: ['Installments: enter the monthly payment and the months — the total is worked out for you'],
  },
  {
    v: '1.1', date: '2026-11-15',
    ar: ['زر «المبلغ كامل» يعبي لك الباقي من البند بضغطة'],
    en: ['“Full amount” fills in what’s left of a category in one tap'],
  },
  {
    v: '1.0', date: '2026-11-15',
    ar: ['أول إصدار: المصاريف الشهرية، الأقساط، والمزامنة بين أجهزتك'],
    en: ['First release: monthly expenses, installments and sync across your devices'],
  },
];

export const APP_VERSION = RELEASES[0].v;

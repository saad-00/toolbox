// Arabic/English i18n. No JSON imports: callers pass locale objects to loadLocales().
let locales = { ar: {}, en: {} };
let lang = 'en';

export function loadLocales(ar, en) { locales = { ar: ar || {}, en: en || {} }; }

export function detectLang(languages) {
  const first = String((languages && languages[0]) || '').toLowerCase();
  return first === 'ar' || first.startsWith('ar-') ? 'ar' : 'en';
}

export function setLang(l) { lang = l === 'ar' ? 'ar' : 'en'; }
export function getLang() { return lang; }
export function dir(l) { return l === 'ar' ? 'rtl' : 'ltr'; }

export function t(key, vars) {
  const s = locales[lang] && locales[lang][key];
  if (typeof s !== 'string') return key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function monthName(month, l) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const loc = l === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-US';
  return new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' }).format(d);
}

const DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

// Parses a user-typed amount (latin or Arabic-Indic digits) into integer halalas.
export function parseAmount(input) {
  const s = String(input ?? '')
    .trim()
    .replace(/[٠-٩]/g, (d) => DIGITS[d])
    .replace(/٬/g, ',')
    .replace(/٫/g, '.');
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(s)) throw new Error('invalid-amount');
  const halalas = Math.round(parseFloat(s.replace(/,/g, '')) * 100);
  if (!Number.isSafeInteger(halalas) || halalas <= 0) throw new Error('invalid-amount');
  return halalas;
}

const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

// Formats integer halalas with latin digits for both languages.
export function formatAmount(halalas, lang) {
  return fmt.format(halalas / 100);
}

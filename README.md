# أدواتي (Toolbox)

## العربية

**أدواتي** تطبيق ويب (PWA) خفيف بلا بناء، يجمع أدواتك الشخصية في مكان واحد. أول أداة فيه: **المصروف الشخصي** (دخل، ميزانية، تسجيل صرف، أقساط). يعمل بدون إنترنت بعد أول تحميل.

**الرابط:** https://saad-00.github.io/toolbox/

### وضع محلي ووضع مزامنة

- **محلي:** البيانات تبقى على هذا الجهاز فقط (IndexedDB). لا حساب ولا مفاتيح.
- **مزامنة:** تُشفَّر البيانات على جهازك (AES-GCM 256، والمفتاح من كلمة السر عبر PBKDF2-SHA256 بـ 600000 تكرار) ثم تُرفع كملف واحد `toolbox.enc.json` إلى مستودع GitHub **خاص**. هكذا تتطابق بياناتك بين الجوال والكمبيوتر.

### إعداد المزامنة (مرة واحدة)

1. أنشئ مستودعاً **خاصاً (Private)** باسم `saad-00/toolbox-data` على GitHub.
2. من GitHub: Settings ← Developer settings ← Personal access tokens ← **Fine-grained tokens** ← Generate new token.
3. اجعل **Resource owner** = حسابك (`saad-00`)، و**Repository access** = Only select repositories ← `toolbox-data` وحده.
4. في **Permissions** ← Repository permissions ← **Contents: Read and write**.
5. في مدة الانتهاء اختر **Expiration ← Custom** ثم حدّد تاريخاً **بعد سنة من اليوم** (لا يوجد خيار جاهز «سنة»)، ثم انسخ المفتاح.
6. افتح التطبيق ← **الإعدادات**، والصق المفتاح واكتب **كلمة السر** (مرة واحدة على كل جهاز). المفتاح وكلمة السر يُحفظان على هذا الجهاز فقط، ولا يُرفعان أبداً.

> **تحذير:** إذا نسيت كلمة السر فلن يمكن فك تشفير النسخة المرفوعة ولا استرجاعها. احتفظ بنسخة احتياطية (من الإعدادات) وبكلمة السر في مكان آمن.

### التثبيت على الجوال

- **iPhone (Safari):** افتح الرابط ← زر المشاركة ← **إضافة إلى الشاشة الرئيسية**.
- **Android (Chrome):** افتح الرابط ← قائمة ⋮ ← **تثبيت التطبيق** (أو إضافة إلى الشاشة الرئيسية).

### للمطورين

```
npm install
npm test                 # اختبارات الوحدات (node --test)
npx playwright test      # اختبارات e2e؛ متغير PW_CHROME يحدد مسار متصفح Chromium
```

الهيكل:

- `index.html`, `manifest.webmanifest`, `sw.js`, `tools.json`: الواجهة والـ PWA وقائمة الأدوات.
- `core/`: النواة (التخزين، التشفير، المزامنة، الدمج، اللغات، الثيم، الإعدادات).
- `tools/expenses/`: أداة المصروف الشخصي.
- `onboarding/`: شاشة الترحيب لأول تشغيل.
- `fonts/`, `icons/`: الخطوط والأيقونات.
- `tests/`: اختبارات الوحدات، و`tests/e2e/` اختبارات Playwright.

**النشر:** يتم بدفع فرع `main` مع تفعيل GitHub Pages على الجذر (root). عند تغيير ملفات الواجهة ارفع `VERSION` في `sw.js`.

---

## English

**Toolbox** is a lightweight, no-build PWA that gathers your personal tools in one place. The first tool is **Personal expenses** (income, budget, quick spending log, installments). It works offline after the first load.

**Live:** https://saad-00.github.io/toolbox/

### Local mode vs sync mode

- **Local:** data stays on this device only (IndexedDB). No account, no keys.
- **Sync:** data is encrypted on your device (AES-GCM 256, key derived from your passphrase with PBKDF2-SHA256, 600,000 iterations) and uploaded as a single file, `toolbox.enc.json`, to a **private** GitHub repo so your phone and computer stay in step.

### Setting up sync (once)

1. Create a **private** repository named `saad-00/toolbox-data` on GitHub.
2. GitHub: Settings > Developer settings > Personal access tokens > **Fine-grained tokens** > Generate new token.
3. **Resource owner:** your account (`saad-00`). **Repository access:** Only select repositories > `toolbox-data` only.
4. **Permissions** > Repository permissions > **Contents: Read and write**.
5. For **Expiration** choose **Custom** and pick the date **one year from today** (there is no "1 year" preset), then copy the token.
6. Open the app > **Settings**, paste the token and enter your **passphrase** (once per device). The token and the passphrase are stored on this device only and are never uploaded.

> **Warning:** if you forget the passphrase, the synced copy cannot be decrypted or recovered. Keep a backup (from Settings) and store the passphrase somewhere safe.

### Install on your phone

- **iPhone (Safari):** open the link > Share > **Add to Home Screen**.
- **Android (Chrome):** open the link > menu ⋮ > **Install app** (or Add to Home screen).

### For developers

```
npm install
npm test                 # unit tests (node --test)
npx playwright test      # e2e tests; set PW_CHROME to the Chromium binary path
```

Structure: `index.html` / `manifest.webmanifest` / `sw.js` / `tools.json` (shell, PWA, tool list); `core/` (store, crypto, sync, merge, i18n, theme, settings); `tools/expenses/` (the expenses tool); `onboarding/` (first-run welcome); `fonts/`, `icons/`; `tests/` (unit) and `tests/e2e/` (Playwright).

**Deploying** = pushing `main` with GitHub Pages enabled on the root. Bump `VERSION` in `sw.js` whenever shell files change.

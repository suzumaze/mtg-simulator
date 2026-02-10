// i18n module — locale loading and text lookup

let currentLocale = {};
let fallbackLocale = {};
let currentLang = 'ja';

export function t(key) {
  const keys = key.split('.');
  let val = currentLocale;
  for (const k of keys) {
    if (val && typeof val === 'object') val = val[k];
    else { val = undefined; break; }
  }
  if (val !== undefined && typeof val === 'string') return val;

  // Fallback to Japanese
  val = fallbackLocale;
  for (const k of keys) {
    if (val && typeof val === 'object') val = val[k];
    else { val = undefined; break; }
  }
  return (val !== undefined && typeof val === 'string') ? val : key;
}

export function getLocale() {
  return currentLang;
}

export async function setLocale(lang) {
  const resp = await fetch(`locales/${lang}.json`);
  if (!resp.ok) throw new Error(`Failed to load locale: ${lang}`);
  const data = await resp.json();
  currentLocale = data;
  currentLang = lang;

  // Load fallback if not Japanese
  if (lang !== 'ja' && Object.keys(fallbackLocale).length === 0) {
    const fbResp = await fetch('locales/ja.json');
    if (fbResp.ok) fallbackLocale = await fbResp.json();
  }
  if (lang === 'ja') fallbackLocale = data;
}

export function tf(key, params = {}) {
  let text = t(key);
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(`{${k}}`, v);
  }
  return text;
}

export function applyI18nToDOM() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  }
}

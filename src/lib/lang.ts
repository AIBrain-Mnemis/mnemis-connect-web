const STORAGE_KEY = 'cua-bot-web:lang';

export function getLanguage(): 'zh-cn' | 'en' {
  const urlLang = new URLSearchParams(window.location.search).get('lang');
  const lang =
    urlLang || localStorage.getItem(STORAGE_KEY) || navigator.language?.toLowerCase() || 'en';
  return lang.toLowerCase().includes('zh') ? 'zh-cn' : 'en';
}

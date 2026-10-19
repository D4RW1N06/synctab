// Nyelvi támogatás. A nyelvi fájlok: /lang/<kód>.json (beépítettek: public/lang, sajátok: az adatmappa lang almappája).
// Az angol az alap: ami hiányzik egy nyelvből, az angolból pótlódik. A fájl _meta.name mezője a nyelv saját neve,
// a _meta.dir az írásirány ("ltr" vagy "rtl").
//
// Használat: t('kulcs', {param: érték}); a HTML-ben data-i18n / data-i18n-title / data-i18n-placeholder / data-i18n-alt.
(function () {
  const FALLBACK = 'en';
  const STORE_KEY = 'synctab.lang';

  let base = {};
  let dict = {};
  let lang = FALLBACK;
  let meta = { name: 'English', dir: 'ltr' };
  const listeners = [];

  // Szinkron betöltés, hogy a t() az első szkript-futástól elérhető legyen (a nyelvi fájlok pár kB-osak).
  function loadSync(code) {
    if (!/^[A-Za-z0-9_-]{1,16}$/.test(code)) return null;
    try {
      const x = new XMLHttpRequest();
      x.open('GET', '/lang/' + code + '.json', false);
      x.send();
      if (x.status === 200) return JSON.parse(x.responseText);
    } catch (e) {
      /* hiányzó vagy hibás fájl: kihagyjuk */
    }
    return null;
  }

  function readStored() {
    try {
      return localStorage.getItem(STORE_KEY);
    } catch (e) {
      return null;
    }
  }

  // Jelölt nyelvek: a mentett választás, majd a böngésző / telefon nyelvei (pl. "pt-BR" -> "pt-BR", "pt").
  function candidates() {
    const out = [];
    const stored = readStored();
    if (stored) out.push(stored);
    for (const tag of navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']) {
      if (!tag) continue;
      out.push(tag, tag.split('-')[0]);
    }
    return [...new Set(out)];
  }

  function select(code) {
    const data = code === FALLBACK ? base : loadSync(code);
    if (!data) return false;
    dict = data;
    meta = Object.assign({ name: code, dir: 'ltr' }, data._meta || {});
    lang = code;
    return true;
  }

  function t(key, params) {
    let s = dict[key];
    if (s == null) s = base[key];
    if (s == null) return key;
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
    return s;
  }

  function apply(root) {
    root = root || document;
    const each = (attr, fn) => root.querySelectorAll('[' + attr + ']').forEach((el) => fn(el, t(el.getAttribute(attr))));
    each('data-i18n', (el, s) => (el.textContent = s));
    each('data-i18n-title', (el, s) => el.setAttribute('title', s));
    each('data-i18n-placeholder', (el, s) => el.setAttribute('placeholder', s));
    each('data-i18n-alt', (el, s) => el.setAttribute('alt', s));
    document.documentElement.lang = lang;
    document.documentElement.dir = meta.dir === 'rtl' ? 'rtl' : 'ltr';
  }

  function setLang(code) {
    if (!select(code)) return false;
    try {
      localStorage.setItem(STORE_KEY, code);
    } catch (e) {
      /* privát mód: a választás csak az oldal életére szól */
    }
    apply(document);
    listeners.forEach((fn) => fn(lang));
    return true;
  }

  // Egy legördülő lista feltöltése az elérhető nyelvekkel (/api/langs), és a nyelvváltás bekötése.
  function bindSelect(el) {
    fetch('/api/langs')
      .then((r) => r.json())
      .then((langs) => {
        el.innerHTML = '';
        for (const l of langs) el.add(new Option(l.name, l.code));
        el.value = lang;
        if (el.value !== lang) el.value = FALLBACK;
      })
      .catch(() => {});
    el.addEventListener('change', () => setLang(el.value));
    listeners.push((code) => (el.value = code));
  }

  // indulás: angol alap + az első elérhető jelölt
  base = loadSync(FALLBACK) || {};
  dict = base;
  for (const c of candidates()) if (select(c)) break;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => apply(document));
  else apply(document);

  window.t = t;
  window.i18n = { t, apply, setLang, bindSelect, onChange: (fn) => listeners.push(fn), get lang() { return lang; }, get meta() { return meta; } };
})();

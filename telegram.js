// telegram.js — small wrapper around Telegram WebApp API.
// Works even outside Telegram (falls back to "web" mode).

(function(){
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

  function isTelegram(){
    return !!tg;
  }

  function getUser(){
    if (!tg) return null;
    const u = tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user : null;
    return u || null;
  }

  function themeToCSS(){
    if (!tg || !tg.themeParams) return null;
    const p = tg.themeParams;
    // Telegram provides colors; we map lightly if present.
    const css = {};
    if (p.bg_color) css["--bg"] = p.bg_color;
    if (p.text_color) css["--text"] = p.text_color;
    if (p.hint_color) css["--muted"] = p.hint_color;
    if (p.button_color) css["--primary"] = p.button_color;
    if (p.button_text_color) css["--primaryText"] = p.button_text_color;
    return css;
  }

  function applyTheme(){
    const css = themeToCSS();
    if (!css) return false;
    Object.entries(css).forEach(([k,v]) => document.documentElement.style.setProperty(k, v));
    return true;
  }

  function haptic(type){
    try{
      if (!tg || !tg.HapticFeedback) return;
      if (type === "success") tg.HapticFeedback.notificationOccurred("success");
      else if (type === "error") tg.HapticFeedback.notificationOccurred("error");
      else tg.HapticFeedback.impactOccurred(type || "light");
    }catch(e){}
  }

  function share(text){
    const url = "https://t.me/share/url?url=" + encodeURIComponent(location.href) + "&text=" + encodeURIComponent(text || "");
    // In Telegram this opens share sheet; outside just open tab.
    window.open(url, "_blank");
  }

  function ready(){
    try{
      if (!tg) return;
      tg.ready();
      tg.expand();
      tg.setHeaderColor("secondary_bg_color");
    }catch(e){}
  }

  function cloudGet(keys){
    return new Promise((resolve) => {
      if (!tg || !tg.CloudStorage) return resolve(null);
      tg.CloudStorage.getItems(keys, (err, values) => {
        if (err) return resolve(null);
        resolve(values || null);
      });
    });
  }

  function cloudSet(obj){
    return new Promise((resolve) => {
      if (!tg || !tg.CloudStorage) return resolve(false);
      const entries = Object.entries(obj || {});
      if (!entries.length) return resolve(true);
      let pending = entries.length;
      let ok = true;
      entries.forEach(([k,v]) => {
        tg.CloudStorage.setItem(k, String(v), (err) => {
          if (err) ok = false;
          pending -= 1;
          if (pending === 0) resolve(ok);
        });
      });
    });
  }

  window.TG = {
    isTelegram,
    getUser,
    applyTheme,
    haptic,
    share,
    ready,
    cloudGet,
    cloudSet,
    _raw: tg
  };
})();

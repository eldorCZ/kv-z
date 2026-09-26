/* Jiskra: appearance before the first paint (Dodatek 4, V5.4). External file so that the CSP needs no
   inline script. Mirrors resolveTheme/resolveMotion in packages/core/src/ui-prefs.ts. */
(function () {
  var d = document.documentElement;
  var p;
  try {
    p = JSON.parse(window.localStorage.getItem('jiskra.ui') || '{}') || {};
  } catch {
    p = {};
  }
  var mq = function (q) {
    try {
      return window.matchMedia(q).matches;
    } catch {
      return false;
    }
  };
  var theme = p.scheme === 'light' || p.scheme === 'dark' ? p.scheme : mq('(prefers-color-scheme: dark)') ? 'dark' : 'light';
  var motion = p.motion === 'reduce' ? 'reduced' : p.motion === 'full' ? 'full' : mq('(prefers-reduced-motion: reduce)') ? 'reduced' : 'full';
  d.setAttribute('data-theme', theme);
  d.setAttribute('data-motion', motion);
  if (p.font === 'readable') d.setAttribute('data-font', 'readable');
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', theme === 'dark' ? '#0f0b2a' : '#f7f5ff');
})();

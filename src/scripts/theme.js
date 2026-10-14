// Runs in the head before the first paint, including on authentication pages.
(() => {
  const storageKey = 'projects-manager-theme';
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;
  const normalize = (value) =>
    value === 'light' || value === 'dark' ? value : 'system';
  const readPreference = () => {
    try {
      return normalize(localStorage.getItem(storageKey));
    } catch {
      return 'system';
    }
  };
  let preference = readPreference();

  function applyTheme() {
    const dark =
      preference === 'dark' || (preference === 'system' && systemTheme.matches);
    root.classList.toggle('dark', dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
    root.dataset.themePreference = preference;
    document.querySelectorAll('[data-theme-select]').forEach((select) => {
      select.value = preference;
    });
  }
  function bindSelectors() {
    document.querySelectorAll('[data-theme-select]').forEach((select) => {
      if (select.dataset.themeBound) return;
      select.dataset.themeBound = 'true';
      select.addEventListener('change', () => {
        preference = normalize(select.value);
        try {
          if (preference === 'system') localStorage.removeItem(storageKey);
          else localStorage.setItem(storageKey, preference);
        } catch {
          /* The current page still works when storage is unavailable. */
        }
        applyTheme();
      });
    });
    applyTheme();
  }
  applyTheme();
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', bindSelectors, {
      once: true,
    });
  else bindSelectors();
  systemTheme.addEventListener('change', () => {
    if (preference === 'system') applyTheme();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey || event.key === null) {
      preference = readPreference();
      applyTheme();
    }
  });
})();

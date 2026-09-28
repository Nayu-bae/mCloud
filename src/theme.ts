const toggles = Array.from(document.querySelectorAll<HTMLInputElement>('.theme-toggle'));
let savedTheme: string | null = null;
try { savedTheme = localStorage.getItem('mcloud_theme'); } catch { /* Browser storage can be disabled. */ }
const initialTheme = savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

function applyTheme(theme: 'light' | 'dark', save = false) {
  document.documentElement.dataset.theme = theme;
  for (const toggle of toggles) toggle.checked = theme === 'dark';
  if (save) try { localStorage.setItem('mcloud_theme', theme); } catch { /* The selected theme still applies for this page. */ }
}

applyTheme(initialTheme);
for (const toggle of toggles) toggle.addEventListener('change', () => applyTheme(toggle.checked ? 'dark' : 'light', true));
export {};

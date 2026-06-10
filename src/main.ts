import { boot } from './core/Boot';

boot().catch((e) => {
  console.error('[bowling-3d] Boot failed:', e);
  const el = document.getElementById('loading');
  if (el) el.textContent = 'Boot failed: ' + (e?.message ?? e);
});

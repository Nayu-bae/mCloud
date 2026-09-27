// Isolated browser module for public links: no account or folder APIs are used.
export {};
const name = document.querySelector<HTMLElement>('#shared-name')!;
const status = document.querySelector<HTMLElement>('#shared-status')!;
const preview = document.querySelector<HTMLElement>('#shared-preview')!;
const download = document.querySelector<HTMLAnchorElement>('#shared-download')!;
let expiresAt = 0;
function unavailable(message: string) {
  preview.replaceChildren(); download.hidden = true; download.removeAttribute('href');
  name.textContent = 'Link unavailable'; status.textContent = message;
}
function expireWhenDue() {
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) { unavailable('This share link has expired. Ask the owner for a new link.'); return; }
  setTimeout(expireWhenDue, Math.min(remaining, 2_000_000_000));
}
async function load() {
  const token = location.pathname.split('/')[2] || '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { unavailable('This link is invalid or unavailable.'); return; }
  const base = `/s/${token}`;
  try {
    const response = await fetch(`${base}/info`);
    if (!response.ok) { unavailable('This link has expired, was revoked, or is unavailable.'); return; }
    const info = await response.json();
    expiresAt = info.expiresAt;
    if (expiresAt <= Date.now()) { unavailable('This share link has expired.'); return; }
    name.textContent = info.name;
    status.textContent = `Available until ${new Date(expiresAt).toLocaleString()}.`;
    download.href = `${base}/download`; download.hidden = false;
    const url = `${base}/content`;
    if (info.kind === 'text' && !info.textTooLarge) {
      const textResponse = await fetch(url);
      if (!textResponse.ok) { unavailable('This link has expired, was revoked, or is unavailable.'); return; }
      const pre = document.createElement('pre'); pre.textContent = await textResponse.text(); preview.append(pre);
    } else if (info.kind === 'image') {
      const img = document.createElement('img'); img.alt = info.name; img.src = url;
      img.addEventListener('error', () => { preview.textContent = 'Preview unavailable. The link may have expired or the file may not be supported.'; }); preview.append(img);
    } else if (info.kind === 'video' || info.kind === 'audio') {
      const media = document.createElement(info.kind === 'video' ? 'video' : 'audio'); media.controls = true; media.src = url; media.preload = 'metadata';
      media.addEventListener('error', () => { preview.textContent = 'Preview unavailable. Your browser may not support this file.'; }); preview.append(media);
    } else if (info.kind === 'pdf') {
      const frame = document.createElement('iframe'); frame.title = info.name; frame.src = url; preview.append(frame);
    } else { preview.textContent = 'A browser preview is unavailable for this file. You can download it while the link is active.'; }
    expireWhenDue();
  } catch { unavailable('Could not load this shared file. Please try again.'); }
}
void load();

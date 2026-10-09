// Isolated browser module for public links: no account or folder APIs are used.
export {};
const name = document.querySelector<HTMLElement>('#shared-name')!;
const status = document.querySelector<HTMLElement>('#shared-status')!;
type LucideBrowser = { createIcons: (options?: { attrs?: Record<string, string> }) => void };
const refreshIcons = () => (window as unknown as { lucide?: LucideBrowser }).lucide?.createIcons({ attrs: { 'stroke-width': '2' } });
const preview = document.querySelector<HTMLElement>('#shared-preview')!;
const download = document.querySelector<HTMLAnchorElement>('#shared-download')!;
const fileView = document.querySelector<HTMLElement>('#shared-file-view')!;
const folderView = document.querySelector<HTMLElement>('#shared-folder-view')!;
const folderPath = document.querySelector<HTMLElement>('#shared-folder-path')!;
const folderGrid = document.querySelector<HTMLElement>('#shared-folder-grid')!;
const folderMessage = document.querySelector<HTMLElement>('#shared-folder-message')!;
const uploadInput = document.querySelector<HTMLInputElement>('#shared-upload-input')!;
const folderDialog = document.querySelector<HTMLDialogElement>('#shared-folder-dialog')!;
const newFolderForm = document.querySelector<HTMLFormElement>('#shared-new-folder-form')!;
const newFolderName = document.querySelector<HTMLInputElement>('#shared-new-folder-name')!;
let expiresAt = 0;
let token = '';
let currentFolderId = 0;
let maxUploadBytes = 100 * 1024 * 1024;
function unavailable(message: string) {
  preview.replaceChildren(); download.hidden = true; download.removeAttribute('href');
  name.textContent = 'Link unavailable'; status.textContent = message;
}
function expireWhenDue() {
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) { unavailable('This share link has expired. Ask the owner for a new link.'); return; }
  setTimeout(expireWhenDue, Math.min(remaining, 2_000_000_000));
}
const sizeLabel = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
async function errorMessage(response: Response, fallback: string) {
  try { const result = await response.json(); return typeof result.error === 'string' ? result.error : fallback; }
  catch { return fallback; }
}
async function loadFolder(folderId?: number) {
  const base = `/s/${token}`;
  const response = await fetch(`${base}/folders${folderId ? `?folderId=${folderId}` : ''}`);
  if (!response.ok) { unavailable('This folder link has expired, was revoked, or is unavailable.'); return; }
  const result = await response.json();
  expiresAt = result.expiresAt; maxUploadBytes = result.maxUploadBytes; currentFolderId = result.folder.id;
  name.textContent = result.path[0].name;
  status.textContent = `Upload access available until ${new Date(expiresAt).toLocaleString()}. Only this shared folder and its contents are visible.`;
  folderPath.replaceChildren();
  for (const [index, folder] of result.path.entries()) {
    if (index) folderPath.append(document.createTextNode(' / '));
    const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button'; button.textContent = folder.name;
    button.addEventListener('click', () => void loadFolder(folder.id)); folderPath.append(button);
  }
  folderGrid.replaceChildren();
  for (const folder of result.folders) {
    const card = document.createElement('article'); card.className = 'album-card folder-card';
    const heading = document.createElement('div'); heading.className = 'album-card-heading';
    const kind = document.createElement('span'); kind.className = 'album-kind'; kind.innerHTML = '<i data-lucide="folder" aria-hidden="true"></i>';
    const label = document.createElement('strong'); label.textContent = folder.name; label.title = folder.name; heading.append(kind, label);
    const tile = document.createElement('button'); tile.type = 'button'; tile.className = 'album-tile folder-tile'; tile.setAttribute('aria-label', `Open folder ${folder.name}`);
    const cover = document.createElement('span'); cover.className = 'album-cover folder-cover'; cover.innerHTML = '<i data-lucide="folder" aria-hidden="true"></i>'; tile.append(cover);
    const footer = document.createElement('div'); footer.className = 'album-card-footer'; footer.textContent = 'Folder';
    tile.addEventListener('click', () => void loadFolder(folder.id)); card.append(heading, tile, footer); folderGrid.append(card);
  }
  for (const file of result.files) {
    const card = document.createElement('article'); card.className = 'album-card';
    const heading = document.createElement('div'); heading.className = 'album-card-heading';
    const kind = document.createElement('span'); kind.className = `album-kind ${file.previewKind}`;
    kind.innerHTML = `<i data-lucide="${file.previewKind === 'image' ? 'image' : file.previewKind === 'video' ? 'file-video' : file.previewKind === 'audio' ? 'file-audio' : file.previewKind === 'pdf' || file.previewKind === 'text' ? 'file-text' : 'file'}" aria-hidden="true"></i>`;
    const label = document.createElement('strong'); label.textContent = file.name; label.title = file.name;
    const menu = document.createElement('details'); menu.className = 'album-menu';
    const summary = document.createElement('summary'); summary.innerHTML = '<i data-lucide="more-vertical" aria-hidden="true"></i>'; summary.setAttribute('aria-label', `More actions for ${file.name}`);
    const actions = document.createElement('div'); actions.className = 'album-menu-items';
    const openAction = document.createElement('a'); openAction.className = 'album-action'; openAction.href = `${base}/files/${file.id}/content`; openAction.target = '_blank'; openAction.rel = 'noopener'; openAction.innerHTML = '<i data-lucide="eye" aria-hidden="true"></i>Open';
    const save = document.createElement('a'); save.className = 'album-action'; save.href = `${base}/files/${file.id}/download`; save.innerHTML = '<i data-lucide="download" aria-hidden="true"></i>Download';
    actions.append(openAction, save); menu.append(summary, actions); heading.append(kind, label, menu);
    const open = document.createElement('a'); open.className = 'album-tile'; open.href = `${base}/files/${file.id}/content`; open.target = '_blank'; open.rel = 'noopener'; open.setAttribute('aria-label', `Open ${file.name}`);
    const cover = document.createElement('span'); cover.className = 'album-cover';
    if (file.previewKind === 'image') { const image = document.createElement('img'); image.src = open.href; image.alt = file.name; image.loading = 'lazy'; cover.append(image); }
    else { cover.classList.add('file-cover'); cover.innerHTML = `<i data-lucide="${file.previewKind === 'video' ? 'file-video' : file.previewKind === 'audio' ? 'file-audio' : file.previewKind === 'pdf' || file.previewKind === 'text' ? 'file-text' : 'file'}" aria-hidden="true"></i>`; }
    open.append(cover);
    const footer = document.createElement('div'); footer.className = 'album-card-footer'; footer.textContent = `${sizeLabel(file.size)} · ${new Date(file.createdAt).toLocaleDateString()}`;
    card.append(heading, open, footer); folderGrid.append(card);
  }
  if (!result.folders.length && !result.files.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'This folder is empty.'; folderGrid.append(empty); }
  folderMessage.textContent = ''; refreshIcons();
}
async function load() {
  token = location.pathname.split('/')[2] || '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { unavailable('This link is invalid or unavailable.'); return; }
  const base = `/s/${token}`;
  try {
    const response = await fetch(`${base}/info`);
    if (!response.ok) { unavailable('This link has expired, was revoked, or is unavailable.'); return; }
    const info = await response.json();
    expiresAt = info.expiresAt;
    if (expiresAt <= Date.now()) { unavailable('This share link has expired.'); return; }
    name.textContent = info.name;
    if (info.type === 'folder') {
      fileView.hidden = true; folderView.hidden = false;
      await loadFolder(); expireWhenDue(); return;
    }
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
uploadInput.addEventListener('change', async () => {
  const selected = Array.from(uploadInput.files || []);
  if (!selected.length) return;
  if (selected.some(file => file.size > maxUploadBytes)) { folderMessage.textContent = `Each file must be ${sizeLabel(maxUploadBytes)} or smaller.`; uploadInput.value = ''; return; }
  let completed = 0;
  try {
    for (const file of selected) {
      folderMessage.textContent = `Uploading ${completed + 1} of ${selected.length}: ${file.name}`;
      const response = await fetch(`/s/${token}/upload`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Folder-Id': String(currentFolderId) }, body: file });
      if (!response.ok) throw new Error(await errorMessage(response, `Upload failed with status ${response.status}.`));
      completed++;
    }
    folderMessage.textContent = `${completed} file${completed === 1 ? '' : 's'} uploaded.`; await loadFolder(currentFolderId);
  } catch (error) { folderMessage.textContent = `${completed} uploaded. ${error instanceof Error ? error.message : 'Upload failed.'}`; }
  finally { uploadInput.value = ''; }
});
newFolderForm.addEventListener('submit', async event => {
  event.preventDefault();
  const value = newFolderName.value.trim(); if (!value) return;
  try {
    const response = await fetch(`/s/${token}/folders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: value, parentId: currentFolderId }) });
    if (!response.ok) throw new Error(await errorMessage(response, 'Could not create the folder.'));
    newFolderForm.reset(); folderDialog.close(); await loadFolder(currentFolderId); folderMessage.textContent = 'Folder created.';
  } catch (error) { folderMessage.textContent = error instanceof Error ? error.message : 'Could not create the folder.'; }
});
document.querySelector('#open-shared-new-folder')!.addEventListener('click', () => {
  newFolderForm.reset(); folderDialog.showModal(); newFolderName.focus();
});
document.querySelector('#cancel-shared-new-folder')!.addEventListener('click', () => folderDialog.close());
document.addEventListener('click', event => {
  if (!(event.target instanceof Node)) return;
  for (const menu of document.querySelectorAll<HTMLDetailsElement>('#shared-folder-grid .album-menu[open]')) if (!menu.contains(event.target)) menu.open = false;
});
document.addEventListener('toggle', event => {
  const menu = event.target;
  if (!(menu instanceof HTMLDetailsElement) || !menu.matches('#shared-folder-grid .album-menu') || !menu.open) return;
  for (const other of document.querySelectorAll<HTMLDetailsElement>('#shared-folder-grid .album-menu[open]')) if (other !== menu) other.open = false;
}, true);
void load();
refreshIcons();

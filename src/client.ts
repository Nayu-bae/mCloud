const form = document.querySelector<HTMLFormElement>('#login')!;
const loginPanel = document.querySelector<HTMLElement>('#login-panel')!;
const homePanel = document.querySelector<HTMLElement>('#home-panel')!;
const error = document.querySelector<HTMLElement>('#error')!;
const submit = document.querySelector<HTMLButtonElement>('#submit')!;
type Account = { id: number; username: string; role: 'admin' | 'user' };
const adminPanel = document.querySelector<HTMLElement>('#admin-panel')!;
const userForm = document.querySelector<HTMLFormElement>('#add-user')!;
const userList = document.querySelector<HTMLElement>('#user-list')!;
const userMessage = document.querySelector<HTMLElement>('#user-message')!;
const listError = document.querySelector<HTMLElement>('#list-error')!;
const retryUsers = document.querySelector<HTMLButtonElement>('#retry-users')!;
const nav = document.querySelector<HTMLElement>('#workspace-nav')!;
const filesPanel = document.querySelector<HTMLElement>('#files-panel')!;
const filesLink = document.querySelector<HTMLAnchorElement>('#files-link')!;
const albumPanel = document.querySelector<HTMLElement>('#album-panel')!;
const albumLink = document.querySelector<HTMLAnchorElement>('#album-link')!;
const usersLink = document.querySelector<HTMLAnchorElement>('#users-link')!;
let currentAccount: Account | undefined;
function showView() {
  const usersView = currentAccount?.role === 'admin' && location.hash === '#users';
  const albumView = location.hash === '#album';
  filesPanel.hidden = Boolean(usersView) || albumView;
  adminPanel.hidden = !usersView;
  albumPanel.hidden = !albumView;
  for (const link of [filesLink, usersLink, albumLink]) link.removeAttribute('aria-current');
  (usersView ? usersLink : albumView ? albumLink : filesLink).setAttribute('aria-current', 'page');
  if (currentAccount && !usersView && !albumView && location.hash !== '#files') history.replaceState(null, '', '#files');
  if (albumView) renderAlbum();
}
window.addEventListener('hashchange', showView);
let sessionVersion = 0;
const showSession = (user?: Account) => {
  sessionVersion++;
  loginPanel.hidden = Boolean(user);
  homePanel.hidden = !user;
  currentAccount = user;
  nav.hidden = !user;
  usersLink.hidden = user?.role !== 'admin';
  if (!user) history.replaceState(null, '', location.pathname);
  showView();
  userForm.reset();
  resetFiles();
  if (user) void loadFiles();
  userList.replaceChildren();
  userMessage.textContent = '';
  listError.textContent = '';
  retryUsers.hidden = true;
  document.body.classList.remove('loading');
  if (user?.role === 'admin') void loadUsers();
};
async function loadUsers() {
  const version = sessionVersion;
  try {
    const response = await fetch('/api/admin/users');
    if (version !== sessionVersion) return;
    if (response.status === 401) { showSession(); return; }
    if (response.status === 403) { if (currentAccount) currentAccount.role = 'user'; usersLink.hidden = true; showView(); return; }
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (version !== sessionVersion) return;
    userList.replaceChildren();
    for (const user of data.users as Account[]) {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = user.username;
      const role = document.createElement('span');
      role.className = 'badge';
      role.textContent = user.role === 'admin' ? 'Admin' : 'User';
      row.append(name, role);
      userList.append(row);
    }
    listError.textContent = '';
    retryUsers.hidden = true;
  } catch {
    if (version !== sessionVersion) return;
    listError.textContent = 'Could not load users. Please try again.';
    retryUsers.hidden = false;
  }
}
retryUsers.addEventListener('click', () => void loadUsers());
fetch('/api/session').then(async r => showSession(r.ok ? (await r.json()).user : undefined)).catch(() => showSession());
userForm.addEventListener('submit', async event => {
  event.preventDefault();
  const data = new FormData(userForm);
  userMessage.classList.remove('success');
  if (data.get('password') !== data.get('confirm')) { userMessage.textContent = 'Passwords do not match.'; return; }
  const button = document.querySelector<HTMLButtonElement>('#add-user-submit')!;
  button.disabled = true;
  button.textContent = 'Creating…';
  userMessage.textContent = '';
  const version = sessionVersion;
  try {
    const response = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: data.get('username'), password: data.get('password') }) });
    if (version !== sessionVersion) return;
    if (response.status === 401) { showSession(); error.textContent = 'Your session expired. Please sign in again.'; return; }
    if (response.status === 403) { if (currentAccount) currentAccount.role = 'user'; usersLink.hidden = true; showView(); return; }
    const result = await response.json();
    if (version !== sessionVersion) return;
    if (!response.ok) { userMessage.textContent = result.error || 'Could not create user.'; return; }
    userForm.reset();
    userMessage.classList.add('success');
    userMessage.textContent = `Account created for ${result.user.username}. They can now sign in.`;
    await loadUsers();
  } catch { if (version === sessionVersion) userMessage.textContent = 'Cannot reach the server. Check the user list before trying again.'; }
  finally { button.disabled = false; button.textContent = 'Create user'; }
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  error.textContent = '';
  submit.disabled = true;
  submit.textContent = 'Signing in…';
  try {
    const data = new FormData(form);
    const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: data.get('username'), password: data.get('password') }) });
    const result = await response.json();
    if (!response.ok) { error.textContent = result.error || 'Unable to sign in.'; return; }
    form.reset();
    showSession(result.user);
  } catch { error.textContent = 'Cannot reach the server. Please try again.'; }
  finally { submit.disabled = false; submit.textContent = 'Sign in →'; }
});
document.querySelector('#logout')!.addEventListener('click', async () => {
  try {
    const response = await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error();
    showSession();
  } catch { document.querySelector('#logout-error')!.textContent = 'Could not sign out. Please try again.'; }
});


type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'unsupported';
type LibraryFile = { id: number; name: string; size: number; createdAt: string; folderId: number | null; previewKind: PreviewKind };
const fileList = document.querySelector<HTMLElement>('#file-list')!;
const fileMessage = document.querySelector<HTMLElement>('#file-message')!;
const fileSummary = document.querySelector<HTMLElement>('#file-summary')!;
const fileSearch = document.querySelector<HTMLInputElement>('#file-search')!;
const uploadForm = document.querySelector<HTMLFormElement>('#upload-form')!;
const uploadInput = document.querySelector<HTMLInputElement>('#upload-files')!;
const uploadButton = document.querySelector<HTMLButtonElement>('#upload-submit')!;
type LibraryFolder = { id: number; name: string; parent_id: number | null };
let folders: LibraryFolder[] = [];
let currentFolder: number | null = null;
let library: LibraryFile[] = [];
let maxUploadBytes = 100 * 1024 * 1024;
let uploadController: AbortController | undefined;
let listRequest = 0;
function resetFiles() {
  document.querySelector<HTMLDialogElement>('#share-dialog')?.close();
  selectionMode = false;
  bulkBusy = false;
  selectedFiles.clear(); selectedFolders.clear();
  document.querySelector<HTMLDialogElement>('#bulk-dialog')?.close();
  updateSelectionControls();
  closePreview();
  document.querySelector('#album-grid')!.replaceChildren();
  document.querySelector('#album-path')!.replaceChildren();
  document.querySelector<HTMLInputElement>('#album-search')!.value = '';
  document.querySelector('#album-message')!.textContent = '';
  document.querySelector<HTMLDialogElement>('#file-dialog')?.close();
  document.querySelector<HTMLDialogElement>('#folder-dialog')?.close();
  folders = [];
  currentFolder = null;
  document.querySelector('#folder-path')?.replaceChildren();
  uploadController?.abort();
  uploadController = undefined;
  listRequest++;
  library = [];
  uploadForm.reset();
  uploadButton.disabled = false;
  uploadButton.textContent = 'Upload files';
  fileSearch.value = '';
  fileMessage.textContent = '';
  fileList.replaceChildren();
  fileSummary.textContent = '';
}
function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function renderFiles() {
  for (const id of selectedFiles) if (!library.some(file => file.id === id && file.folderId === currentFolder)) selectedFiles.delete(id);
  for (const id of selectedFolders) if (!folders.some(folder => folder.id === id && folder.parent_id === currentFolder)) selectedFolders.delete(id);
  updateSelectionControls();
  fileList.replaceChildren();
  renderFolderPath();
  const currentFiles = library.filter(file => file.folderId === currentFolder);
  const children = folders.filter(folder => folder.parent_id === currentFolder);
  const visibleFolders = children.filter(folder => folder.name.toLowerCase().includes(fileSearch.value.toLowerCase()));
  const filtered = currentFiles.filter(file => file.name.toLowerCase().includes(fileSearch.value.toLowerCase()));
  for (const folder of visibleFolders) {
    const row = document.createElement('article'); row.className = 'file-row folder-row';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'folder-open text-button';
    open.textContent = `▱ ${folder.name}`; open.setAttribute('aria-label', `Open folder ${folder.name}`);
    open.addEventListener('click', () => navigateFolder(folder.id));
    const actions = document.createElement('div'); actions.className = 'file-actions';
    for (const action of ['rename-folder', 'delete-folder'] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button';
      button.textContent = action === 'rename-folder' ? 'Rename' : 'Delete';
      button.setAttribute('aria-label', `${button.textContent} folder ${folder.name}`);
      button.addEventListener('click', () => openFolderDialog(action, folder.id)); actions.append(button);
    }
    row.append(selectableItem('folder', folder.id, folder.name, open), actions); fileList.append(row);
  }
  fileSummary.textContent = `${children.length} folders · ${currentFiles.length} file${currentFiles.length === 1 ? '' : 's'} · ${sizeLabel(currentFiles.reduce((total, file) => total + file.size, 0))}`;
  if (!filtered.length && !visibleFolders.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = fileSearch.value ? 'No matching files or folders.' : 'This folder is empty. Upload files or create a folder above.';
    fileList.append(empty);
  }
  for (const file of filtered) {
    const row = document.createElement('article');
    row.className = 'file-row';
    const details = document.createElement('div');
    details.className = 'file-details';
    const name = document.createElement('strong');
    name.textContent = file.name;
    const meta = document.createElement('span');
    meta.textContent = `${sizeLabel(file.size)} · ${new Date(file.createdAt).toLocaleDateString()}`;
    details.append(name, meta);
    const actions = document.createElement('div');
    actions.className = 'file-actions';
    const download = document.createElement('a');
    download.href = `/api/files/${file.id}/download`;
    download.textContent = 'Download';
    download.setAttribute('aria-label', `Download ${file.name}`);
    const rename = document.createElement('button');
    rename.type = 'button'; rename.className = 'text-button'; rename.textContent = 'Rename';
    rename.setAttribute('aria-label', `Rename ${file.name}`);
    rename.addEventListener('click', () => openFileDialog(file, 'PATCH'));
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'text-button danger'; remove.textContent = 'Delete';
    remove.setAttribute('aria-label', `Delete ${file.name}`);
    remove.addEventListener('click', () => openFileDialog(file, 'DELETE'));
    const move = document.createElement('button'); move.type = 'button'; move.className = 'text-button'; move.textContent = 'Move';
    move.setAttribute('aria-label', `Move ${file.name}`);
    move.addEventListener('click', () => openFolderDialog('move', file.id));
    const open = document.createElement('button'); open.type = 'button'; open.className = 'text-button'; open.textContent = 'Open';
    open.setAttribute('aria-label', `Open ${file.name}`);
    open.addEventListener('click', () => openPreview(file, filtered));
    const share = document.createElement('button'); share.type = 'button'; share.className = 'text-button'; share.textContent = 'Share link';
    share.setAttribute('aria-label', `Share ${file.name}`); share.addEventListener('click', () => openShare(file));
    actions.append(open, download, share, move, rename, remove);
    row.append(selectableItem('file', file.id, file.name, details), actions);
    fileList.append(row);
  }
  renderAlbum();
}
async function loadFiles() {
  const version = sessionVersion;
  const request = ++listRequest;
  try {
    const response = await fetch('/api/files');
    if (version !== sessionVersion || request !== listRequest) return;
    if (response.status === 401) { showSession(); return; }
    if (!response.ok) throw new Error();
    const result = await response.json();
    if (version !== sessionVersion || request !== listRequest) return;
    document.querySelector('#album-message')!.textContent = '';
    library = result.files;
    folders = result.folders;
    if (currentFolder !== null && !folders.some(folder => folder.id === currentFolder)) currentFolder = null;
    maxUploadBytes = result.maxUploadBytes;
    renderFiles();
  } catch { if (version === sessionVersion && request === listRequest) { fileMessage.textContent = 'Could not load files. Use Refresh to try again.'; document.querySelector('#album-message')!.textContent = fileMessage.textContent; } }
}
async function changeFile(id: number, method: 'PATCH' | 'DELETE', body: object) {
  const version = sessionVersion;
  try {
    const response = await fetch(`/api/files/${id}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (version !== sessionVersion) return;
    if (response.status === 401) { showSession(); return; }
    if (!response.ok) { fileMessage.textContent = (await response.json()).error; return; }
    fileMessage.textContent = method === 'PATCH' ? ('folderId' in body ? 'File moved.' : 'File renamed.') : 'File deleted.';
    await loadFiles();
  } catch { if (version === sessionVersion) fileMessage.textContent = 'Could not complete the change. Refresh your files before trying again.'; }
}
uploadForm.addEventListener('submit', async event => {
  event.preventDefault();
  const selected = Array.from(uploadInput.files || []);
  if (!selected.length) return;
  if (selected.some(file => file.size > maxUploadBytes)) { fileMessage.textContent = `Each file must be ${sizeLabel(maxUploadBytes)} or smaller.`; return; }
  const version = sessionVersion;
  const uploadFolder = currentFolder;
  const controller = new AbortController();
  uploadController = controller;
  uploadButton.disabled = true;
  uploadButton.textContent = 'Uploading…';
  let completed = 0;
  try {
    for (const file of selected) {
      if (version !== sessionVersion) return;
      fileMessage.textContent = `Uploading ${completed + 1} of ${selected.length}: ${file.name}`;
      const response = await fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Folder-Id': uploadFolder === null ? '' : String(uploadFolder) }, body: file, signal: controller.signal });
      if (version !== sessionVersion) return;
      if (response.status === 401) { showSession(); return; }
      if (!response.ok) throw new Error((await response.json()).error || 'Upload failed.');
      completed++;
    }
    uploadForm.reset();
    fileMessage.textContent = `${completed} file${completed === 1 ? '' : 's'} uploaded.`;
  } catch (error) {
    if (version === sessionVersion) fileMessage.textContent = `${completed} uploaded. ${error instanceof Error ? error.message : 'Upload failed.'} Refresh before retrying to avoid duplicates.`;
  } finally {
    if (version === sessionVersion) {
      uploadController = undefined;
      uploadButton.disabled = false;
      uploadButton.textContent = 'Upload files';
      await loadFiles();
    }
  }
});
fileSearch.addEventListener('input', () => { selectedFiles.clear(); selectedFolders.clear(); renderFiles(); });
document.querySelector('#refresh-files')!.addEventListener('click', () => { fileMessage.textContent = ''; void loadFiles(); });

const fileDialog = document.querySelector<HTMLDialogElement>('#file-dialog')!;
const renameInput = document.querySelector<HTMLInputElement>('#rename-input')!;
let pendingFileAction: { id: number; method: 'PATCH' | 'DELETE' } | undefined;
function openFileDialog(file: LibraryFile, method: 'PATCH' | 'DELETE') {
  pendingFileAction = { id: file.id, method };
  const deleting = method === 'DELETE';
  document.querySelector('#file-dialog-title')!.textContent = deleting ? 'Delete file?' : 'Rename file';
  document.querySelector('#file-dialog-description')!.textContent = deleting ? `Permanently delete “${file.name}”? This cannot be undone.` : 'Choose a new name for your file.';
  document.querySelector<HTMLElement>('#rename-label')!.hidden = deleting;
  renameInput.hidden = deleting;
  renameInput.disabled = deleting;
  renameInput.value = file.name;
  document.querySelector('#confirm-file-action')!.textContent = deleting ? 'Delete permanently' : 'Save name';
  fileDialog.showModal();
}
document.querySelector('#cancel-file-action')!.addEventListener('click', () => fileDialog.close());
document.querySelector('#file-action-form')!.addEventListener('submit', event => {
  event.preventDefault();
  if (!pendingFileAction) return;
  const { id, method } = pendingFileAction;
  fileDialog.close();
  void changeFile(id, method, method === 'PATCH' ? { name: renameInput.value } : {});
});


function folderTrail(id: number | null): LibraryFolder[] {
  const trail: LibraryFolder[] = [];
  const seen = new Set<number>();
  while (id !== null && !seen.has(id)) {
    seen.add(id);
    const folder = folders.find(item => item.id === id);
    if (!folder) break;
    trail.unshift(folder); id = folder.parent_id;
  }
  return trail;
}
function navigateFolder(id: number | null) {
  selectedFiles.clear(); selectedFolders.clear();
  currentFolder = id;
  fileSearch.value = '';
  document.querySelector<HTMLInputElement>('#album-search')!.value = '';
  fileMessage.textContent = '';
  renderFiles();
}
function renderFolderPath() {
  drawFolderPath(document.querySelector<HTMLElement>('#folder-path')!);
  document.querySelector('label[for="upload-files"]')!.textContent = currentFolder === null ? 'Add files to your cloud' : `Upload to ${folderTrail(currentFolder).at(-1)?.name || 'this folder'}`;
}
function drawFolderPath(path: HTMLElement) {
  path.replaceChildren();
  const trail = [{ id: null as number | null, name: 'All files' }, ...folderTrail(currentFolder)];
  for (const [index, folder] of trail.entries()) {
    if (index) path.append(document.createTextNode(' / '));
    const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button';
    button.textContent = folder.name;
    if (folder.id === currentFolder) button.setAttribute('aria-current', 'location');
    button.addEventListener('click', () => navigateFolder(folder.id)); path.append(button);
  }

}
const folderDialog = document.querySelector<HTMLDialogElement>('#folder-dialog')!;
const folderName = document.querySelector<HTMLInputElement>('#folder-name')!;
const moveDestination = document.querySelector<HTMLSelectElement>('#move-destination')!;
type FolderAction = 'create' | 'rename-folder' | 'delete-folder' | 'move';
let folderAction: { action: FolderAction; id?: number; parent: number | null } | undefined;
function openFolderDialog(action: FolderAction, id?: number) {
  folderAction = { action, id, parent: currentFolder };
  const moving = action === 'move';
  const deleting = action === 'delete-folder';
  const folder = folders.find(folder => folder.id === id);
  const title = action === 'create' ? 'New folder' : moving ? 'Move file' : deleting ? 'Delete folder?' : 'Rename folder';
  document.querySelector('#folder-dialog-title')!.textContent = title;
  document.querySelector('#folder-dialog-description')!.textContent = moving ? 'Choose where this file should live.' : deleting ? `Delete “${folder?.name}”? The folder must be empty.` : 'Give your folder a name.';
  folderName.hidden = moving || deleting; folderName.disabled = moving || deleting;
  document.querySelector<HTMLElement>('#folder-name-label')!.hidden = moving || deleting;
  folderName.value = action === 'rename-folder' ? folder?.name || '' : '';
  moveDestination.hidden = !moving; moveDestination.disabled = !moving;
  document.querySelector<HTMLElement>('#move-label')!.hidden = !moving;
  moveDestination.replaceChildren();
  if (moving) {
    const choices = [{ id: null as number | null, name: 'All files (root)' }, ...folders.map(folder => ({ id: folder.id, name: folderTrail(folder.id).map(item => item.name).join(' / ') })).sort((a,b) => a.name.localeCompare(b.name))];
    for (const choice of choices) { const option = document.createElement('option'); option.value = choice.id === null ? '' : String(choice.id); option.textContent = choice.name; moveDestination.append(option); }
    moveDestination.value = currentFolder === null ? '' : String(currentFolder);
  }
  document.querySelector('#confirm-folder-action')!.textContent = moving ? 'Move file' : deleting ? 'Delete empty folder' : action === 'create' ? 'Create folder' : 'Save name';
  folderDialog.showModal();
}
document.querySelector('#new-folder')!.addEventListener('click', () => openFolderDialog('create'));
document.querySelector('#cancel-folder-action')!.addEventListener('click', () => folderDialog.close());
document.querySelector('#folder-action-form')!.addEventListener('submit', async event => {
  event.preventDefault();
  if (!folderAction) return;
  const { action, id, parent } = folderAction;
  const name = folderName.value;
  folderDialog.close();
  if (action === 'move') { await changeFile(id!, 'PATCH', { folderId: moveDestination.value ? Number(moveDestination.value) : null }); return; }
  const version = sessionVersion;
  try {
    const response = await fetch(action === 'create' ? '/api/files/folders' : `/api/files/folders/${id}`, {
      method: action === 'create' ? 'POST' : action === 'delete-folder' ? 'DELETE' : 'PATCH',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parentId: parent })
    });
    if (version !== sessionVersion) return;
    if (response.status === 401) { showSession(); return; }
    if (!response.ok) { fileMessage.textContent = (await response.json()).error; return; }
    fileMessage.textContent = action === 'create' ? 'Folder created.' : action === 'delete-folder' ? 'Folder deleted.' : 'Folder renamed.';
    await loadFiles();
  } catch { if (version === sessionVersion) fileMessage.textContent = 'Could not update the folder. Refresh and try again.'; }
});


function renderAlbum() {
  const grid = document.querySelector<HTMLElement>('#album-grid')!;
  drawFolderPath(document.querySelector<HTMLElement>('#album-path')!);
  grid.replaceChildren();
  const query = document.querySelector<HTMLInputElement>('#album-search')!.value.toLowerCase();
  const children = folders.filter(folder => folder.parent_id === currentFolder && folder.name.toLowerCase().includes(query));
  const visibleFiles = library.filter(file => file.folderId === currentFolder && file.name.toLowerCase().includes(query));
  for (const folder of children) {
    const tile = document.createElement('button'); tile.type = 'button'; tile.className = 'album-tile folder-tile';
    const icon = document.createElement('span'); icon.className = 'album-cover folder-cover'; icon.textContent = '▱'; icon.setAttribute('aria-hidden', 'true');
    const name = document.createElement('strong'); name.textContent = folder.name;
    const description = document.createElement('small'); description.textContent = 'Folder';
    tile.append(icon, name, description); tile.setAttribute('aria-label', `Open folder ${folder.name}`);
    tile.addEventListener('click', () => navigateFolder(folder.id)); grid.append(tile);
  }
  for (const file of visibleFiles) {
    const tile = document.createElement('button'); tile.type = 'button'; tile.className = 'album-tile';
    const cover = document.createElement('span'); cover.className = 'album-cover';
    if (file.previewKind === 'image') {
      const image = document.createElement('img'); image.src = `/api/files/${file.id}/preview`; image.alt = file.name; image.loading = 'lazy'; image.decoding = 'async';
      image.addEventListener('error', () => { cover.textContent = 'Image preview unavailable'; }); cover.append(image);
    } else {
      cover.classList.add('file-cover');
      cover.textContent = file.previewKind === 'pdf' ? 'PDF' : file.previewKind === 'video' ? '▶' : file.previewKind === 'audio' ? '♫' : file.previewKind === 'text' ? 'Aa' : 'File';
    }
    const name = document.createElement('strong'); name.textContent = file.name;
    const meta = document.createElement('small'); meta.textContent = sizeLabel(file.size);
    tile.append(cover, name, meta); tile.setAttribute('aria-label', `Open ${file.name}`);
    tile.addEventListener('click', () => openPreview(file, visibleFiles)); grid.append(tile);
  }
  if (!children.length && !visibleFiles.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = query ? 'No matching files or folders.' : 'This folder is empty. Add files from the Files tab.'; grid.append(empty);
  }
}
document.querySelector('#album-search')!.addEventListener('input', renderAlbum);
document.querySelector('#refresh-album')!.addEventListener('click', () => void loadFiles());

const previewDialog = document.querySelector<HTMLDialogElement>('#preview-dialog')!;
const previewContent = document.querySelector<HTMLElement>('#preview-content')!;
let previewFiles: LibraryFile[] = [];
let previewIndex = 0;
let previewRequest = 0;
let previewAbort: AbortController | undefined;
function clearPreview() {
  previewRequest++;
  previewAbort?.abort();
  previewContent.replaceChildren();
}
function closePreview() { previewDialog.close(); clearPreview(); previewFiles = []; }
function openPreview(file: LibraryFile, collection: LibraryFile[]) {
  previewFiles = collection;
  previewIndex = collection.findIndex(item => item.id === file.id);
  if (!previewDialog.open) previewDialog.showModal();
  void renderPreview();
}
async function renderPreview() {
  clearPreview();
  const file = previewFiles[previewIndex];
  if (!file) return;
  const request = previewRequest;
  const version = sessionVersion;
  const controller = new AbortController(); previewAbort = controller;
  document.querySelector('#preview-title')!.textContent = file.name;
  document.querySelector('#preview-meta')!.textContent = `${sizeLabel(file.size)} · ${new Date(file.createdAt).toLocaleDateString()}`;
  document.querySelector('#preview-position')!.textContent = `${previewIndex + 1} of ${previewFiles.length}`;
  document.querySelector<HTMLButtonElement>('#previous-preview')!.disabled = previewIndex <= 0;
  document.querySelector<HTMLButtonElement>('#next-preview')!.disabled = previewIndex >= previewFiles.length - 1;
  previewContent.textContent = 'Loading preview…';
  try {
    const response = await fetch(`/api/files/${file.id}/preview-info`, { signal: controller.signal });
    if (request !== previewRequest || version !== sessionVersion) return;
    if (response.status === 401) { showSession(); return; }
    if (!response.ok) throw new Error('This file is no longer available. Refresh your library.');
    const info = await response.json() as { kind: PreviewKind; textTooLarge: boolean };
    if (request !== previewRequest || version !== sessionVersion) return;
    previewContent.replaceChildren();
    const url = `/api/files/${file.id}/preview`;
    if (info.kind === 'unsupported') { previewContent.textContent = 'An in-browser preview is not available for this file type. Nothing has been downloaded.'; return; }
    if (info.textTooLarge) { previewContent.textContent = 'This text file is too large to preview. The preview limit is 1 MB.'; return; }
    if (info.kind === 'text') {
      const textResponse = await fetch(url, { signal: controller.signal });
      if (!textResponse.ok) throw new Error('Could not load this text preview.');
      const text = await textResponse.text();
      if (request !== previewRequest || version !== sessionVersion) return;
      const pre = document.createElement('pre'); pre.textContent = text; previewContent.append(pre);
    } else if (info.kind === 'image') {
      const image = document.createElement('img'); image.alt = file.name; image.src = url;
      image.addEventListener('error', () => { if (request === previewRequest) previewContent.textContent = 'This image could not be displayed.'; }); previewContent.append(image);
    } else if (info.kind === 'pdf') {
      const frame = document.createElement('iframe'); frame.title = file.name; frame.src = url; previewContent.append(frame);
      const hint = document.createElement('p'); hint.className = 'upload-hint'; hint.textContent = 'PDF preview requires a browser with a built-in PDF viewer.'; previewContent.append(hint);
    } else {
      const media = document.createElement(info.kind === 'video' ? 'video' : 'audio'); media.controls = true; media.preload = 'metadata'; media.src = url;
      media.addEventListener('error', () => { if (request === previewRequest) previewContent.textContent = 'Your browser cannot play this file format.'; }); previewContent.append(media);
    }
  } catch (error) { if (request === previewRequest && version === sessionVersion) previewContent.textContent = error instanceof Error ? error.message : 'Preview unavailable.'; }
}
function stepPreview(direction: number) {
  const next = previewIndex + direction;
  if (next < 0 || next >= previewFiles.length) return;
  previewIndex = next; void renderPreview();
}
document.querySelector('#close-preview')!.addEventListener('click', closePreview);
previewDialog.addEventListener('close', clearPreview);
document.querySelector('#previous-preview')!.addEventListener('click', () => stepPreview(-1));
document.querySelector('#next-preview')!.addEventListener('click', () => stepPreview(1));
previewDialog.addEventListener('keydown', event => {
  if (event.target instanceof HTMLMediaElement) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); stepPreview(-1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); stepPreview(1); }
});


let selectionMode = false;
const selectedFiles = new Set<number>();
const selectedFolders = new Set<number>();
const selectionToggle = document.querySelector<HTMLButtonElement>('#select-multiple')!;
function updateSelectionControls() {
  const count = selectedFiles.size + selectedFolders.size;
  selectionToggle.textContent = selectionMode ? 'Cancel selection' : 'Select multiple';
  selectionToggle.setAttribute('aria-pressed', String(selectionMode));
  document.querySelector<HTMLElement>('#selection-toolbar')!.hidden = !selectionMode;
  document.querySelector('#selection-count')!.textContent = `${count} selected`;
  document.querySelector<HTMLButtonElement>('#bulk-move')!.disabled = !count;
  document.querySelector<HTMLButtonElement>('#bulk-delete')!.disabled = !count;
}
function selectableItem(kind: 'file' | 'folder', id: number, name: string, content: HTMLElement): HTMLElement {
  const group = document.createElement('div'); group.className = 'selectable-item';
  if (selectionMode) {
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'item-checkbox';
    checkbox.setAttribute('aria-label', `Select ${kind} ${name}`);
    const selection = kind === 'file' ? selectedFiles : selectedFolders;
    checkbox.checked = selection.has(id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked && selectedFiles.size + selectedFolders.size >= 100) { checkbox.checked = false; fileMessage.textContent = 'Select up to 100 items at a time.'; return; }
      if (checkbox.checked) selection.add(id); else selection.delete(id);
      updateSelectionControls();
    });
    group.append(checkbox);
  }
  group.append(content); return group;
}
selectionToggle.addEventListener('click', () => {
  selectionMode = !selectionMode;
  selectedFiles.clear(); selectedFolders.clear();
  renderFiles();
});
document.querySelector('#select-all')!.addEventListener('click', () => {
  selectedFiles.clear(); selectedFolders.clear();
  const query = fileSearch.value.toLowerCase();
  for (const folder of folders.filter(item => item.parent_id === currentFolder && item.name.toLowerCase().includes(query))) {
    if (selectedFiles.size + selectedFolders.size < 100) selectedFolders.add(folder.id);
  }
  for (const file of library.filter(item => item.folderId === currentFolder && item.name.toLowerCase().includes(query))) {
    if (selectedFiles.size + selectedFolders.size < 100) selectedFiles.add(file.id);
  }
  if (selectedFiles.size + selectedFolders.size === 100) fileMessage.textContent = 'Selected up to 100 visible items.';
  renderFiles();
});
let bulkBusy = false;
const bulkDialog = document.querySelector<HTMLDialogElement>('#bulk-dialog')!;
const bulkDestination = document.querySelector<HTMLSelectElement>('#bulk-destination')!;
const bulkConfirm = document.querySelector<HTMLButtonElement>('#bulk-confirm')!;
const bulkError = document.querySelector<HTMLElement>('#bulk-error')!;
let pendingBulk: { action: 'move' | 'delete'; fileIds: number[]; folderIds: number[] } | undefined;
function openBulk(action: 'move' | 'delete') {
  const count = selectedFiles.size + selectedFolders.size;
  if (!count) return;
  pendingBulk = { action, fileIds: [...selectedFiles], folderIds: [...selectedFolders] };
  const moving = action === 'move';
  document.querySelector('#bulk-title')!.textContent = `${moving ? 'Move' : 'Delete'} ${count} items?`;
  document.querySelector('#bulk-description')!.textContent = moving ? 'Folders move with all their contents. Choose a destination.' : 'Selected files will be permanently deleted. Every selected folder must already be empty. This cannot be undone.';
  bulkDestination.hidden = !moving; bulkDestination.disabled = !moving;
  document.querySelector<HTMLElement>('#bulk-destination-label')!.hidden = !moving;
  bulkDestination.replaceChildren();
  bulkError.textContent = '';
  bulkConfirm.disabled = false;
  bulkConfirm.textContent = moving ? 'Move selected' : 'Delete permanently';
  if (moving) {
    const choices = [{ id: null as number | null, name: 'All files (root)' }, ...folders.filter(folder => !folderTrail(folder.id).some(parent => selectedFolders.has(parent.id))).map(folder => ({ id: folder.id, name: folderTrail(folder.id).map(item => item.name).join(' / ') })).sort((a,b) => a.name.localeCompare(b.name))];
    for (const choice of choices) { const option = document.createElement('option'); option.value = choice.id === null ? '' : String(choice.id); option.textContent = choice.name; bulkDestination.append(option); }
    bulkDestination.value = currentFolder === null ? '' : String(currentFolder);
  } else {
    const blocked = folders.filter(folder => selectedFolders.has(folder.id) && (folders.some(child => child.parent_id === folder.id) || library.some(file => file.folderId === folder.id)));
    if (blocked.length) {
      bulkError.textContent = `Cannot delete non-empty folders: ${blocked.map(folder => folder.name).join(', ')}. Nothing will be deleted. Cancel and change the selection.`;
      bulkConfirm.disabled = true;
    }
  }
  bulkDialog.showModal();
}
document.querySelector('#bulk-move')!.addEventListener('click', () => openBulk('move'));
document.querySelector('#bulk-delete')!.addEventListener('click', () => openBulk('delete'));
document.querySelector('#bulk-cancel')!.addEventListener('click', () => { if (!bulkBusy) bulkDialog.close(); });
bulkDialog.addEventListener('cancel', event => { if (bulkBusy) event.preventDefault(); });
document.querySelector('#bulk-form')!.addEventListener('submit', async event => {
  event.preventDefault();
  if (!pendingBulk || bulkConfirm.disabled) return;
  const action = pendingBulk;
  bulkBusy = true;
  const version = sessionVersion;
  bulkConfirm.disabled = true;
  bulkConfirm.textContent = 'Working…';
  bulkError.textContent = '';
  try {
    const response = await fetch('/api/files/bulk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...action, destination: bulkDestination.value ? Number(bulkDestination.value) : null })
    });
    if (version !== sessionVersion) return;
    if (response.status === 401) { showSession(); return; }
    const result = await response.json();
    if (version !== sessionVersion) return;
    if (!response.ok) { bulkError.textContent = result.error || 'The selection could not be updated.'; return; }
    bulkDialog.close();
    selectedFiles.clear(); selectedFolders.clear();
    fileMessage.textContent = action.action === 'move' ? 'Selected items moved.' : 'Selected items deleted.';
    if (result.cleanupPending) fileMessage.textContent += ' Some stored data will be cleaned up after the server restarts.';
    await loadFiles();
  } catch { if (version === sessionVersion) bulkError.textContent = 'Could not complete the request. Close this dialog and refresh before retrying.'; }
  finally {
    if (version === sessionVersion) { bulkBusy = false; bulkConfirm.disabled = false; bulkConfirm.textContent = action.action === 'move' ? 'Move selected' : 'Delete permanently'; }
  }
});


const shareDialog = document.querySelector<HTMLDialogElement>('#share-dialog')!;
const shareForm = document.querySelector<HTMLFormElement>('#share-form')!;
const shareMessage = document.querySelector<HTMLElement>('#share-message')!;
const shareList = document.querySelector<HTMLElement>('#share-list')!;
const shareResult = document.querySelector<HTMLElement>('#share-result')!;
const shareUrl = document.querySelector<HTMLInputElement>('#share-url')!;
const shareDuration = document.querySelector<HTMLInputElement>('#share-duration')!;
const shareUnit = document.querySelector<HTMLSelectElement>('#share-unit')!;
const createShareButton = document.querySelector<HTMLButtonElement>('#create-share')!;
let sharedFile: LibraryFile | undefined;
let shareGeneration = 0;
let createdShareId: number | undefined;
function openShare(file: LibraryFile) {
  sharedFile = file; shareGeneration++;
  createdShareId = undefined;
  document.querySelector('#share-filename')!.textContent = file.name;
  shareMessage.textContent = '';
  shareResult.hidden = true; shareUrl.value = '';
  shareForm.reset(); shareDuration.max = '30';
  createShareButton.disabled = false; createShareButton.textContent = 'Create link';
  shareList.textContent = 'Loading active links…';
  if (!shareDialog.open) shareDialog.showModal();
  void loadShares();
}
shareDialog.addEventListener('close', () => { shareGeneration++; sharedFile = undefined; shareUrl.value = ''; shareResult.hidden = true; shareList.replaceChildren(); });
document.querySelector('#close-share')!.addEventListener('click', () => shareDialog.close());
document.querySelector('#share-preview')!.addEventListener('click', () => { const file = previewFiles[previewIndex]; if (file) openShare(file); });
shareUnit.addEventListener('change', () => { shareDuration.max = String(43200 / Number(shareUnit.value)); });
document.querySelector('#refresh-shares')!.addEventListener('click', () => void loadShares());
async function loadShares() {
  if (!sharedFile) return;
  const fileId = sharedFile.id;
  const generation = shareGeneration;
  try {
    const response = await fetch(`/api/files/${fileId}/shares`);
    if (generation !== shareGeneration) return;
    if (response.status === 401) { showSession(); return; }
    if (!response.ok) throw new Error('Could not load links. Use Refresh links to try again.');
    const result = await response.json() as { links: { id: number; created_at: number; expires_at: number }[] };
    if (generation !== shareGeneration) return;
    shareList.replaceChildren();
    if (!result.links.length) shareList.textContent = 'No active links.';
    for (const link of result.links) {
      const row = document.createElement('div'); row.className = 'share-link-row';
      const description = document.createElement('span'); description.textContent = `Link ${link.id} · expires ${new Date(link.expires_at).toLocaleString()}`;
      const revoke = document.createElement('button'); revoke.type = 'button'; revoke.className = 'text-button danger'; revoke.textContent = 'Revoke'; revoke.setAttribute('aria-label', `Revoke link ${link.id}`);
      revoke.addEventListener('click', async () => {
        revoke.disabled = true;
        try {
          const response = await fetch(`/api/files/${fileId}/shares/${link.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          if (generation !== shareGeneration) return;
          if (response.status === 401) { showSession(); return; }
          if (!response.ok) throw new Error('Could not revoke this link. Please try again.');
          if (createdShareId === link.id) { shareResult.hidden = true; shareUrl.value = ''; }
          shareMessage.textContent = 'Link revoked. New access requests are blocked.';
          await loadShares();
        } catch (error) { if (generation === shareGeneration) shareMessage.textContent = error instanceof Error ? error.message : 'Could not revoke link.'; }
        finally { revoke.disabled = false; }
      });
      row.append(description, revoke); shareList.append(row);
    }
  } catch (error) { if (generation === shareGeneration) shareList.textContent = error instanceof Error ? error.message : 'Could not load links.'; }
}
shareForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!sharedFile || createShareButton.disabled) return;
  const generation = shareGeneration;
  const fileId = sharedFile.id;
  createShareButton.disabled = true; createShareButton.textContent = 'Creating…'; shareMessage.textContent = '';
  try {
    const response = await fetch(`/api/files/${fileId}/shares`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ durationMinutes: Number(shareDuration.value) * Number(shareUnit.value) }) });
    if (generation !== shareGeneration) return;
    if (response.status === 401) { showSession(); return; }
    const result = await response.json();
    if (generation !== shareGeneration) return;
    if (!response.ok) { shareMessage.textContent = result.error || 'Could not create link.'; return; }
    createdShareId = result.id;
    shareUrl.value = new URL(result.path, location.origin).href;
    shareResult.hidden = false;
    document.querySelector('#share-expiry')!.textContent = `Expires ${new Date(result.expiresAt).toLocaleString()}`;
    shareMessage.textContent = 'Link created. Copy it to share this file.';
    await loadShares();
  } catch { if (generation === shareGeneration) shareMessage.textContent = 'Could not create the link. Refresh active links before retrying.'; }
  finally { if (generation === shareGeneration) { createShareButton.disabled = false; createShareButton.textContent = 'Create link'; } }
});
document.querySelector('#copy-share')!.addEventListener('click', async () => {
  if (!shareUrl.value) return;
  const generation = shareGeneration;
  try { await navigator.clipboard.writeText(shareUrl.value); if (generation === shareGeneration) shareMessage.textContent = 'Link copied.'; }
  catch { if (generation === shareGeneration) { shareUrl.focus(); shareUrl.select(); shareMessage.textContent = 'Select and copy the link above.'; } }
});

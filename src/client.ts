const form = document.querySelector<HTMLFormElement>('#login')!;
type LucideBrowser = { createIcons: (options?: { attrs?: Record<string, string> }) => void };
const lucideBrowser = () => (window as unknown as { lucide?: LucideBrowser }).lucide;
function refreshIcons() { lucideBrowser()?.createIcons({ attrs: { 'stroke-width': '2' } }); }
function icon(name: string): HTMLElement {
  const element = document.createElement('i'); element.setAttribute('data-lucide', name); element.setAttribute('aria-hidden', 'true'); return element;
}
function setButton(button: HTMLButtonElement, label: string, iconName?: string) {
  button.replaceChildren(...(iconName ? [icon(iconName), document.createTextNode(label)] : [document.createTextNode(label)]));
  refreshIcons();
}
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
const profileMenu = document.querySelector<HTMLDetailsElement>('#profile-menu')!;
const profileName = document.querySelector<HTMLElement>('#profile-name')!;
const settingsDialog = document.querySelector<HTMLDialogElement>('#settings-dialog')!;
const settingsForm = document.querySelector<HTMLFormElement>('#settings-form')!;
const settingsUsername = document.querySelector<HTMLInputElement>('#settings-username')!;
const settingsCurrentPassword = document.querySelector<HTMLInputElement>('#settings-current-password')!;
const settingsNewPassword = document.querySelector<HTMLInputElement>('#settings-new-password')!;
const settingsConfirmPassword = document.querySelector<HTMLInputElement>('#settings-confirm-password')!;
const settingsMessage = document.querySelector<HTMLElement>('#settings-message')!;
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
  profileName.textContent = user?.username || '';
  profileMenu.open = false;
  if (!user && settingsDialog.open) settingsDialog.close();
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
      if (user.role !== 'admin') {
        const remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'text-button danger'; remove.append(icon('trash-2'), 'Delete');
        remove.setAttribute('aria-label', `Delete user ${user.username}`);
        remove.addEventListener('click', () => void deleteUser(user, remove));
        row.append(remove);
      }
      userList.append(row);
    }
    refreshIcons();
    listError.textContent = '';
    retryUsers.hidden = true;
  } catch {
    if (version !== sessionVersion) return;
    listError.textContent = 'Could not load users. Please try again.';
    retryUsers.hidden = false;
  }
}
async function deleteUser(user: Account, button: HTMLButtonElement) {
  if (!confirm(`Delete “${user.username}” and all of their uploaded files and folders? This cannot be undone.`)) return;
  const version = sessionVersion;
  button.disabled = true; setButton(button, 'Deleting…', 'loader-circle');
  userMessage.classList.remove('success'); userMessage.textContent = '';
  try {
    const response = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (version !== sessionVersion) return;
    if (response.status === 401) { showSession(); error.textContent = 'Your session expired. Please sign in again.'; return; }
    if (response.status === 403) { if (currentAccount) currentAccount.role = 'user'; usersLink.hidden = true; showView(); return; }
    const result = await response.json();
    if (!response.ok) { userMessage.textContent = result.error || 'Could not delete user.'; button.disabled = false; setButton(button, 'Delete', 'trash-2'); return; }
    userMessage.classList.add('success');
    userMessage.textContent = `Deleted ${user.username} and all of their uploads.${result.cleanupPending ? ' Stored files will finish cleaning up after the server restarts.' : ''}`;
    await loadUsers();
  } catch {
    if (version === sessionVersion) { userMessage.textContent = 'Cannot reach the server. Refresh the user list before trying again.'; button.disabled = false; setButton(button, 'Delete', 'trash-2'); }
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
  setButton(button, 'Creating…', 'loader-circle');
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
  finally { button.disabled = false; setButton(button, 'Create user', 'user-plus'); }
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  error.textContent = '';
  submit.disabled = true;
  setButton(submit, 'Signing in…', 'loader-circle');
  try {
    const data = new FormData(form);
    const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: data.get('username'), password: data.get('password') }) });
    const result = await response.json();
    if (!response.ok) { error.textContent = result.error || 'Unable to sign in.'; return; }
    form.reset();
    showSession(result.user);
  } catch { error.textContent = 'Cannot reach the server. Please try again.'; }
  finally { submit.disabled = false; setButton(submit, 'Sign in', 'log-in'); }
});
document.querySelector('#logout')!.addEventListener('click', async () => {
  try {
    const response = await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error();
    showSession();
  } catch { document.querySelector('#logout-error')!.textContent = 'Could not sign out. Please try again.'; }
});
document.querySelector('#open-settings')!.addEventListener('click', () => {
  if (!currentAccount) return;
  profileMenu.open = false;
  settingsForm.reset(); settingsUsername.value = currentAccount.username; settingsMessage.textContent = ''; settingsMessage.classList.remove('success');
  settingsDialog.showModal(); settingsUsername.focus();
});
document.querySelector('#close-settings')!.addEventListener('click', () => settingsDialog.close());
settingsForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentAccount) return;
  settingsMessage.textContent = ''; settingsMessage.classList.remove('success');
  if (settingsNewPassword.value !== settingsConfirmPassword.value) { settingsMessage.textContent = 'New passwords do not match.'; return; }
  const button = document.querySelector<HTMLButtonElement>('#save-settings')!;
  const version = sessionVersion;
  button.disabled = true; setButton(button, 'Saving…', 'loader-circle');
  try {
    const response = await fetch('/api/account', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: settingsUsername.value, currentPassword: settingsCurrentPassword.value, newPassword: settingsNewPassword.value }) });
    if (version !== sessionVersion) return;
    if (response.status === 401) { settingsDialog.close(); showSession(); error.textContent = 'Your session expired. Please sign in again.'; return; }
    const result = await response.json();
    if (!response.ok) { settingsMessage.textContent = result.error || 'Could not update your account.'; return; }
    currentAccount = result.user; profileName.textContent = result.user.username; settingsUsername.value = result.user.username;
    settingsCurrentPassword.value = ''; settingsNewPassword.value = ''; settingsConfirmPassword.value = '';
    settingsMessage.classList.add('success'); settingsMessage.textContent = 'Account settings updated.';
    if (result.user.role === 'admin') await loadUsers();
  } catch { if (version === sessionVersion) settingsMessage.textContent = 'Cannot reach the server. Please try again.'; }
  finally { if (version === sessionVersion) { button.disabled = false; setButton(button, 'Save changes', 'save'); } }
});
document.addEventListener('click', event => {
  if (event.target instanceof Node && profileMenu.open && !profileMenu.contains(event.target)) profileMenu.open = false;
});


type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'unsupported';
type LibraryFile = { id: number; name: string; size: number; createdAt: string; folderId: number | null; previewKind: PreviewKind };
const fileMessage = document.querySelector<HTMLElement>('#file-message')!;
const albumMessage = document.querySelector<HTMLElement>('#album-message')!;
const uploadForm = document.querySelector<HTMLFormElement>('#upload-form')!;
const uploadInput = document.querySelector<HTMLInputElement>('#upload-files')!;
const uploadFolder = document.querySelector<HTMLSelectElement>('#upload-folder')!;
const uploadButton = document.querySelector<HTMLButtonElement>('#upload-submit')!;
const chooseFiles = document.querySelector<HTMLButtonElement>('#choose-files')!;
const uploadSelection = document.querySelector<HTMLElement>('#upload-selection')!;
let stagedFiles: File[] = [];
let dragDepth = 0;
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
  uploadController?.abort();
  uploadController = undefined;
  listRequest++;
  library = [];
  uploadForm.reset();
  stagedFiles = []; dragDepth = 0; uploadForm.classList.remove('drag-active');
  uploadSelection.textContent = 'No files selected · Up to 100 MB each';
  uploadButton.disabled = false;
  setButton(uploadButton, 'Upload files', 'cloud-upload');
  fileMessage.textContent = '';
  document.querySelector('#stat-files')!.textContent = '0';
  document.querySelector('#stat-folders')!.textContent = '0';
  document.querySelector('#stat-storage')!.textContent = '0 B';
}
function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
async function uploadFailure(response: Response): Promise<string> {
  if (response.status === 413) {
    return `The web server rejected this upload as too large. Its request limit may be lower than mCloud's ${sizeLabel(maxUploadBytes)} limit.`;
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const result = await response.json() as { error?: unknown };
      if (typeof result.error === 'string' && result.error) return result.error;
    } catch { /* Fall through to the status-based message. */ }
  }
  return `Upload failed because the web server returned ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`;
}
function setLibraryMessage(message: string) {
  fileMessage.textContent = message;
  albumMessage.textContent = message;
}
function renderFiles() {
  for (const id of selectedFiles) if (!library.some(file => file.id === id && file.folderId === currentFolder)) selectedFiles.delete(id);
  for (const id of selectedFolders) if (!folders.some(folder => folder.id === id && folder.parent_id === currentFolder)) selectedFolders.delete(id);
  updateSelectionControls();
  document.querySelector('#stat-files')!.textContent = String(library.length);
  document.querySelector('#stat-folders')!.textContent = String(folders.length);
  document.querySelector('#stat-storage')!.textContent = sizeLabel(library.reduce((total, file) => total + file.size, 0));
  const selectedUploadFolder = uploadFolder.value;
  uploadFolder.replaceChildren(new Option('All files (root)', ''));
  for (const folder of [...folders].sort((a, b) => folderTrail(a.id).map(item => item.name).join(' / ').localeCompare(folderTrail(b.id).map(item => item.name).join(' / ')))) {
    uploadFolder.append(new Option(folderTrail(folder.id).map(item => item.name).join(' / '), String(folder.id)));
  }
  uploadFolder.value = folders.some(folder => String(folder.id) === selectedUploadFolder) ? selectedUploadFolder : '';
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
    library = result.files;
    folders = result.folders;
    if (currentFolder !== null && !folders.some(folder => folder.id === currentFolder)) currentFolder = null;
    maxUploadBytes = result.maxUploadBytes;
    renderFiles();
  } catch { if (version === sessionVersion && request === listRequest) setLibraryMessage('Could not load files. Use Refresh to try again.'); }
}
async function changeFile(id: number, method: 'PATCH' | 'DELETE', body: object) {
  const version = sessionVersion;
  try {
    const response = await fetch(`/api/files/${id}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (version !== sessionVersion) return;
    if (response.status === 401) { showSession(); return; }
    if (!response.ok) { setLibraryMessage((await response.json()).error); return; }
    setLibraryMessage(method === 'PATCH' ? ('folderId' in body ? 'File moved.' : 'File renamed.') : 'File deleted.');
    await loadFiles();
  } catch { if (version === sessionVersion) setLibraryMessage('Could not complete the change. Refresh your files before trying again.'); }
}
function updateUploadSelection() {
  const total = stagedFiles.reduce((bytes, file) => bytes + file.size, 0);
  uploadSelection.textContent = stagedFiles.length ? `${stagedFiles.length} file${stagedFiles.length === 1 ? '' : 's'} selected · ${sizeLabel(total)} total` : 'No files selected · Up to 100 MB each';
}
chooseFiles.addEventListener('click', () => uploadInput.click());
uploadInput.addEventListener('change', () => { stagedFiles = Array.from(uploadInput.files || []); updateUploadSelection(); });
uploadForm.addEventListener('dragenter', event => {
  if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
  event.preventDefault(); dragDepth++; uploadForm.classList.add('drag-active');
});
uploadForm.addEventListener('dragover', event => {
  if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
  event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; uploadForm.classList.add('drag-active');
});
uploadForm.addEventListener('dragleave', event => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) uploadForm.classList.remove('drag-active');
});
uploadForm.addEventListener('drop', event => {
  event.preventDefault(); dragDepth = 0; uploadForm.classList.remove('drag-active');
  if (uploadButton.disabled) return;
  const files = Array.from(event.dataTransfer?.files || []);
  if (!files.length) { setLibraryMessage('Drop one or more files to upload.'); return; }
  stagedFiles = files;
  try { if (event.dataTransfer) uploadInput.files = event.dataTransfer.files; } catch { /* The staged files are still ready to upload. */ }
  updateUploadSelection(); setLibraryMessage(`${files.length} file${files.length === 1 ? '' : 's'} ready to upload.`);
});
uploadForm.addEventListener('submit', async event => {
  event.preventDefault();
  const selected = [...stagedFiles];
  if (!selected.length) return;
  if (selected.some(file => file.size > maxUploadBytes)) { fileMessage.textContent = `Each file must be ${sizeLabel(maxUploadBytes)} or smaller.`; return; }
  const version = sessionVersion;
  const destinationFolder = uploadFolder.value ? Number(uploadFolder.value) : null;
  const controller = new AbortController();
  uploadController = controller;
  uploadButton.disabled = true;
  setButton(uploadButton, 'Uploading…', 'loader-circle');
  let completed = 0;
  try {
    for (const file of selected) {
      if (version !== sessionVersion) return;
      fileMessage.textContent = `Uploading ${completed + 1} of ${selected.length}: ${file.name}`;
      const response = await fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Folder-Id': destinationFolder === null ? '' : String(destinationFolder) }, body: file, signal: controller.signal });
      if (version !== sessionVersion) return;
      if (response.status === 401) { showSession(); return; }
      if (!response.ok) throw new Error(await uploadFailure(response));
      completed++;
    }
    uploadForm.reset();
    stagedFiles = []; updateUploadSelection();
    fileMessage.textContent = `${completed} file${completed === 1 ? '' : 's'} uploaded.`;
  } catch (error) {
    if (version === sessionVersion) fileMessage.textContent = `${completed} uploaded. ${error instanceof Error ? error.message : 'Upload failed.'} Refresh before retrying to avoid duplicates.`;
  } finally {
    if (version === sessionVersion) {
      uploadController = undefined;
      uploadButton.disabled = false;
      setButton(uploadButton, 'Upload files', 'cloud-upload');
      await loadFiles();
    }
  }
});
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
  setButton(document.querySelector<HTMLButtonElement>('#confirm-file-action')!, deleting ? 'Delete permanently' : 'Save name', deleting ? 'trash-2' : 'save');
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
  document.querySelector<HTMLInputElement>('#album-search')!.value = '';
  albumMessage.textContent = '';
  renderFiles();
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
  setButton(document.querySelector<HTMLButtonElement>('#confirm-folder-action')!, moving ? 'Move file' : deleting ? 'Delete empty folder' : action === 'create' ? 'Create folder' : 'Save name', moving ? 'folder-input' : deleting ? 'trash-2' : action === 'create' ? 'folder-plus' : 'save');
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
    if (!response.ok) { setLibraryMessage((await response.json()).error); return; }
    setLibraryMessage(action === 'create' ? 'Folder created.' : action === 'delete-folder' ? 'Folder deleted.' : 'Folder renamed.');
    await loadFiles();
  } catch { if (version === sessionVersion) setLibraryMessage('Could not update the folder. Refresh and try again.'); }
});


function renderAlbum() {
  const grid = document.querySelector<HTMLElement>('#album-grid')!;
  drawFolderPath(document.querySelector<HTMLElement>('#album-path')!);
  grid.replaceChildren();
  const query = document.querySelector<HTMLInputElement>('#album-search')!.value.toLowerCase();
  const children = folders.filter(folder => folder.parent_id === currentFolder && folder.name.toLowerCase().includes(query));
  const visibleFiles = library.filter(file => file.folderId === currentFolder && file.name.toLowerCase().includes(query));
  for (const folder of children) {
    const card = document.createElement('article'); card.className = 'album-card folder-card';
    const heading = document.createElement('div'); heading.className = 'album-card-heading';
    if (selectionMode) heading.append(selectionCheckbox('folder', folder.id, folder.name));
    const kind = document.createElement('span'); kind.className = 'album-kind'; kind.append(icon('folder')); kind.setAttribute('aria-hidden', 'true');
    const headingName = document.createElement('strong'); headingName.textContent = folder.name; headingName.title = folder.name;
    heading.append(kind, headingName, albumMenu(
      albumAction('Open', 'folder-open', `Open folder ${folder.name}`, () => navigateFolder(folder.id)),
      albumAction('Share link', 'link-2', `Create a temporary link for ${folder.name}`, () => openShare(folder, 'folder')),
      albumAction('Move', 'folder-input', `Move folder ${folder.name}`, () => openBulk('move', { fileIds: [], folderIds: [folder.id] })),
      albumAction('Rename', 'pencil', `Rename folder ${folder.name}`, () => openFolderDialog('rename-folder', folder.id)),
      albumAction('Delete', 'trash-2', `Delete folder ${folder.name}`, () => openFolderDialog('delete-folder', folder.id), true)
    ));
    const tile = document.createElement('button'); tile.type = 'button'; tile.className = 'album-tile folder-tile';
    const coverIcon = document.createElement('span'); coverIcon.className = 'album-cover folder-cover'; coverIcon.append(icon('folder')); coverIcon.setAttribute('aria-hidden', 'true');
    tile.append(coverIcon); tile.setAttribute('aria-label', `Open folder ${folder.name}`);
    const footer = document.createElement('div'); footer.className = 'album-card-footer'; footer.textContent = 'Folder';
    tile.addEventListener('click', () => navigateFolder(folder.id)); card.append(heading, tile, footer); grid.append(card);
  }
  for (const file of visibleFiles) {
    const card = document.createElement('article'); card.className = 'album-card';
    const heading = document.createElement('div'); heading.className = 'album-card-heading';
    if (selectionMode) heading.append(selectionCheckbox('file', file.id, file.name));
    const kind = document.createElement('span'); kind.className = `album-kind ${file.previewKind}`;
    kind.append(icon(file.previewKind === 'image' ? 'image' : file.previewKind === 'video' ? 'file-video' : file.previewKind === 'audio' ? 'file-audio' : file.previewKind === 'text' || file.previewKind === 'pdf' ? 'file-text' : 'file'));
    kind.setAttribute('aria-hidden', 'true');
    const headingName = document.createElement('strong'); headingName.textContent = file.name; headingName.title = file.name;
    heading.append(kind, headingName, albumMenu(
      albumAction('Open', 'eye', `Open ${file.name}`, () => openPreview(file, visibleFiles)),
      albumDownload(file),
      albumAction('Share link', 'link-2', `Create a temporary link for ${file.name}`, () => openShare(file)),
      albumAction('Move', 'folder-input', `Move ${file.name}`, () => openFolderDialog('move', file.id)),
      albumAction('Rename', 'pencil', `Rename ${file.name}`, () => openFileDialog(file, 'PATCH')),
      albumAction('Delete', 'trash-2', `Delete ${file.name}`, () => openFileDialog(file, 'DELETE'), true)
    ));
    const tile = document.createElement('button'); tile.type = 'button'; tile.className = 'album-tile';
    const cover = document.createElement('span'); cover.className = 'album-cover';
    if (file.previewKind === 'image') {
      const image = document.createElement('img'); image.src = `/api/files/${file.id}/preview`; image.alt = file.name; image.loading = 'lazy'; image.decoding = 'async';
      image.addEventListener('error', () => { cover.textContent = 'Image preview unavailable'; }); cover.append(image);
    } else {
      cover.classList.add('file-cover');
      cover.append(icon(file.previewKind === 'pdf' || file.previewKind === 'text' ? 'file-text' : file.previewKind === 'video' ? 'file-video' : file.previewKind === 'audio' ? 'file-audio' : 'file'));
    }
    tile.append(cover); tile.setAttribute('aria-label', `Open ${file.name}`);
    const footer = document.createElement('div'); footer.className = 'album-card-footer'; footer.textContent = `${sizeLabel(file.size)} · ${new Date(file.createdAt).toLocaleDateString()}`;
    tile.addEventListener('click', () => openPreview(file, visibleFiles)); card.append(heading, tile, footer); grid.append(card);
  }
  if (!children.length && !visibleFiles.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = query ? 'No matching files or folders.' : 'This folder is empty. Add files from the Files tab.'; grid.append(empty);
  }
  refreshIcons();
}
function albumMenu(...items: (HTMLButtonElement | HTMLAnchorElement)[]): HTMLDetailsElement {
  const details = document.createElement('details'); details.className = 'album-menu';
  const summary = document.createElement('summary'); summary.append(icon('more-vertical')); summary.setAttribute('aria-label', 'More actions'); summary.title = 'More actions';
  const menu = document.createElement('div'); menu.className = 'album-menu-items'; menu.append(...items);
  details.append(summary, menu);
  details.addEventListener('toggle', () => {
    if (!details.open) return;
    for (const other of document.querySelectorAll<HTMLDetailsElement>('.album-menu[open]')) if (other !== details) other.open = false;
  });
  return details;
}
function albumAction(label: string, iconName: string, accessibleLabel: string, action: () => void, danger = false): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button'; button.className = `album-action${danger ? ' danger' : ''}`;
  button.append(icon(iconName), label); button.setAttribute('aria-label', accessibleLabel); button.title = accessibleLabel;
  button.addEventListener('click', () => { button.closest('details')?.removeAttribute('open'); action(); }); return button;
}
function albumDownload(file: LibraryFile): HTMLAnchorElement {
  const link = document.createElement('a'); link.className = 'album-action'; link.href = `/api/files/${file.id}/download`;
  link.append(icon('download'), 'Download'); link.setAttribute('aria-label', `Download ${file.name}`); link.title = `Download ${file.name}`;
  link.addEventListener('click', () => link.closest('details')?.removeAttribute('open')); return link;
}
document.addEventListener('click', event => {
  if (!(event.target instanceof Node)) return;
  for (const menu of document.querySelectorAll<HTMLDetailsElement>('.album-menu[open]')) if (!menu.contains(event.target)) menu.open = false;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') for (const menu of document.querySelectorAll<HTMLDetailsElement>('.album-menu[open]')) menu.open = false;
});
document.querySelector('#album-search')!.addEventListener('input', () => {
  selectedFiles.clear(); selectedFolders.clear();
  renderFiles();
});
document.querySelector('#refresh-album')!.addEventListener('click', () => { setLibraryMessage(''); void loadFiles(); });

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
  setButton(selectionToggle, selectionMode ? 'Cancel selection' : 'Select multiple', selectionMode ? 'x' : 'list-checks');
  selectionToggle.setAttribute('aria-pressed', String(selectionMode));
  document.querySelector<HTMLElement>('#selection-toolbar')!.hidden = !selectionMode;
  document.querySelector('#selection-count')!.textContent = `${count} selected`;
  document.querySelector<HTMLButtonElement>('#bulk-move')!.disabled = !count;
  document.querySelector<HTMLButtonElement>('#bulk-delete')!.disabled = !count;
}
function selectionCheckbox(kind: 'file' | 'folder', id: number, name: string): HTMLInputElement {
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'item-checkbox';
  checkbox.setAttribute('aria-label', `Select ${kind} ${name}`); checkbox.title = `Select ${name}`;
  const selection = kind === 'file' ? selectedFiles : selectedFolders;
  checkbox.checked = selection.has(id);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked && selectedFiles.size + selectedFolders.size >= 100) { checkbox.checked = false; setLibraryMessage('Select up to 100 items at a time.'); return; }
    if (checkbox.checked) selection.add(id); else selection.delete(id);
    updateSelectionControls();
  });
  return checkbox;
}
selectionToggle.addEventListener('click', () => {
  selectionMode = !selectionMode;
  selectedFiles.clear(); selectedFolders.clear();
  renderFiles();
});
document.querySelector('#select-all')!.addEventListener('click', () => {
  selectedFiles.clear(); selectedFolders.clear();
  const query = document.querySelector<HTMLInputElement>('#album-search')!.value.toLowerCase();
  for (const folder of folders.filter(item => item.parent_id === currentFolder && item.name.toLowerCase().includes(query))) {
    if (selectedFiles.size + selectedFolders.size < 100) selectedFolders.add(folder.id);
  }
  for (const file of library.filter(item => item.folderId === currentFolder && item.name.toLowerCase().includes(query))) {
    if (selectedFiles.size + selectedFolders.size < 100) selectedFiles.add(file.id);
  }
  if (selectedFiles.size + selectedFolders.size === 100) setLibraryMessage('Selected up to 100 visible items.');
  renderFiles();
});
let bulkBusy = false;
const bulkDialog = document.querySelector<HTMLDialogElement>('#bulk-dialog')!;
const bulkDestination = document.querySelector<HTMLSelectElement>('#bulk-destination')!;
const bulkConfirm = document.querySelector<HTMLButtonElement>('#bulk-confirm')!;
const bulkError = document.querySelector<HTMLElement>('#bulk-error')!;
type BulkItems = { fileIds: number[]; folderIds: number[] };
let pendingBulk: ({ action: 'move' | 'delete' } & BulkItems) | undefined;
function openBulk(action: 'move' | 'delete', items?: BulkItems) {
  const fileIds = items?.fileIds ?? [...selectedFiles];
  const folderIds = items?.folderIds ?? [...selectedFolders];
  const count = fileIds.length + folderIds.length;
  if (!count) return;
  pendingBulk = { action, fileIds, folderIds };
  const moving = action === 'move';
  document.querySelector('#bulk-title')!.textContent = `${moving ? 'Move' : 'Delete'} ${count} item${count === 1 ? '' : 's'}?`;
  document.querySelector('#bulk-description')!.textContent = moving ? 'Folders move with all their contents. Choose a destination.' : 'Selected files will be permanently deleted. Every selected folder must already be empty. This cannot be undone.';
  bulkDestination.hidden = !moving; bulkDestination.disabled = !moving;
  document.querySelector<HTMLElement>('#bulk-destination-label')!.hidden = !moving;
  bulkDestination.replaceChildren();
  bulkError.textContent = '';
  bulkConfirm.disabled = false;
  setButton(bulkConfirm, moving ? 'Move selected' : 'Delete permanently', moving ? 'folder-input' : 'trash-2');
  if (moving) {
    const movingFolders = new Set(folderIds);
    const choices = [{ id: null as number | null, name: 'All files (root)' }, ...folders.filter(folder => !folderTrail(folder.id).some(parent => movingFolders.has(parent.id))).map(folder => ({ id: folder.id, name: folderTrail(folder.id).map(item => item.name).join(' / ') })).sort((a,b) => a.name.localeCompare(b.name))];
    for (const choice of choices) { const option = document.createElement('option'); option.value = choice.id === null ? '' : String(choice.id); option.textContent = choice.name; bulkDestination.append(option); }
    bulkDestination.value = currentFolder === null ? '' : String(currentFolder);
  } else {
    const deletingFolders = new Set(folderIds);
    const blocked = folders.filter(folder => deletingFolders.has(folder.id) && (folders.some(child => child.parent_id === folder.id) || library.some(file => file.folderId === folder.id)));
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
  setButton(bulkConfirm, 'Working…', 'loader-circle');
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
    setLibraryMessage(action.action === 'move' ? 'Selected items moved.' : 'Selected items deleted.');
    if (result.cleanupPending) setLibraryMessage(`${fileMessage.textContent} Some stored data will be cleaned up after the server restarts.`);
    await loadFiles();
  } catch { if (version === sessionVersion) bulkError.textContent = 'Could not complete the request. Close this dialog and refresh before retrying.'; }
  finally {
    if (version === sessionVersion) { bulkBusy = false; bulkConfirm.disabled = false; setButton(bulkConfirm, action.action === 'move' ? 'Move selected' : 'Delete permanently', action.action === 'move' ? 'folder-input' : 'trash-2'); }
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
let sharedTarget: { id: number; name: string; kind: 'file' | 'folder' } | undefined;
let shareGeneration = 0;
let createdShareId: number | undefined;
function shareEndpoint(target: { id: number; kind: 'file' | 'folder' }) {
  return target.kind === 'folder' ? `/api/files/folders/${target.id}/shares` : `/api/files/${target.id}/shares`;
}
function openShare(item: LibraryFile | LibraryFolder, kind: 'file' | 'folder' = 'file') {
  sharedTarget = { id: item.id, name: item.name, kind }; shareGeneration++;
  createdShareId = undefined;
  document.querySelector('#share-title')!.textContent = kind === 'folder' ? 'Share folder' : 'Share file';
  document.querySelector('#share-filename')!.textContent = item.name;
  document.querySelector('.share-notice')!.textContent = kind === 'folder'
    ? 'Anyone with this link can fully manage this folder and its contents while the link is active. Parent folders remain hidden.'
    : 'Anyone with this link can view or download this file while the link is active. You can revoke access below.';
  shareMessage.textContent = '';
  shareResult.hidden = true; shareUrl.value = '';
  shareForm.reset(); updateShareDuration();
  createShareButton.disabled = false; setButton(createShareButton, 'Create link', 'link-2');
  shareList.textContent = 'Loading active links…';
  if (!shareDialog.open) shareDialog.showModal();
  void loadShares();
}
shareDialog.addEventListener('close', () => { shareGeneration++; sharedTarget = undefined; shareUrl.value = ''; shareResult.hidden = true; shareList.replaceChildren(); });
document.querySelector('#close-share')!.addEventListener('click', () => shareDialog.close());
document.querySelector('#share-preview')!.addEventListener('click', () => { const file = previewFiles[previewIndex]; if (file) openShare(file); });
function updateShareDuration() {
  const infinite = shareUnit.value === 'infinite';
  shareDuration.disabled = infinite; shareDuration.required = !infinite;
  if (!infinite) {
    shareDuration.max = String(Math.floor(525600 / Number(shareUnit.value)));
    if (Number(shareDuration.value) > Number(shareDuration.max)) shareDuration.value = shareDuration.max;
    if (Number(shareDuration.value) < 1) shareDuration.value = '1';
  }
}
shareUnit.addEventListener('change', updateShareDuration);
document.querySelector('#refresh-shares')!.addEventListener('click', () => void loadShares());
async function loadShares() {
  if (!sharedTarget) return;
  const endpoint = shareEndpoint(sharedTarget);
  const generation = shareGeneration;
  try {
    const response = await fetch(endpoint);
    if (generation !== shareGeneration) return;
    if (response.status === 401) { showSession(); return; }
    if (!response.ok) throw new Error('Could not load links. Use Refresh links to try again.');
    const result = await response.json() as { links: { id: number; created_at: number; expires_at: number; neverExpires: boolean }[] };
    if (generation !== shareGeneration) return;
    shareList.replaceChildren();
    if (!result.links.length) shareList.textContent = 'No active links.';
    for (const link of result.links) {
      const row = document.createElement('div'); row.className = 'share-link-row';
      const description = document.createElement('span'); description.textContent = `Link ${link.id} · ${link.neverExpires ? 'does not expire' : `expires ${new Date(link.expires_at).toLocaleString()}`}`;
      const revoke = document.createElement('button'); revoke.type = 'button'; revoke.className = 'text-button danger'; revoke.append(icon('unlink'), 'Revoke'); revoke.setAttribute('aria-label', `Revoke link ${link.id}`);
      revoke.addEventListener('click', async () => {
        revoke.disabled = true;
        try {
          const response = await fetch(`${endpoint}/${link.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' });
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
    refreshIcons();
  } catch (error) { if (generation === shareGeneration) shareList.textContent = error instanceof Error ? error.message : 'Could not load links.'; }
}
shareForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!sharedTarget || createShareButton.disabled) return;
  const generation = shareGeneration;
  const target = sharedTarget;
  createShareButton.disabled = true; setButton(createShareButton, 'Creating…', 'loader-circle'); shareMessage.textContent = '';
  try {
    const durationMinutes = shareUnit.value === 'infinite' ? 'infinite' : Number(shareDuration.value) * Number(shareUnit.value);
    const response = await fetch(shareEndpoint(target), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ durationMinutes }) });
    if (generation !== shareGeneration) return;
    if (response.status === 401) { showSession(); return; }
    const result = await response.json();
    if (generation !== shareGeneration) return;
    if (!response.ok) { shareMessage.textContent = result.error || 'Could not create link.'; return; }
    createdShareId = result.id;
    shareUrl.value = new URL(result.path, location.origin).href;
    shareResult.hidden = false;
    document.querySelector('#share-expiry')!.textContent = result.neverExpires ? 'Does not expire. Revoke it from Active links when access should end.' : `Expires ${new Date(result.expiresAt).toLocaleString()}`;
    shareMessage.textContent = `Link created. Copy it to share this ${target.kind}.`;
    await loadShares();
  } catch { if (generation === shareGeneration) shareMessage.textContent = 'Could not create the link. Refresh active links before retrying.'; }
  finally { if (generation === shareGeneration) { createShareButton.disabled = false; setButton(createShareButton, 'Create link', 'link-2'); } }
});
document.querySelector('#copy-share')!.addEventListener('click', async () => {
  if (!shareUrl.value) return;
  const generation = shareGeneration;
  try { await navigator.clipboard.writeText(shareUrl.value); if (generation === shareGeneration) shareMessage.textContent = 'Link copied.'; }
  catch { if (generation === shareGeneration) { shareUrl.focus(); shareUrl.select(); shareMessage.textContent = 'Select and copy the link above.'; } }
});
refreshIcons();

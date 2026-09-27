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
const usersLink = document.querySelector<HTMLAnchorElement>('#users-link')!;
let currentAccount: Account | undefined;
function showView() {
  const usersView = currentAccount?.role === 'admin' && location.hash === '#users';
  filesPanel.hidden = Boolean(usersView);
  adminPanel.hidden = !usersView;
  filesLink.toggleAttribute('aria-current', !usersView);
  usersLink.toggleAttribute('aria-current', Boolean(usersView));
  if (usersView) usersLink.setAttribute('aria-current', 'page');
  else filesLink.setAttribute('aria-current', 'page');
  if (currentAccount && !usersView && location.hash !== '#files') history.replaceState(null, '', '#files');
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


type LibraryFile = { id: number; name: string; size: number; createdAt: string };
const fileList = document.querySelector<HTMLElement>('#file-list')!;
const fileMessage = document.querySelector<HTMLElement>('#file-message')!;
const fileSummary = document.querySelector<HTMLElement>('#file-summary')!;
const fileSearch = document.querySelector<HTMLInputElement>('#file-search')!;
const uploadForm = document.querySelector<HTMLFormElement>('#upload-form')!;
const uploadInput = document.querySelector<HTMLInputElement>('#upload-files')!;
const uploadButton = document.querySelector<HTMLButtonElement>('#upload-submit')!;
let library: LibraryFile[] = [];
let maxUploadBytes = 100 * 1024 * 1024;
let uploadController: AbortController | undefined;
let listRequest = 0;
function resetFiles() {
  document.querySelector<HTMLDialogElement>('#file-dialog')?.close();
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
  fileList.replaceChildren();
  const filtered = library.filter(file => file.name.toLowerCase().includes(fileSearch.value.toLowerCase()));
  fileSummary.textContent = `${library.length} file${library.length === 1 ? '' : 's'} · ${sizeLabel(library.reduce((total, file) => total + file.size, 0))}`;
  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = library.length ? 'No matching files.' : 'Your cloud is empty. Upload your first file above.';
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
    actions.append(download, rename, remove);
    row.append(details, actions);
    fileList.append(row);
  }
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
    maxUploadBytes = result.maxUploadBytes;
    renderFiles();
  } catch { if (version === sessionVersion && request === listRequest) fileMessage.textContent = 'Could not load files. Use Refresh to try again.'; }
}
async function changeFile(id: number, method: 'PATCH' | 'DELETE', body: object) {
  const version = sessionVersion;
  try {
    const response = await fetch(`/api/files/${id}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (version !== sessionVersion) return;
    if (response.status === 401) { showSession(); return; }
    if (!response.ok) { fileMessage.textContent = (await response.json()).error; return; }
    fileMessage.textContent = method === 'PATCH' ? 'File renamed.' : 'File deleted.';
    await loadFiles();
  } catch { if (version === sessionVersion) fileMessage.textContent = 'Could not complete the change. Refresh your files before trying again.'; }
}
uploadForm.addEventListener('submit', async event => {
  event.preventDefault();
  const selected = Array.from(uploadInput.files || []);
  if (!selected.length) return;
  if (selected.some(file => file.size > maxUploadBytes)) { fileMessage.textContent = `Each file must be ${sizeLabel(maxUploadBytes)} or smaller.`; return; }
  const version = sessionVersion;
  const controller = new AbortController();
  uploadController = controller;
  uploadButton.disabled = true;
  uploadButton.textContent = 'Uploading…';
  let completed = 0;
  try {
    for (const file of selected) {
      if (version !== sessionVersion) return;
      fileMessage.textContent = `Uploading ${completed + 1} of ${selected.length}: ${file.name}`;
      const response = await fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file, signal: controller.signal });
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
fileSearch.addEventListener('input', renderFiles);
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

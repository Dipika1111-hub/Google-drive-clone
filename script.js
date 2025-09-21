const DB_NAME = 'gdrive-db';
const STORE_NAME = 'files';
let db = null;

// --- IndexedDB helpers ---
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const idb = e.target.result;
      if (!idb.objectStoreNames.contains(STORE_NAME)) {
        const store = idb.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; res(db); };
    req.onerror = (e) => rej(e.target.error);
  });
}

function addFileEntry(entry) {
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.add(entry);
    req.onsuccess = () => res(true);
    req.onerror = (e) => rej(e.target.error);
  });
}

function getAllFiles() {
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => res(req.result.sort((a,b)=>b.createdAt - a.createdAt));
    req.onerror = (e) => rej(e.target.error);
  });
}

function deleteFile(id) {
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => res(true);
    req.onerror = (e) => rej(e.target.error);
  });
}

function clearAllFiles() {
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => res(true);
    req.onerror = (e) => rej(e.target.error);
  });
}

// --- UI & logic ---
const fileInput = document.getElementById('file-input');
const chooseBtn = document.getElementById('choose-btn');
const uploadBtn = document.getElementById('upload-btn');
const filesBody = document.getElementById('files-body');
const searchInput = document.getElementById('search');
const refreshBtn = document.getElementById('refresh-btn');
const dropzone = document.getElementById('dropzone');
const clearBtn = document.getElementById('clear-btn');
const totalFilesEl = document.getElementById('total-files');
const totalSizeEl = document.getElementById('total-size');

chooseBtn.addEventListener('click', ()=>fileInput.click());
dropzone.addEventListener('click', ()=>fileInput.click());
refreshBtn.addEventListener('click', renderList);
clearBtn.addEventListener('click', async ()=>{
  if (!confirm('Delete ALL files stored in this browser?')) return;
  await clearAllFiles();
  renderList();
});

fileInput.addEventListener('change', async (e)=>{
  const files = Array.from(e.target.files || []);
  if (files.length) await handleFilesUpload(files);
  fileInput.value = '';
});

uploadBtn.addEventListener('click', async ()=>{
  // fallback: open dialog
  fileInput.click();
});

searchInput.addEventListener('input', debounce(()=>renderList(), 260));

;['dragenter','dragover'].forEach(ev=>{
  dropzone.addEventListener(ev, (e)=>{ e.preventDefault(); dropzone.classList.add('dragover'); });
});
;['dragleave','drop'].forEach(ev=>{
  dropzone.addEventListener(ev, (e)=>{ e.preventDefault(); dropzone.classList.remove('dragover'); });
});
dropzone.addEventListener('drop', async (e)=>{
  const dt = e.dataTransfer;
  if (!dt) return;
  const files = Array.from(dt.files || []);
  if (files.length) await handleFilesUpload(files);
});

async function handleFilesUpload(files) {
  // add each file to IndexedDB
  for (const f of files) {
    const id = cryptoRandomId();
    const entry = {
      id,
      name: f.name,
      size: f.size,
      type: f.type || 'unknown',
      createdAt: Date.now(),
      // store blob directly
      blob: f
    };
    try {
      await addFileEntry(entry);
    } catch (err) {
      console.error('Add file failed', err);
      alert('Failed to save file: ' + f.name);
    }
  }
  await renderList();
}

/* render table */
async function renderList() {
  const q = (searchInput.value || '').trim().toLowerCase();
  const items = await getAllFiles();
  const filtered = q ? items.filter(it => it.name.toLowerCase().includes(q)) : items;

  filesBody.innerHTML = '';
  if (!filtered.length) {
    filesBody.innerHTML = '<tr><td colspan="5" class="empty">No files found.</td></tr>';
  } else {
    for (const it of filtered) {
      const tr = document.createElement('tr');

      const nameTd = document.createElement('td');
      const nameEl = document.createElement('div');
      nameEl.textContent = it.name;
      nameEl.style.fontWeight = '600';
      const sub = document.createElement('div');
      sub.textContent = it.type || '—';
      sub.className = 'small';
      nameTd.appendChild(nameEl);
      nameTd.appendChild(sub);

      const sizeTd = document.createElement('td');
      sizeTd.textContent = formatBytes(it.size);

      const typeTd = document.createElement('td');
      typeTd.textContent = it.type || '—';

      const dateTd = document.createElement('td');
      const d = new Date(it.createdAt);
      dateTd.textContent = d.toLocaleString();

      const actionsTd = document.createElement('td');
      actionsTd.className = 'row-actions';

      // download
      const dlBtn = document.createElement('button');
      dlBtn.className = 'btn';
      dlBtn.textContent = 'Download';
      dlBtn.addEventListener('click', async ()=>{
        await downloadFile(it);
      });

      // preview (if image)
      const previewBtn = document.createElement('button');
      previewBtn.className = 'btn';
      previewBtn.textContent = 'Preview';
      if (!it.type.startsWith('image/')) previewBtn.style.display = 'none';
      previewBtn.addEventListener('click', async ()=>{
        await previewImage(it);
      });

      // delete
      const delBtn = document.createElement('button');
      delBtn.className = 'btn';
      delBtn.style.background = 'transparent';
      delBtn.style.border = '1px solid rgba(255,255,255,0.04)';
      delBtn.style.color = 'var(--muted)';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async ()=>{
        if (!confirm('Delete "'+it.name+'"?')) return;
        await deleteFile(it.id);
        await renderList();
      });

      actionsTd.appendChild(dlBtn);
      actionsTd.appendChild(previewBtn);
      actionsTd.appendChild(delBtn);

      tr.appendChild(nameTd);
      tr.appendChild(sizeTd);
      tr.appendChild(typeTd);
      tr.appendChild(dateTd);
      tr.appendChild(actionsTd);
      filesBody.appendChild(tr);
    }
  }

  // update meta
  const all = await getAllFiles();
  const total = all.reduce((s,i)=>s+i.size,0);
  totalFilesEl.textContent = 'Files: ' + all.length;
  totalSizeEl.textContent = 'Used: ' + formatBytes(total);
}

/* download: createObjectURL from blob stored in DB */
async function downloadFile(item) {
  // open transaction to get latest blob (item may already contain blob)
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const req = store.get(item.id);
  req.onsuccess = () => {
    const rec = req.result;
    if (!rec) { alert('File not found'); return; }
    const blob = rec.blob;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = rec.name || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  req.onerror = (e) => { alert('Error reading file'); console.error(e); };
}

/* preview image in new window */
async function previewImage(item) {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const req = store.get(item.id);
  req.onsuccess = () => {
    const rec = req.result;
    if (!rec) return;
    const url = URL.createObjectURL(rec.blob);
    const w = window.open('', '_blank');
    if (!w) { alert('Popup blocked — allow popups to preview.'); return; }
    w.document.write('<title>Preview: '+escapeHtml(rec.name)+'</title>');
    w.document.write('<img src="'+url+'" style="max-width:100%;height:auto;display:block;margin:20px auto">');
    // revoke when window closed
    const revoke = () => URL.revokeObjectURL(url);
    w.addEventListener('beforeunload', revoke);
  };
}

/* utils */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(bytes)/Math.log(k));
  return parseFloat((bytes / Math.pow(k,i)).toFixed(2)) + ' ' + sizes[i];
}
function cryptoRandomId() {
  // 16-char base36 id
  const a = crypto.getRandomValues(new Uint32Array(4));
  return Array.from(a).map(n => n.toString(36)).join('').slice(0,24);
}
function debounce(fn, wait=200){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

/* init */
(async () => {
  try {
    await openDB();
    await renderList();
  } catch (err) {
    console.error('Init error', err);
    alert('IndexedDB unavailable in this browser / mode. Try a modern desktop browser (not incognito).');
  }
})();

/* Dispensa - app locale per tracciare frigo, dispensa e cantina
   Dati salvati in localStorage, nessun server coinvolto. */

const STORAGE_KEY = 'dispensa.items.v1';
const CATS = ['Proteine', 'Carboidrati', 'Grassi', 'Frutta e Verdura', 'Altro'];
const SOON_DAYS = 3; // entro quanti giorni un alimento è "in scadenza"
const PANTRY_LOCS = ['dispensa', 'cantina']; // sezioni raggruppate per macronutriente
const LOC_LABEL = { frigo: 'Frigo', dispensa: 'Dispensa', cantina: 'Cantina' };

let state = {
  loc: 'frigo',
  search: '',
  frigoItemId: null,
  moveItemId: null,
};

// ---------- Storage ----------
function loadItems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Errore lettura dati', e);
    return [];
  }
}
function saveItems(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}
function uid() {
  return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- Date helpers ----------
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d - today) / 86400000);
}
function expiryClass(dateStr) {
  const days = daysUntil(dateStr);
  if (days === null) return 'green';
  if (days < 0) return 'red';
  if (days <= SOON_DAYS) return 'amber';
  return 'green';
}
function expiryLabel(dateStr) {
  const days = daysUntil(dateStr);
  if (days === null) return 'senza scadenza';
  if (days < 0) return `scaduto da ${Math.abs(days)}g`;
  if (days === 0) return 'scade oggi';
  if (days === 1) return 'scade domani';
  return `scade tra ${days}g`;
}

// ---------- Rendering ----------
function render() {
  const items = loadItems();
  const locItems = items.filter(it => it.loc === state.loc);
  const filtered = locItems.filter(it => {
    if (state.search && !it.name.toLowerCase().includes(state.search.toLowerCase())) return false;
    return true;
  });

  const expiredCount = locItems.filter(it => daysUntil(it.expiry) !== null && daysUntil(it.expiry) < 0).length;
  const soonCount = locItems.filter(it => {
    const d = daysUntil(it.expiry);
    return d !== null && d >= 0 && d <= SOON_DAYS;
  }).length;
  document.getElementById('cnt-expired').textContent = expiredCount;
  document.getElementById('cnt-soon').textContent = soonCount;
  document.getElementById('cnt-total').textContent = locItems.length;

  const list = document.getElementById('list');
  list.innerHTML = '';

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty">Nessun alimento qui. Tocca + per aggiungerne uno.</div>';
    return;
  }

  if (state.loc === 'frigo') {
    // Frigo: nessun raggruppamento per categoria, solo ordine di scadenza
    const sorted = [...filtered].sort(sortByExpiry);
    const group = document.createElement('div');
    group.className = 'group';
    sorted.forEach(it => group.appendChild(renderItemRow(it)));
    list.appendChild(group);
  } else {
    // Dispensa / Cantina: raggruppati per macronutriente
    CATS.forEach(cat => {
      const catItems = filtered.filter(it => it.cat === cat).sort(sortByExpiry);
      if (catItems.length === 0) return;
      const group = document.createElement('div');
      group.className = 'group';
      const h2 = document.createElement('h2');
      h2.textContent = `${cat} (${catItems.length})`;
      group.appendChild(h2);
      catItems.forEach(it => group.appendChild(renderItemRow(it)));
      list.appendChild(group);
    });
  }

  if (list.innerHTML === '') {
    list.innerHTML = '<div class="empty">Nessun risultato.</div>';
  }
}
function sortByExpiry(a, b) {
  const da = a.expiry ? new Date(a.expiry) : new Date('9999-12-31');
  const db = b.expiry ? new Date(b.expiry) : new Date('9999-12-31');
  return da - db;
}
function renderItemRow(it) {
  const row = document.createElement('div');
  row.className = 'item';
  row.dataset.id = it.id;
  row.innerHTML = `
    <div class="dot ${expiryClass(it.expiry)}"></div>
    <div class="info">
      <div class="name">${escapeHtml(it.name)}</div>
      <div class="meta">${expiryLabel(it.expiry)}${it.notes ? ' · ' + escapeHtml(it.notes) : ''}</div>
    </div>
    <div class="qty">${escapeHtml(it.qty || '')}</div>
  `;
  row.addEventListener('click', () => openItemSheet(it.id));
  return row;
}
function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Sheet: aggiunta nuovo alimento ----------
function toggleCatField(locValue) {
  document.getElementById('field-cat').style.display = locValue === 'frigo' ? 'none' : 'block';
}
function openAddSheet() {
  document.getElementById('f-name').value = '';
  document.getElementById('f-loc').value = state.loc;
  document.getElementById('f-cat').value = 'Altro';
  document.getElementById('f-qty').value = '1';
  document.getElementById('f-exp').value = '';
  document.getElementById('f-notes').value = '';
  toggleCatField(state.loc);
  showSheet('sheet-add');
}
function saveAdd() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) {
    showToast('Inserisci un nome');
    return;
  }
  const loc = document.getElementById('f-loc').value;
  const items = loadItems();
  items.push({
    id: uid(),
    name,
    loc,
    cat: document.getElementById('f-cat').value,
    qty: document.getElementById('f-qty').value.trim() || '1',
    expiry: document.getElementById('f-exp').value,
    notes: document.getElementById('f-notes').value.trim(),
    added: Date.now(),
  });
  saveItems(items);
  closeAllSheets();
  render();
  maybeNotify();
}

// ---------- Apertura scheda alimento esistente ----------
function openItemSheet(id) {
  const items = loadItems();
  const it = items.find(x => x.id === id);
  if (!it) return;
  if (it.loc === 'frigo') {
    openFrigoSheet(it);
  } else {
    openMoveSheet(it);
  }
}

// ---------- Sheet: modifica rapida Frigo ----------
function openFrigoSheet(it) {
  state.frigoItemId = it.id;
  document.getElementById('fr-name').value = it.name;
  document.getElementById('fr-exp').value = it.expiry || '';
  showSheet('sheet-frigo');
}
function saveFrigo() {
  const name = document.getElementById('fr-name').value.trim();
  if (!name) {
    showToast('Inserisci un nome');
    return;
  }
  const items = loadItems();
  const idx = items.findIndex(x => x.id === state.frigoItemId);
  if (idx >= 0) {
    items[idx].name = name;
    items[idx].expiry = document.getElementById('fr-exp').value;
    saveItems(items);
  }
  closeAllSheets();
  render();
  maybeNotify();
}
function deleteFrigo() {
  const items = loadItems().filter(x => x.id !== state.frigoItemId);
  saveItems(items);
  closeAllSheets();
  render();
}

// ---------- Sheet: sposta / rimuovi (Dispensa/Cantina) ----------
function openMoveSheet(it) {
  state.moveItemId = it.id;
  document.getElementById('move-title').textContent = it.name;
  const other = PANTRY_LOCS.find(l => l !== it.loc);
  document.getElementById('btn-move-other').textContent = `Sposta in ${LOC_LABEL[other]}`;
  document.getElementById('move-actions').style.display = 'block';
  document.getElementById('move-frigo-date').style.display = 'none';
  showSheet('sheet-move');
}
function moveToOtherPantry() {
  const items = loadItems();
  const idx = items.findIndex(x => x.id === state.moveItemId);
  if (idx >= 0) {
    const other = PANTRY_LOCS.find(l => l !== items[idx].loc);
    items[idx].loc = other;
    saveItems(items);
  }
  closeAllSheets();
  render();
}
function showMoveToFrigoStep() {
  const items = loadItems();
  const it = items.find(x => x.id === state.moveItemId);
  document.getElementById('mv-exp').value = (it && it.expiry) || '';
  document.getElementById('move-actions').style.display = 'none';
  document.getElementById('move-frigo-date').style.display = 'block';
}
function backFromMoveToFrigo() {
  document.getElementById('move-actions').style.display = 'block';
  document.getElementById('move-frigo-date').style.display = 'none';
}
function confirmMoveToFrigo() {
  const exp = document.getElementById('mv-exp').value;
  if (!exp) {
    showToast('Inserisci una data di scadenza');
    return;
  }
  const items = loadItems();
  const idx = items.findIndex(x => x.id === state.moveItemId);
  if (idx >= 0) {
    items[idx].loc = 'frigo';
    items[idx].expiry = exp;
    saveItems(items);
  }
  closeAllSheets();
  render();
  maybeNotify();
}
function deleteFromMove() {
  const items = loadItems().filter(x => x.id !== state.moveItemId);
  saveItems(items);
  closeAllSheets();
  render();
}

// ---------- Gestione sheet condivisa ----------
function showSheet(id) {
  document.getElementById('backdrop').classList.add('show');
  document.getElementById(id).classList.add('show');
}
function closeAllSheets() {
  document.getElementById('backdrop').classList.remove('show');
  ['sheet-add', 'sheet-frigo', 'sheet-move'].forEach(id => {
    document.getElementById(id).classList.remove('show');
  });
  state.frigoItemId = null;
  state.moveItemId = null;
}

// ---------- Toast ----------
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- Notifications (locali, solo quando l'app è aperta) ----------
function maybeNotify() {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  const items = loadItems();
  const urgent = items.filter(it => {
    const d = daysUntil(it.expiry);
    return d !== null && d <= SOON_DAYS;
  });
  if (urgent.length > 0) {
    try {
      new Notification('Dispensa: alimenti in scadenza', {
        body: urgent.slice(0, 5).map(i => `${i.name} (${expiryLabel(i.expiry)})`).join('\n'),
      });
    } catch (e) { /* iOS può ignorare in alcuni contesti */ }
  }
}
document.getElementById('btn-notify').addEventListener('click', async () => {
  if (!('Notification' in window)) {
    showToast('Notifiche non supportate in questo browser');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    showToast('Notifiche attive: controllate ad ogni apertura');
    maybeNotify();
  } else {
    showToast('Permesso negato');
  }
});

// ---------- Export / Import ----------
document.getElementById('btn-export').addEventListener('click', () => {
  const data = JSON.stringify(loadItems(), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dispensa-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});
document.getElementById('btn-import').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed)) throw new Error('formato non valido');
        saveItems(parsed);
        render();
        showToast('Importazione completata');
      } catch (e) {
        showToast('File non valido');
      }
    };
    reader.readAsText(file);
  });
  input.click();
});

// ---------- Barcode scanner + Open Food Facts ----------
let html5QrCode = null;
function openScanner() {
  document.getElementById('scanner').classList.add('show');
  html5QrCode = new Html5Qrcode('reader');
  html5QrCode
    .start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 150 } },
      onScanSuccess,
      () => {}
    )
    .catch(() => {
      showToast('Impossibile accedere alla fotocamera');
      closeScanner();
    });
}
function closeScanner() {
  if (html5QrCode) {
    html5QrCode.stop().catch(() => {}).finally(() => {
      html5QrCode.clear();
      html5QrCode = null;
    });
  }
  document.getElementById('scanner').classList.remove('show');
}
async function onScanSuccess(decodedText) {
  closeScanner();
  showToast('Codice letto, ricerca prodotto...');
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${decodedText}.json`);
    const json = await res.json();
    if (json.status === 1 && json.product) {
      const p = json.product;
      document.getElementById('f-name').value = p.product_name || p.generic_name || decodedText;
      const n = p.nutriments || {};
      const prot = parseFloat(n['proteins_100g']) || 0;
      const carb = parseFloat(n['carbohydrates_100g']) || 0;
      const fat = parseFloat(n['fat_100g']) || 0;
      let guess = 'Altro';
      if (prot >= carb && prot >= fat && prot > 0) guess = 'Proteine';
      else if (carb >= prot && carb >= fat && carb > 0) guess = 'Carboidrati';
      else if (fat > 0) guess = 'Grassi';
      document.getElementById('f-cat').value = guess;
      showToast('Prodotto trovato: ' + (p.product_name || 'senza nome'));
    } else {
      document.getElementById('f-name').value = decodedText;
      showToast('Prodotto non trovato nel database, nome impostato al codice');
    }
  } catch (e) {
    document.getElementById('f-name').value = decodedText;
    showToast('Ricerca online non riuscita');
  }
}

// ---------- Event wiring ----------
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.loc = tab.dataset.loc;
    render();
  });
});
document.getElementById('search').addEventListener('input', e => {
  state.search = e.target.value;
  render();
});
document.getElementById('f-loc').addEventListener('change', e => toggleCatField(e.target.value));

document.getElementById('btn-add').addEventListener('click', openAddSheet);
document.getElementById('btn-add-cancel').addEventListener('click', closeAllSheets);
document.getElementById('btn-add-save').addEventListener('click', saveAdd);

document.getElementById('btn-frigo-cancel').addEventListener('click', closeAllSheets);
document.getElementById('btn-frigo-save').addEventListener('click', saveFrigo);
document.getElementById('btn-frigo-delete').addEventListener('click', deleteFrigo);

document.getElementById('btn-move-frigo').addEventListener('click', showMoveToFrigoStep);
document.getElementById('btn-move-other').addEventListener('click', moveToOtherPantry);
document.getElementById('btn-move-delete').addEventListener('click', deleteFromMove);
document.getElementById('btn-move-cancel').addEventListener('click', closeAllSheets);
document.getElementById('btn-move-frigo-back').addEventListener('click', backFromMoveToFrigo);
document.getElementById('btn-move-frigo-confirm').addEventListener('click', confirmMoveToFrigo);

document.getElementById('backdrop').addEventListener('click', closeAllSheets);
document.getElementById('btn-scan').addEventListener('click', openScanner);
document.getElementById('btn-close-scan').addEventListener('click', closeScanner);

// ---------- PWA / Service worker ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ---------- Init ----------
render();
maybeNotify();

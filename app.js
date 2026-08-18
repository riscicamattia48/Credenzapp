/* Dispensa - app locale per tracciare frigo e dispensa
   Dati salvati in localStorage, nessun server coinvolto. */

const STORAGE_KEY = 'dispensa.items.v1';
const CATS = ['Proteine', 'Carboidrati', 'Grassi', 'Frutta e Verdura', 'Altro'];
const SOON_DAYS = 3; // entro quanti giorni un alimento è "in scadenza"

let state = {
  loc: 'frigo',
  search: '',
  editingId: null,
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
  const filtered = items.filter(it => {
    if (it.loc !== state.loc) return false;
    if (state.search && !it.name.toLowerCase().includes(state.search.toLowerCase())) return false;
    return true;
  });

  // summary counts (computed on the whole location, not just search filter)
  const locItems = items.filter(it => it.loc === state.loc);
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

  CATS.forEach(cat => {
    const catItems = filtered
      .filter(it => it.cat === cat)
      .sort((a, b) => {
        const da = a.expiry ? new Date(a.expiry) : new Date('9999-12-31');
        const db = b.expiry ? new Date(b.expiry) : new Date('9999-12-31');
        return da - db;
      });
    if (catItems.length === 0) return;

    const group = document.createElement('div');
    group.className = 'group';
    const h2 = document.createElement('h2');
    h2.textContent = `${cat} (${catItems.length})`;
    group.appendChild(h2);

    catItems.forEach(it => {
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
      row.addEventListener('click', () => openSheet(it.id));
      group.appendChild(row);
    });
    list.appendChild(group);
  });

  if (list.innerHTML === '') {
    list.innerHTML = '<div class="empty">Nessun risultato.</div>';
  }
}
function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Sheet (add/edit form) ----------
function openSheet(id) {
  state.editingId = id || null;
  const items = loadItems();
  const it = id ? items.find(x => x.id === id) : null;

  document.getElementById('sheet-title').textContent = it ? 'Modifica alimento' : 'Nuovo alimento';
  document.getElementById('f-name').value = it ? it.name : '';
  document.getElementById('f-loc').value = it ? it.loc : state.loc;
  document.getElementById('f-cat').value = it ? it.cat : 'Altro';
  document.getElementById('f-qty').value = it ? (it.qty || '') : '';
  document.getElementById('f-exp').value = it ? (it.expiry || '') : '';
  document.getElementById('f-notes').value = it ? (it.notes || '') : '';
  document.getElementById('btn-delete').style.display = it ? 'block' : 'none';

  document.getElementById('backdrop').classList.add('show');
  document.getElementById('sheet').classList.add('show');
}
function closeSheet() {
  document.getElementById('backdrop').classList.remove('show');
  document.getElementById('sheet').classList.remove('show');
  state.editingId = null;
}
function saveFromSheet() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) {
    showToast('Inserisci un nome');
    return;
  }
  const items = loadItems();
  const data = {
    name,
    loc: document.getElementById('f-loc').value,
    cat: document.getElementById('f-cat').value,
    qty: document.getElementById('f-qty').value.trim(),
    expiry: document.getElementById('f-exp').value,
    notes: document.getElementById('f-notes').value.trim(),
  };
  if (state.editingId) {
    const idx = items.findIndex(x => x.id === state.editingId);
    if (idx >= 0) items[idx] = { ...items[idx], ...data };
  } else {
    items.push({ id: uid(), ...data, added: Date.now() });
  }
  saveItems(items);
  closeSheet();
  render();
  maybeNotify();
}
function deleteCurrent() {
  if (!state.editingId) return;
  const items = loadItems().filter(x => x.id !== state.editingId);
  saveItems(items);
  closeSheet();
  render();
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
document.getElementById('btn-add').addEventListener('click', () => openSheet(null));
document.getElementById('btn-cancel').addEventListener('click', closeSheet);
document.getElementById('backdrop').addEventListener('click', closeSheet);
document.getElementById('btn-save').addEventListener('click', saveFromSheet);
document.getElementById('btn-delete').addEventListener('click', deleteCurrent);
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

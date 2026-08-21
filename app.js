/* CredenzApp - app locale per tracciare frigo, dispensa e cantina
   Dati salvati in localStorage, nessun server coinvolto. */

const STORAGE_KEY = 'dispensa.items.v1';
const CAT_EMOJI = { 'Proteine': '🥩', 'Carboidrati': '🍝', 'Grassi': '🫒', 'Altro': '🥫' };
const CATS = Object.keys(CAT_EMOJI);
const SOON_DAYS = 3; // entro quanti giorni un alimento è "in scadenza"
const PANTRY_LOCS = ['dispensa', 'cantina']; // sezioni raggruppate per macronutriente
const LOC_LABEL = { frigo: 'Frigo', dispensa: 'Dispensa', cantina: 'Cantina' };

let state = {
  loc: 'frigo',
  search: '',
  frigoItemId: null,
  moveItemId: null,
  pendingSplit: null,
};

// ---------- Categorie compattate/espanse (solo Dispensa/Cantina) ----------
// Ricordata tra le sessioni: di default tutte le categorie partono compattate.
const EXPANDED_CATS_KEY = 'dispensa.expandedCats.v1';
function loadExpandedCats() {
  try {
    const raw = localStorage.getItem(EXPANDED_CATS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (e) {
    return new Set();
  }
}
function saveExpandedCats(set) {
  localStorage.setItem(EXPANDED_CATS_KEY, JSON.stringify([...set]));
}
let expandedCats = loadExpandedCats();
function toggleCat(key) {
  if (expandedCats.has(key)) {
    expandedCats.delete(key);
  } else {
    expandedCats.add(key);
  }
  saveExpandedCats(expandedCats);
  render();
}

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
// Salva in locale e, se configurata, sincronizza anche verso il Gist GitHub
// usato dallo Shortcut per la notifica delle 10.
function persistItems(items) {
  saveItems(items);
  syncToGist(items);
}
function uid() {
  return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
// Numero di pezzi di un alimento (sempre almeno 1, anche su dati vecchi/non numerici).
function getTotalQty(it) {
  const n = parseInt(it && it.qty, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
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
// Somma i pezzi reali (qty) di un elenco di alimenti, invece di contare
// semplicemente quante voci ci sono: 4 uova scadute contano come 4, non come 1.
function sumQty(arr) {
  return arr.reduce((total, it) => {
    const q = parseInt(it.qty, 10);
    return total + (Number.isFinite(q) && q > 0 ? q : 1);
  }, 0);
}
function render() {
  const items = loadItems();
  const locItems = items.filter(it => it.loc === state.loc);
  const filtered = locItems.filter(it => {
    if (state.search && !it.name.toLowerCase().includes(state.search.toLowerCase())) return false;
    return true;
  });

  const expiredCount = sumQty(locItems.filter(it => daysUntil(it.expiry) !== null && daysUntil(it.expiry) < 0));
  const soonCount = sumQty(locItems.filter(it => {
    const d = daysUntil(it.expiry);
    return d !== null && d >= 0 && d <= SOON_DAYS;
  }));
  document.getElementById('cnt-expired').textContent = expiredCount;
  document.getElementById('cnt-soon').textContent = soonCount;
  document.getElementById('cnt-total').textContent = sumQty(locItems);

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
    // Dispensa / Cantina: raggruppati per macronutriente, compattati di default.
    // Mentre si cerca, le categorie con risultati si mostrano sempre espanse.
    const searching = state.search.trim().length > 0;
    CATS.forEach(cat => {
      const catItems = filtered.filter(it => it.cat === cat).sort(sortByExpiry);
      if (catItems.length === 0) return;
      const key = state.loc + ':' + cat;
      const expanded = searching || expandedCats.has(key);
      const group = document.createElement('div');
      group.className = 'group';
      const h2 = document.createElement('h2');
      h2.className = 'group-toggle';
      h2.innerHTML = `<span class="chev">${expanded ? '▾' : '▸'}</span> ${CAT_EMOJI[cat] || ''} ${cat} (${sumQty(catItems)})`;
      if (!searching) {
        h2.addEventListener('click', () => toggleCat(key));
      }
      group.appendChild(h2);
      if (expanded) {
        catItems.forEach(it => group.appendChild(renderItemRow(it)));
      }
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
function toggleFieldsByLoc(locValue) {
  // La categoria (macronutriente) serve solo in Dispensa/Cantina.
  document.getElementById('field-cat').style.display = locValue === 'frigo' ? 'none' : 'block';
  // La scadenza si gestisce solo in Frigo: in Dispensa/Cantina non si compila.
  document.getElementById('field-exp').style.display = locValue === 'frigo' ? 'block' : 'none';
}
function openAddSheet() {
  document.getElementById('f-name').value = '';
  document.getElementById('f-loc').value = state.loc;
  document.getElementById('f-cat').value = 'Altro';
  document.getElementById('f-qty').value = '1';
  document.getElementById('f-exp').value = '';
  document.getElementById('f-notes').value = '';
  toggleFieldsByLoc(state.loc);
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
  const qtyRaw = parseInt(document.getElementById('f-qty').value, 10);
  const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
  items.push({
    id: uid(),
    name,
    loc,
    cat: document.getElementById('f-cat').value,
    qty: String(qty),
    expiry: loc === 'frigo' ? document.getElementById('f-exp').value : '',
    notes: document.getElementById('f-notes').value.trim(),
    added: Date.now(),
  });
  persistItems(items);
  closeAllSheets();
  render();
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
  document.getElementById('fr-notes').value = it.notes || '';
  showSheet('sheet-frigo');
}
function saveFrigo() {
  const name = document.getElementById('fr-name').value.trim();
  if (!name) {
    showToast('Inserisci un nome');
    return;
  }
  const newExpiry = document.getElementById('fr-exp').value;
  const notes = document.getElementById('fr-notes').value.trim();
  const items = loadItems();
  const it = items.find(x => x.id === state.frigoItemId);
  if (!it) {
    closeAllSheets();
    render();
    return;
  }
  const total = getTotalQty(it);
  const expiryChanged = (it.expiry || '') !== (newExpiry || '');
  if (total > 1 && expiryChanged) {
    openQtySheet({
      total,
      title: 'Per quanti pezzi vale la nuova scadenza?',
      desc: `"${it.name}" ha ${total} pezzi con la stessa scadenza. Indica per quanti aggiornarla: gli altri manterranno la scadenza originale e appariranno come voce separata.`,
      onConfirm: (chosen) => {
        const items2 = loadItems();
        const idx = items2.findIndex(x => x.id === it.id);
        if (idx >= 0) {
          const cur = items2[idx];
          const curTotal = getTotalQty(cur);
          if (chosen >= curTotal) {
            cur.name = name;
            cur.expiry = newExpiry;
            cur.notes = notes;
          } else {
            cur.name = name;
            cur.qty = String(curTotal - chosen);
            cur.notes = notes;
            items2.push({
              id: uid(),
              name,
              loc: 'frigo',
              cat: cur.cat,
              qty: String(chosen),
              expiry: newExpiry,
              notes,
              added: Date.now(),
            });
          }
          persistItems(items2);
        }
        closeAllSheets();
        render();
      },
    });
    return;
  }
  const idx = items.findIndex(x => x.id === state.frigoItemId);
  if (idx >= 0) {
    items[idx].name = name;
    items[idx].expiry = newExpiry;
    items[idx].notes = notes;
    persistItems(items);
  }
  closeAllSheets();
  render();
}
function deleteFrigo() {
  const items = loadItems();
  const it = items.find(x => x.id === state.frigoItemId);
  if (!it) {
    closeAllSheets();
    render();
    return;
  }
  const total = getTotalQty(it);
  if (total > 1) {
    openQtySheet({
      total,
      title: 'Quanti pezzi rimuovere?',
      desc: `"${it.name}" ha ${total} pezzi. Indica quanti rimuoverne: gli altri resteranno in elenco.`,
      onConfirm: (chosen) => {
        const items2 = loadItems();
        const idx = items2.findIndex(x => x.id === it.id);
        if (idx >= 0) {
          const cur = items2[idx];
          const curTotal = getTotalQty(cur);
          if (chosen >= curTotal) {
            items2.splice(idx, 1);
          } else {
            cur.qty = String(curTotal - chosen);
          }
          persistItems(items2);
        }
        closeAllSheets();
        render();
      },
    });
    return;
  }
  const items2 = items.filter(x => x.id !== state.frigoItemId);
  persistItems(items2);
  closeAllSheets();
  render();
}

// ---------- Sheet: sposta / rimuovi (Dispensa/Cantina) ----------
function openMoveSheet(it) {
  state.moveItemId = it.id;
  document.getElementById('mv-name').value = it.name;
  document.getElementById('mv-notes').value = it.notes || '';
  const other = PANTRY_LOCS.find(l => l !== it.loc);
  document.getElementById('btn-move-other').textContent = `Sposta in ${LOC_LABEL[other]}`;
  document.getElementById('move-main').style.display = 'block';
  document.getElementById('move-frigo-date').style.display = 'none';
  showSheet('sheet-move');
}
function saveMoveName() {
  const name = document.getElementById('mv-name').value.trim();
  if (!name) {
    showToast('Inserisci un nome');
    return;
  }
  const notes = document.getElementById('mv-notes').value.trim();
  const items = loadItems();
  const idx = items.findIndex(x => x.id === state.moveItemId);
  if (idx >= 0) {
    items[idx].name = name;
    items[idx].notes = notes;
    persistItems(items);
  }
  closeAllSheets();
  render();
}
function moveToOtherPantry() {
  const name = document.getElementById('mv-name').value.trim();
  const notes = document.getElementById('mv-notes').value.trim();
  const items = loadItems();
  const it = items.find(x => x.id === state.moveItemId);
  if (!it) {
    closeAllSheets();
    render();
    return;
  }
  const other = PANTRY_LOCS.find(l => l !== it.loc);
  const total = getTotalQty(it);
  if (total > 1) {
    openQtySheet({
      total,
      title: `Quanti pezzi spostare in ${LOC_LABEL[other]}?`,
      desc: `"${it.name}" ha ${total} pezzi. Indica quanti spostare: gli altri resteranno qui.`,
      onConfirm: (chosen) => {
        const items2 = loadItems();
        const idx = items2.findIndex(x => x.id === it.id);
        if (idx >= 0) {
          const cur = items2[idx];
          const curTotal = getTotalQty(cur);
          if (name) cur.name = name;
          cur.notes = notes;
          if (chosen >= curTotal) {
            cur.loc = other;
          } else {
            cur.qty = String(curTotal - chosen);
            items2.push({
              id: uid(),
              name: cur.name,
              loc: other,
              cat: cur.cat,
              qty: String(chosen),
              expiry: '',
              notes,
              added: Date.now(),
            });
          }
          persistItems(items2);
        }
        closeAllSheets();
        render();
      },
    });
    return;
  }
  const idx = items.findIndex(x => x.id === state.moveItemId);
  if (idx >= 0) {
    items[idx].loc = other;
    if (name) items[idx].name = name;
    items[idx].notes = notes;
    persistItems(items);
  }
  closeAllSheets();
  render();
}
function showMoveToFrigoStep() {
  const items = loadItems();
  const it = items.find(x => x.id === state.moveItemId);
  document.getElementById('mv-exp').value = (it && it.expiry) || '';
  document.getElementById('move-main').style.display = 'none';
  document.getElementById('move-frigo-date').style.display = 'block';
}
function backFromMoveToFrigo() {
  document.getElementById('move-main').style.display = 'block';
  document.getElementById('move-frigo-date').style.display = 'none';
}
function confirmMoveToFrigo() {
  const exp = document.getElementById('mv-exp').value;
  if (!exp) {
    showToast('Inserisci una data di scadenza');
    return;
  }
  const name = document.getElementById('mv-name').value.trim();
  const notes = document.getElementById('mv-notes').value.trim();
  const items = loadItems();
  const it = items.find(x => x.id === state.moveItemId);
  if (!it) {
    closeAllSheets();
    render();
    return;
  }
  const total = getTotalQty(it);
  if (total > 1) {
    openQtySheet({
      total,
      title: 'Quanti pezzi spostare in Frigo?',
      desc: `"${it.name}" ha ${total} pezzi. Indica quanti spostare in Frigo con la scadenza indicata: gli altri resteranno qui.`,
      onConfirm: (chosen) => {
        const items2 = loadItems();
        const idx = items2.findIndex(x => x.id === it.id);
        if (idx >= 0) {
          const cur = items2[idx];
          const curTotal = getTotalQty(cur);
          if (name) cur.name = name;
          cur.notes = notes;
          if (chosen >= curTotal) {
            cur.loc = 'frigo';
            cur.expiry = exp;
          } else {
            cur.qty = String(curTotal - chosen);
            items2.push({
              id: uid(),
              name: cur.name,
              loc: 'frigo',
              cat: cur.cat,
              qty: String(chosen),
              expiry: exp,
              notes,
              added: Date.now(),
            });
          }
          persistItems(items2);
        }
        closeAllSheets();
        render();
      },
    });
    return;
  }
  const idx = items.findIndex(x => x.id === state.moveItemId);
  if (idx >= 0) {
    items[idx].loc = 'frigo';
    items[idx].expiry = exp;
    if (name) items[idx].name = name;
    items[idx].notes = notes;
    persistItems(items);
  }
  closeAllSheets();
  render();
}
function deleteFromMove() {
  const items = loadItems();
  const it = items.find(x => x.id === state.moveItemId);
  if (!it) {
    closeAllSheets();
    render();
    return;
  }
  const total = getTotalQty(it);
  if (total > 1) {
    openQtySheet({
      total,
      title: 'Quanti pezzi rimuovere?',
      desc: `"${it.name}" ha ${total} pezzi. Indica quanti rimuoverne: gli altri resteranno in elenco.`,
      onConfirm: (chosen) => {
        const items2 = loadItems();
        const idx = items2.findIndex(x => x.id === it.id);
        if (idx >= 0) {
          const cur = items2[idx];
          const curTotal = getTotalQty(cur);
          if (chosen >= curTotal) {
            items2.splice(idx, 1);
          } else {
            cur.qty = String(curTotal - chosen);
          }
          persistItems(items2);
        }
        closeAllSheets();
        render();
      },
    });
    return;
  }
  const items2 = items.filter(x => x.id !== state.moveItemId);
  persistItems(items2);
  closeAllSheets();
  render();
}

// ---------- Sheet: quanti pezzi? (usata da rimozione, spostamento e cambio scadenza) ----------
// config: { total, title, desc, onConfirm(chosenQty) }
function openQtySheet(config) {
  state.pendingSplit = config;
  document.getElementById('qty-title').textContent = config.title;
  document.getElementById('qty-desc').textContent = config.desc;
  // Riparte sempre dai pulsanti rapidi: il campo "Altro" e il tasto Conferma
  // restano nascosti finché non si tocca "Altro".
  document.getElementById('qty-custom-field').style.display = 'none';
  document.getElementById('btn-qty-confirm').style.display = 'none';
  const input = document.getElementById('qty-input');
  input.min = '1';
  input.max = String(config.total);
  input.value = '1';
  // Nasconde le altre sheet aperte così quella dei pezzi risulta in primo piano.
  ['sheet-add', 'sheet-frigo', 'sheet-move'].forEach(id => {
    document.getElementById(id).classList.remove('show');
  });
  showSheet('sheet-qty');
}
// Applica subito l'azione con un numero di pezzi predefinito (pulsanti 1 / 2 / Tutti).
function applyQtyChoice(chosen) {
  const config = state.pendingSplit;
  if (!config) return;
  if (chosen > config.total) chosen = config.total;
  if (chosen < 1) chosen = 1;
  config.onConfirm(chosen);
}
function selectQtyAll() {
  applyQtyChoice(state.pendingSplit ? state.pendingSplit.total : 1);
}
// "Altro": mostra il campo numerico e il tasto Conferma per una quantità a scelta.
function showQtyCustomField() {
  document.getElementById('qty-custom-field').style.display = 'block';
  document.getElementById('btn-qty-confirm').style.display = 'block';
  document.getElementById('qty-input').focus();
}
function cancelQtySheet() {
  closeAllSheets();
  render();
}
function confirmQtySheet() {
  const config = state.pendingSplit;
  if (!config) {
    closeAllSheets();
    return;
  }
  let chosen = parseInt(document.getElementById('qty-input').value, 10);
  if (!Number.isFinite(chosen) || chosen < 1) chosen = 1;
  if (chosen > config.total) chosen = config.total;
  config.onConfirm(chosen);
}

// ---------- Gestione sheet condivisa ----------
function showSheet(id) {
  document.getElementById('backdrop').classList.add('show');
  document.getElementById(id).classList.add('show');
}
function closeAllSheets() {
  document.getElementById('backdrop').classList.remove('show');
  ['sheet-add', 'sheet-frigo', 'sheet-move', 'sheet-qty', 'sheet-sync'].forEach(id => {
    document.getElementById(id).classList.remove('show');
  });
  state.frigoItemId = null;
  state.moveItemId = null;
  state.pendingSplit = null;
}

// ---------- Sincronizzazione con GitHub Gist (per lo Shortcut delle 10) ----------
const SYNC_TOKEN_KEY = 'dispensa.sync.token';
const SYNC_GIST_KEY = 'dispensa.sync.gistId';
const SYNC_OWNER_KEY = 'dispensa.sync.owner';
const SYNC_URL_KEY = 'dispensa.sync.rawUrl';
const SYNC_RENAMED_KEY = 'dispensa.sync.filenameMigratedToCredenzapp';
const GIST_FILENAME_OLD = 'dispensa.json';
const GIST_FILENAME = 'credenzapp.json';

function getSyncToken() { return localStorage.getItem(SYNC_TOKEN_KEY) || ''; }

async function syncToGist(items) {
  const token = getSyncToken();
  if (!token) return; // sincronizzazione non configurata, nessuna azione
  const content = JSON.stringify(items, null, 2);
  const headers = {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
  try {
    let gistId = localStorage.getItem(SYNC_GIST_KEY);
    let res, data;
    if (!gistId) {
      // Nessun Gist ancora: lo creiamo già con il nome file nuovo.
      res = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          description: 'CredenzApp - dati alimenti (generato automaticamente, non modificare a mano)',
          public: false,
          files: { [GIST_FILENAME]: { content } },
        }),
      });
      if (!res.ok) throw new Error('creazione gist fallita: ' + res.status);
      data = await res.json();
      localStorage.setItem(SYNC_GIST_KEY, data.id);
      localStorage.setItem(SYNC_OWNER_KEY, data.owner.login);
      localStorage.setItem(SYNC_RENAMED_KEY, '1'); // gist nuovo, nessuna migrazione necessaria
    } else if (!localStorage.getItem(SYNC_RENAMED_KEY)) {
      // Migrazione una tantum per i Gist creati prima del rebrand: rinomina il file
      // "dispensa.json" già esistente in "credenzapp.json" nello stesso Gist (non ne
      // crea uno nuovo abbandonando il vecchio), aggiornando anche il contenuto.
      res = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          files: { [GIST_FILENAME_OLD]: { filename: GIST_FILENAME, content } },
        }),
      });
      if (!res.ok) throw new Error('migrazione nome file fallita: ' + res.status);
      data = await res.json();
      localStorage.setItem(SYNC_RENAMED_KEY, '1');
    } else {
      res = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } }),
      });
      if (!res.ok) throw new Error('aggiornamento gist fallito: ' + res.status);
      data = await res.json();
    }
    const owner = localStorage.getItem(SYNC_OWNER_KEY) || data.owner.login;
    // URL "stabile" (senza hash di revisione) che serve sempre l'ultima versione salvata
    const stableUrl = `https://gist.githubusercontent.com/${owner}/${data.id}/raw/${GIST_FILENAME}`;
    localStorage.setItem(SYNC_URL_KEY, stableUrl);
    renderSyncStatus('ok');
  } catch (e) {
    console.error('Errore sincronizzazione', e);
    renderSyncStatus('error');
  }
}

function renderSyncStatus(status) {
  const el = document.getElementById('sync-status');
  const box = document.getElementById('sync-url-box');
  if (!el) return;
  const url = localStorage.getItem(SYNC_URL_KEY);
  if (status === 'ok') {
    el.textContent = '✅ Sincronizzato.';
    if (url) {
      document.getElementById('sync-url').value = url;
      box.style.display = 'block';
    }
  } else if (status === 'error') {
    el.textContent = '⚠️ Sincronizzazione non riuscita. Controlla il token e riprova.';
  } else if (status === 'off') {
    el.textContent = 'Sincronizzazione non attiva: incolla un token per iniziare.';
    box.style.display = 'none';
  }
}
function openSyncSheet() {
  document.getElementById('sync-token').value = getSyncToken();
  const url = localStorage.getItem(SYNC_URL_KEY);
  if (getSyncToken()) {
    renderSyncStatus(url ? 'ok' : 'off');
  } else {
    renderSyncStatus('off');
  }
  showSheet('sheet-sync');
}
function saveSyncToken() {
  const token = document.getElementById('sync-token').value.trim();
  if (!token) {
    showToast('Inserisci un token');
    return;
  }
  localStorage.setItem(SYNC_TOKEN_KEY, token);
  showToast('Sincronizzazione in corso...');
  syncToGist(loadItems());
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

// ---------- Export / Import ----------
document.getElementById('btn-export').addEventListener('click', () => {
  const data = JSON.stringify(loadItems(), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `credenzapp-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
        persistItems(parsed);
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
  // Senza indicare l'aspect ratio del contenitore, la libreria a volte richiede
  // alla fotocamera uno stream con proporzioni diverse dallo schermo del telefono:
  // il video viene "letterboxato" (bande nere sopra/sotto) invece di riempire tutto.
  // Indicando l'aspect ratio reale dell'area di scansione (verticale, tutto schermo)
  // il video richiesto combacia con il contenitore e lo riempie interamente.
  const reader = document.getElementById('reader');
  const aspectRatio = reader.clientHeight / reader.clientWidth;
  html5QrCode
    .start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 150 }, aspectRatio },
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
// Open Food Facts restituisce spesso i nomi tutti minuscoli (es. "piadelle"):
// mettiamo in maiuscolo solo la prima lettera, lasciando il resto invariato
// (così eventuali marchi con maiuscole particolari non vengono alterati).
function capitalizeFirst(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
async function onScanSuccess(decodedText) {
  closeScanner();
  showToast('Codice letto, ricerca prodotto...');
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${decodedText}.json`);
    const json = await res.json();
    if (json.status === 1 && json.product) {
      const p = json.product;
      document.getElementById('f-name').value = capitalizeFirst(p.product_name || p.generic_name || decodedText);
      const n = p.nutriments || {};
      const prot = parseFloat(n['proteins_100g']) || 0;
      const carb = parseFloat(n['carbohydrates_100g']) || 0;
      const fat = parseFloat(n['fat_100g']) || 0;
      let guess = 'Altro';
      if (prot >= carb && prot >= fat && prot > 0) guess = 'Proteine';
      else if (carb >= prot && carb >= fat && carb > 0) guess = 'Carboidrati';
      else if (fat > 0) guess = 'Grassi';
      document.getElementById('f-cat').value = guess;
      showToast('Prodotto trovato: ' + capitalizeFirst(p.product_name || 'senza nome'));
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
document.getElementById('f-loc').addEventListener('change', e => toggleFieldsByLoc(e.target.value));

document.getElementById('btn-add').addEventListener('click', openAddSheet);
document.getElementById('btn-add-cancel').addEventListener('click', closeAllSheets);
document.getElementById('btn-add-save').addEventListener('click', saveAdd);

document.getElementById('btn-frigo-cancel').addEventListener('click', closeAllSheets);
document.getElementById('btn-frigo-save').addEventListener('click', saveFrigo);
document.getElementById('btn-frigo-delete').addEventListener('click', deleteFrigo);

document.getElementById('btn-move-frigo').addEventListener('click', showMoveToFrigoStep);
document.getElementById('btn-move-other').addEventListener('click', moveToOtherPantry);
document.getElementById('btn-move-save').addEventListener('click', saveMoveName);
document.getElementById('btn-move-delete').addEventListener('click', deleteFromMove);
document.getElementById('btn-move-cancel').addEventListener('click', closeAllSheets);
document.getElementById('btn-move-frigo-back').addEventListener('click', backFromMoveToFrigo);
document.getElementById('btn-move-frigo-confirm').addEventListener('click', confirmMoveToFrigo);

document.getElementById('qty-btn-1').addEventListener('click', () => applyQtyChoice(1));
document.getElementById('qty-btn-2').addEventListener('click', () => applyQtyChoice(2));
document.getElementById('qty-btn-all').addEventListener('click', selectQtyAll);
document.getElementById('qty-btn-custom').addEventListener('click', showQtyCustomField);
document.getElementById('btn-qty-cancel').addEventListener('click', cancelQtySheet);
document.getElementById('btn-qty-confirm').addEventListener('click', confirmQtySheet);

// Toccando il campo quantità mentre mostra ancora il valore predefinito "1",
// lo svuota subito: così si digita direttamente il numero voluto senza dover
// prima cancellare a mano. Se si salva senza aver digitato nulla, torna a 1.
function clearQtyDefaultOnFocus(e) {
  if (e.target.value === '1') e.target.value = '';
}
document.getElementById('f-qty').addEventListener('focus', clearQtyDefaultOnFocus);
document.getElementById('qty-input').addEventListener('focus', clearQtyDefaultOnFocus);

document.getElementById('backdrop').addEventListener('click', closeAllSheets);
document.getElementById('btn-scan').addEventListener('click', openScanner);
document.getElementById('btn-close-scan').addEventListener('click', closeScanner);

document.getElementById('btn-sync').addEventListener('click', openSyncSheet);
document.getElementById('btn-sync-close').addEventListener('click', closeAllSheets);
document.getElementById('btn-sync-save').addEventListener('click', saveSyncToken);
document.getElementById('btn-sync-copy').addEventListener('click', () => {
  const url = document.getElementById('sync-url').value;
  if (!url) return;
  navigator.clipboard.writeText(url).then(
    () => showToast('Indirizzo copiato'),
    () => showToast('Copia non riuscita, selezionalo manualmente')
  );
});

// ---------- Menu "⋯" (Esporta / Importa / Sync) ----------
// Azioni usate raramente: stanno in un piccolo menu a tendina in alto a destra
// invece di occupare sempre spazio visibile nella schermata principale.
document.getElementById('btn-menu').addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('menu-dropdown').classList.toggle('show');
});
document.getElementById('menu-dropdown').addEventListener('click', e => {
  if (e.target.tagName === 'BUTTON') {
    document.getElementById('menu-dropdown').classList.remove('show');
  }
});
document.addEventListener('click', () => {
  document.getElementById('menu-dropdown').classList.remove('show');
});

// ---------- PWA / Service worker ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ---------- Init ----------
render();

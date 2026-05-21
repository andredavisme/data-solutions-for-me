import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL      = 'https://hhyhulqngdkwsxhymmcd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_haKvwV0M7KMj4Qz69M6WGg_KmIfU-aI';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

document.getElementById('auth-gate').hidden = true;
document.getElementById('app').hidden = false;

const state = {
  projects: [],
  activeProjectId: null,
  allEvents: [],
  visibleEvents: [],
  selectedIndex: null,
  realtimeChannel: null,
  editingEventId: null,
  pendingDeleteId: null,
  filters: { kinds: new Set(['milestone','update','decision','launch','blocker']) },
};

const $ = id => document.getElementById(id);
const projectSelect    = $('project-select');
const projectTitle     = $('project-title');
const projectStatus    = $('project-status');
const timelineTrack    = $('timeline-track');
const timelineAxis     = $('timeline-axis');
const timelineEmpty    = $('timeline-empty');
const realtimeBadge    = $('realtime-badge');
const detailEmpty      = $('detail-empty');
const detailCard       = $('detail-card');
const navPrev          = $('nav-prev');
const navNext          = $('nav-next');
const eventNavSelect   = $('event-nav-select');
const cardKind         = $('card-kind');
const cardTime         = $('card-time');
const cardSummary      = $('card-summary');
const cardMeta         = $('card-meta');
const cardBody         = $('card-body');
const cardActions      = $('card-actions');
const editDrawer       = $('edit-drawer');
const editKind         = $('edit-kind');
const editSummary      = $('edit-summary');
const editNarrative    = $('edit-narrative');
const editSubmit       = $('edit-submit');
const editCancel       = $('edit-cancel');
const editDelete       = $('edit-delete');
const editStatus       = $('edit-status');
const deleteDialog     = $('delete-dialog');
const deleteDialogDesc = $('delete-dialog-desc');
const deleteCancel     = $('delete-cancel');
const deleteConfirm    = $('delete-confirm');
const deleteStatus     = $('delete-status');
const TIMELINE_PADDING = 40;

setupFilters();
setupNavListeners();
setupEditDrawer();
setupDeleteDialog();
loadProjects();

/* ── Data loading ─────────────────────────────────────────── */
async function loadProjects() {
  projectTitle.textContent = 'Loading…';
  const { data, error } = await supabase
    .from('hub_projects')
    .select('id, title, status')
    .eq('status', 'active')
    .order('sort_order', { ascending: true });
  if (error) { projectTitle.textContent = `Error: ${error.message}`; return; }
  state.projects = data ?? [];
  projectSelect.innerHTML = '';
  state.projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.title;
    projectSelect.appendChild(opt);
  });
  if (state.projects.length > 0) {
    state.activeProjectId = state.projects[0].id;
    projectSelect.value   = state.activeProjectId;
    await loadEvents();
  } else {
    projectTitle.textContent = 'No active projects found';
  }
}

projectSelect.addEventListener('change', async () => {
  state.activeProjectId = projectSelect.value;
  state.selectedIndex   = null;
  closeEditDrawer();
  unsubscribeRealtime();
  await loadEvents();
});

async function loadEvents() {
  const project = state.projects.find(p => p.id === state.activeProjectId);
  if (project) { projectTitle.textContent = project.title; projectStatus.textContent = project.status ?? ''; }
  clearTimeline(); timelineEmpty.hidden = true;
  const { data, error } = await supabase
    .from('hub_project_events').select('*')
    .eq('project_id', state.activeProjectId)
    .order('event_date', { ascending: true });
  if (error) {
    timelineEmpty.hidden = false;
    timelineEmpty.querySelector('p').textContent = `Failed to load events: ${error.message}`;
    return;
  }
  state.allEvents = data ?? [];
  state.selectedIndex = null;
  applyFiltersAndRender();
  if (state.visibleEvents.length > 0) selectEvent(0);
  subscribeRealtime();
}

/* ── Realtime ─────────────────────────────────────────────── */
function subscribeRealtime() {
  if (state.realtimeChannel) unsubscribeRealtime();
  setRealtimeBadge('connecting');
  state.realtimeChannel = supabase
    .channel(`hub-project-events:${state.activeProjectId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'hub_project_events',
      filter: `project_id=eq.${state.activeProjectId}` }, payload => handleRealtimeEvent(payload))
    .subscribe(status => {
      if (status === 'SUBSCRIBED') setRealtimeBadge('live');
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRealtimeBadge('error');
      if (status === 'CLOSED') setRealtimeBadge('off');
    });
}

function unsubscribeRealtime() {
  if (state.realtimeChannel) { supabase.removeChannel(state.realtimeChannel); state.realtimeChannel = null; }
  setRealtimeBadge('off');
}

function handleRealtimeEvent({ eventType, new: newRow, old: oldRow }) {
  if (eventType === 'INSERT') {
    const at = state.allEvents.findIndex(e => e.event_date > newRow.event_date);
    if (at === -1) state.allEvents.push(newRow); else state.allEvents.splice(at, 0, newRow);
  }
  if (eventType === 'UPDATE') {
    const idx = state.allEvents.findIndex(e => e.id === newRow.id);
    if (idx !== -1) state.allEvents[idx] = newRow;
  }
  if (eventType === 'DELETE') {
    const wasSelected = state.visibleEvents[state.selectedIndex]?.id === oldRow.id;
    const idx = state.allEvents.findIndex(e => e.id === oldRow.id);
    if (idx !== -1) state.allEvents.splice(idx, 1);
    if (wasSelected) { state.selectedIndex = null; closeEditDrawer(); }
  }
  applyFiltersAndRender();
  if (state.selectedIndex !== null) renderDetailCard(); else showDetailEmpty();
}

function setRealtimeBadge(status) {
  const labels = { connecting: '● Connecting', live: '● Live', error: '● Error', off: '○ Off' };
  realtimeBadge.textContent = labels[status] ?? '';
  realtimeBadge.dataset.status = status;
}

/* ── Filters ──────────────────────────────────────────────── */
function setupFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.filterKind;
      if (!kind) return;
      if (state.filters.kinds.has(kind)) state.filters.kinds.delete(kind);
      else state.filters.kinds.add(kind);
      btn.classList.toggle('active', state.filters.kinds.has(kind));
      btn.setAttribute('aria-pressed', String(state.filters.kinds.has(kind)));
      applyFiltersAndRender();
    });
  });
}

function applyFiltersAndRender() {
  state.visibleEvents = state.allEvents.filter(ev => state.filters.kinds.has(ev.event_type));
  if (state.selectedIndex !== null && state.selectedIndex >= state.visibleEvents.length)
    state.selectedIndex = state.visibleEvents.length ? state.visibleEvents.length - 1 : null;
  renderTimeline();
  renderDetailNav();
}

/* ── Timeline ─────────────────────────────────────────────── */
function clearTimeline() { timelineTrack.innerHTML = ''; timelineAxis.innerHTML = ''; }

function renderTimeline() {
  clearTimeline();
  const events = state.visibleEvents;
  if (!events.length) { timelineEmpty.hidden = false; return; }
  timelineEmpty.hidden = true;
  const wrapW = $('timeline-wrapper').clientWidth - TIMELINE_PADDING * 2;
  const times = events.map(e => parseDateLocal(e.event_date));
  const tMin  = Math.min(...times);
  const tMax  = Math.max(...times);
  const tRange = tMax - tMin || 1;
  const single = tMax === tMin;
  buildAxisTicks(tMin, tMax, wrapW, single);
  events.forEach((ev, i) => {
    const t      = parseDateLocal(ev.event_date);
    const leftPx = single ? TIMELINE_PADDING + wrapW / 2 : TIMELINE_PADDING + ((t - tMin) / tRange) * wrapW;
    const node = document.createElement('div');
    node.className = `timeline-event timeline-event--${ev.event_type}`;
    node.style.left = `${leftPx}px`;
    node.dataset.index = i; node.tabIndex = 0;
    const connector = document.createElement('div');
    connector.className = 'timeline-event__connector';
    const dot = document.createElement('div');
    dot.className = `timeline-event__dot timeline-event__dot--${ev.event_type}`;
    node.appendChild(connector); node.appendChild(dot);
    if (i === state.selectedIndex) node.classList.add('selected');
    node.addEventListener('click', () => selectEvent(i));
    node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') selectEvent(i); });
    timelineTrack.appendChild(node);
  });
  timelineTrack.style.width = `${TIMELINE_PADDING * 2 + wrapW}px`;
}

function parseDateLocal(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

function buildAxisTicks(tMin, tMax, wrapW, single) {
  if (single) {
    const tick = document.createElement('div');
    tick.className = 'timeline-axis__tick';
    tick.style.left = `${TIMELINE_PADDING + wrapW / 2}px`;
    tick.textContent = new Date(tMin).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    timelineAxis.appendChild(tick);
    return;
  }
  const intervals = [86400e3, 7*86400e3, 30*86400e3, 90*86400e3, 365*86400e3];
  const range    = tMax - tMin;
  const interval = intervals.find(iv => Math.floor(range / iv) <= 8) ?? intervals.at(-1);
  for (let t = Math.ceil(tMin / interval) * interval; t <= tMax; t += interval) {
    const tick = document.createElement('div');
    tick.className = 'timeline-axis__tick';
    tick.style.left = `${TIMELINE_PADDING + ((t - tMin) / range) * wrapW}px`;
    tick.textContent = new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
    timelineAxis.appendChild(tick);
  }
}

/* ── Detail card ──────────────────────────────────────────── */
function selectEvent(index) {
  state.selectedIndex = index;
  document.querySelectorAll('.timeline-event').forEach((el, i) => el.classList.toggle('selected', i === index));
  closeEditDrawer();
  renderDetailNav();
  renderDetailCard();
}

function showDetailEmpty() { detailEmpty.hidden = false; detailCard.hidden = true; }

function renderDetailNav() {
  eventNavSelect.innerHTML = '';
  state.visibleEvents.forEach((ev, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = [formatDate(ev.event_date), '•', capitalise(ev.event_type), ev.title ? '— ' + ev.title.slice(0, 55) : ''].filter(Boolean).join('  ');
    opt.selected = i === state.selectedIndex;
    eventNavSelect.appendChild(opt);
  });
  navPrev.disabled = state.selectedIndex === null || state.selectedIndex === 0;
  navNext.disabled = state.selectedIndex === null || state.selectedIndex === state.visibleEvents.length - 1;
}

function renderDetailCard() {
  const ev = state.visibleEvents[state.selectedIndex];
  if (!ev) return showDetailEmpty();
  detailEmpty.hidden = true; detailCard.hidden = false;
  cardKind.textContent = capitalise(ev.event_type);
  cardKind.className   = `detail-card__kind detail-card__kind--${ev.event_type}`;
  cardTime.textContent = formatDate(ev.event_date);
  cardSummary.textContent = ev.title || capitalise(ev.event_type);
  cardMeta.innerHTML = '';
  cardBody.textContent = ev.body || '';
  cardActions.innerHTML = '';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'nav-btn nav-btn--primary'; btn.textContent = '✏ Edit event';
  btn.addEventListener('click', () => openEditDrawer(ev));
  cardActions.appendChild(btn);
  ['card-payload-wrapper','linked-annotations','card-source-badge','card-context-badge'].forEach(id => {
    const el = $(id); if (el) el.hidden = true;
  });
}

/* ── Edit drawer ──────────────────────────────────────────── */
function openEditDrawer(ev) {
  state.editingEventId = ev.id;
  editDrawer.hidden    = false;
  editKind.value       = ev.event_type ?? 'update';
  editSummary.value    = ev.title ?? '';
  editNarrative.value  = ev.body  ?? '';
  editStatus.hidden    = true; editStatus.textContent = '';
  editSummary.focus();
}

function closeEditDrawer() {
  state.editingEventId = null;
  editDrawer.hidden    = true;
  editStatus.hidden    = true;
}

function setupEditDrawer() {
  editCancel.addEventListener('click', closeEditDrawer);

  editDelete.addEventListener('click', () => {
    const ev = state.allEvents.find(e => e.id === state.editingEventId);
    if (ev) openDeleteDialog(ev);
  });

  // Use click on the button directly — avoids form submit quirks with hidden ancestors
  editSubmit.addEventListener('click', async () => {
    if (!state.editingEventId) return;
    const title = editSummary.value.trim();
    if (!title) { editSummary.focus(); return; }
    editSubmit.disabled  = true;
    editStatus.hidden    = false;
    editStatus.textContent = 'Saving…';
    editStatus.dataset.state = 'working';
    const patch = {
      event_type: editKind.value,
      title,
      body: editNarrative.value.trim() || null,
    };
    console.log('Saving patch', patch, 'for id', state.editingEventId);
    const { error } = await supabase.from('hub_project_events').update(patch).eq('id', state.editingEventId);
    editSubmit.disabled = false;
    if (error) {
      console.error('Save error', error);
      editStatus.textContent = error.message; editStatus.dataset.state = 'error';
      return;
    }
    editStatus.textContent = 'Saved ✓'; editStatus.dataset.state = 'ok';
    // Optimistically update local state
    const idx = state.allEvents.findIndex(e => e.id === state.editingEventId);
    if (idx !== -1) state.allEvents[idx] = { ...state.allEvents[idx], ...patch };
    applyFiltersAndRender();
    renderDetailCard();
    setTimeout(closeEditDrawer, 800);
  });
}

/* ── Delete dialog ────────────────────────────────────────── */
function openDeleteDialog(ev) {
  state.pendingDeleteId = ev.id;
  deleteDialogDesc.textContent = `Delete "${ev.title || ev.event_type}"? This cannot be undone.`;
  deleteStatus.hidden = true; deleteStatus.textContent = '';
  deleteDialog.showModal();
}

function setupDeleteDialog() {
  deleteCancel.addEventListener('click', () => { state.pendingDeleteId = null; deleteDialog.close(); });
  deleteConfirm.addEventListener('click', async () => {
    if (!state.pendingDeleteId) return;
    deleteConfirm.disabled = true;
    deleteStatus.hidden = false; deleteStatus.textContent = 'Deleting…'; deleteStatus.dataset.state = 'working';
    const { error } = await supabase.from('hub_project_events').delete().eq('id', state.pendingDeleteId);
    deleteConfirm.disabled = false;
    if (error) { deleteStatus.textContent = error.message; deleteStatus.dataset.state = 'error'; return; }
    state.pendingDeleteId = null;
    deleteDialog.close();
    closeEditDrawer();
  });
}

/* ── Nav ──────────────────────────────────────────────────── */
function setupNavListeners() {
  navPrev.addEventListener('click', () => { if (state.selectedIndex > 0) selectEvent(state.selectedIndex - 1); });
  navNext.addEventListener('click', () => { if (state.selectedIndex < state.visibleEvents.length - 1) selectEvent(state.selectedIndex + 1); });
  eventNavSelect.addEventListener('change', () => selectEvent(Number(eventNavSelect.value)));
}

/* ── Utils ────────────────────────────────────────────────── */
function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
function capitalise(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL      = 'https://hhyhulqngdkwsxhymmcd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_haKvwV0M7KMj4Qz69M6WGg_KmIfU-aI';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

/* ── Hide gate, show app immediately ────────────────────── */
document.getElementById('auth-gate').hidden = true;
document.getElementById('app').hidden = false;

/* ── App state ────────────────────────────────────────────── */
const state = {
  projects: [],
  activeProjectId: null,
  allEvents: [],
  visibleEvents: [],
  selectedIndex: null,
  realtimeChannel: null,
  editingEventId: null,
  pendingDeleteId: null,
  filters: {
    kinds: new Set(['milestone','update','decision','launch','blocker']),
  },
};

/* ── DOM refs ──────────────────────────────────────────────── */
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
const editForm         = $('edit-form');
const editKind         = $('edit-kind');
const editAuthor       = $('edit-author');
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

/* ── Boot ─────────────────────────────────────────────────── */
setupFilters();
setupNavListeners();
setupEditForm();
setupDeleteDialog();
loadProjects();

/* ── Data loading ───────────────────────────────────────────── */
async function loadProjects() {
  projectTitle.textContent = 'Loading…';
  const { data, error } = await supabase
    .from('hub_projects')
    .select('id, title, status, description, client, project_type, owner, start_date, target_date, tags')
    .eq('status', 'active')
    .order('sort_order', { ascending: true });
  if (error) {
    projectTitle.textContent = `Error: ${error.message}`;
    console.error('loadProjects error', error);
    return;
  }
  state.projects = data ?? [];
  populateProjectSelect();
  if (state.projects.length > 0) {
    state.activeProjectId = state.projects[0].id;
    projectSelect.value   = state.activeProjectId;
    await loadEvents();
  } else {
    projectTitle.textContent = 'No active projects found';
  }
}

function populateProjectSelect() {
  projectSelect.innerHTML = '';
  state.projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.title;
    projectSelect.appendChild(opt);
  });
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
  if (project) {
    projectTitle.textContent  = project.title;
    projectStatus.textContent = project.status ?? '';
  }
  renderTimelineSkeleton();
  const { data, error } = await supabase
    .from('hub_project_events')
    .select('*')
    .eq('project_id', state.activeProjectId)
    .order('event_date', { ascending: true });
  if (error) {
    timelineEmpty.hidden = false;
    timelineEmpty.querySelector('p').textContent = `Failed to load events: ${error.message}`;
    clearTimeline();
    return;
  }
  state.allEvents     = data ?? [];
  state.selectedIndex = null;
  applyFiltersAndRender();
  // Auto-select first event so detail card is immediately populated
  if (state.visibleEvents.length > 0) selectEvent(0);
  subscribeRealtime();
}

function subscribeRealtime() {
  if (state.realtimeChannel) unsubscribeRealtime();
  setRealtimeBadge('connecting');
  state.realtimeChannel = supabase
    .channel(`hub-project-events:${state.activeProjectId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'hub_project_events',
      filter: `project_id=eq.${state.activeProjectId}`
    }, payload => handleRealtimeEvent(payload))
    .subscribe(status => {
      if (status === 'SUBSCRIBED')                               setRealtimeBadge('live');
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRealtimeBadge('error');
      if (status === 'CLOSED')                                   setRealtimeBadge('off');
    });
}

function unsubscribeRealtime() {
  if (state.realtimeChannel) { supabase.removeChannel(state.realtimeChannel); state.realtimeChannel = null; }
  setRealtimeBadge('off');
}

function handleRealtimeEvent({ eventType, new: newRow, old: oldRow }) {
  if (eventType === 'INSERT') {
    const insertAt = state.allEvents.findIndex(e => e.event_date > newRow.event_date);
    if (insertAt === -1) state.allEvents.push(newRow);
    else state.allEvents.splice(insertAt, 0, newRow);
    flashTimelineIncoming();
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
  if (state.selectedIndex !== null) renderDetailCard();
  else showDetailEmpty();
}

function setRealtimeBadge(status) {
  const labels = { connecting: '● Connecting', live: '● Live', error: '● Error', off: '○ Off' };
  realtimeBadge.textContent = labels[status] ?? '';
  realtimeBadge.dataset.status = status;
}

function flashTimelineIncoming() {
  const wrapper = $('timeline-wrapper');
  wrapper.classList.add('timeline-wrapper--incoming');
  setTimeout(() => wrapper.classList.remove('timeline-wrapper--incoming'), 600);
}

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
  if (state.selectedIndex !== null && state.selectedIndex >= state.visibleEvents.length) {
    state.selectedIndex = state.visibleEvents.length ? state.visibleEvents.length - 1 : null;
  }
  renderTimeline();
  renderDetailNav();
}

function clearTimeline() { timelineTrack.innerHTML = ''; timelineAxis.innerHTML = ''; }

function renderTimelineSkeleton() {
  clearTimeline();
  timelineEmpty.hidden = true;
  timelineTrack.innerHTML = '<div class="skeleton" style="height:14px;width:200px;margin:20px auto"></div>';
}

function renderTimeline() {
  clearTimeline();
  const events = state.visibleEvents;
  if (!events.length) { timelineEmpty.hidden = false; return; }
  timelineEmpty.hidden = true;

  const wrapW = $('timeline-wrapper').clientWidth - TIMELINE_PADDING * 2;

  // Parse event_date strings as local dates (avoid UTC midnight offset)
  const times = events.map(e => parseDateLocal(e.event_date));
  const tMin  = Math.min(...times);
  const tMax  = Math.max(...times);
  // If only one event (or all same date), centre it in the track
  const tRange = tMax - tMin || 1;
  const singleEvent = tMax === tMin;

  buildAxisTicks(tMin, tMax, wrapW, singleEvent);

  events.forEach((ev, i) => {
    const t      = parseDateLocal(ev.event_date);
    const leftPx = singleEvent
      ? TIMELINE_PADDING + wrapW / 2   // centre single event
      : TIMELINE_PADDING + ((t - tMin) / tRange) * wrapW;

    const node = document.createElement('div');
    node.className = `timeline-event timeline-event--${ev.event_type}`;
    node.style.left = `${leftPx}px`;
    node.dataset.index = i;
    node.tabIndex = 0;

    const dot = document.createElement('div');
    dot.className = `timeline-event__dot timeline-event__dot--${ev.event_type}`;
    const connector = document.createElement('div');
    connector.className = 'timeline-event__connector';
    node.appendChild(connector);
    node.appendChild(dot);

    if (i === state.selectedIndex) node.classList.add('selected');
    node.addEventListener('click', () => selectEvent(i));
    node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') selectEvent(i); });
    timelineTrack.appendChild(node);
  });

  timelineTrack.style.width = `${TIMELINE_PADDING * 2 + wrapW}px`;
}

// Parse a YYYY-MM-DD string as local midnight (not UTC) to avoid timezone shift
function parseDateLocal(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

function buildAxisTicks(tMin, tMax, wrapW, singleEvent) {
  if (singleEvent) {
    // Just show the single date centred
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
  const firstTick = Math.ceil(tMin / interval) * interval;
  for (let t = firstTick; t <= tMax; t += interval) {
    const leftPx = TIMELINE_PADDING + ((t - tMin) / range) * wrapW;
    const tick = document.createElement('div');
    tick.className = 'timeline-axis__tick';
    tick.style.left = `${leftPx}px`;
    tick.textContent = new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
    timelineAxis.appendChild(tick);
  }
}

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
    opt.textContent = [
      formatDate(ev.event_date), '•',
      capitalise(ev.event_type),
      ev.title ? '— ' + ev.title.slice(0, 55) : ''
    ].filter(Boolean).join('  ');
    opt.selected = i === state.selectedIndex;
    eventNavSelect.appendChild(opt);
  });
  navPrev.disabled = state.selectedIndex === null || state.selectedIndex === 0;
  navNext.disabled = state.selectedIndex === null || state.selectedIndex === state.visibleEvents.length - 1;
}

function renderDetailCard() {
  const ev = state.visibleEvents[state.selectedIndex];
  if (!ev) return showDetailEmpty();
  detailEmpty.hidden = true;
  detailCard.hidden  = false;
  cardKind.textContent  = capitalise(ev.event_type);
  cardKind.className    = `detail-card__kind detail-card__kind--${ev.event_type}`;
  cardTime.textContent  = formatDate(ev.event_date);
  cardSummary.textContent = ev.title || capitalise(ev.event_type);
  cardMeta.innerHTML    = '';
  cardBody.textContent  = ev.body || '';
  renderCardActions(ev);
  const wrap = $('card-payload-wrapper');
  if (wrap) wrap.hidden = true;
  const lp = $('linked-annotations');
  if (lp) lp.hidden = true;
  const sb = $('card-source-badge');
  if (sb) sb.hidden = true;
  const cb = $('card-context-badge');
  if (cb) cb.hidden = true;
}

function renderCardActions(ev) {
  cardActions.innerHTML = '';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-btn nav-btn--primary';
  btn.textContent = '✏ Edit event';
  btn.addEventListener('click', () => openEditDrawer(ev));
  cardActions.appendChild(btn);
}

function openEditDrawer(ev) {
  state.editingEventId  = ev.id;
  editDrawer.hidden     = false;
  editKind.value        = ev.event_type ?? 'update';
  editAuthor.value      = '';
  editSummary.value     = ev.title ?? '';
  editNarrative.value   = ev.body  ?? '';
  editStatus.hidden     = true;
  editStatus.textContent = '';
  editSummary.focus();
}

function closeEditDrawer() {
  state.editingEventId = null;
  editDrawer.hidden    = true;
  editStatus.hidden    = true;
}

function setupEditForm() {
  editCancel.addEventListener('click', closeEditDrawer);
  editDelete.addEventListener('click', () => {
    const ev = state.allEvents.find(e => e.id === state.editingEventId);
    if (ev) openDeleteDialog(ev);
  });
  editForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!state.editingEventId) return;
    editSubmit.disabled = true;
    editStatus.hidden   = false;
    editStatus.textContent = 'Saving…';
    editStatus.dataset.state = 'working';
    const patch = {
      event_type: editKind.value,
      title:      editSummary.value.trim(),
      body:       editNarrative.value.trim() || null,
    };
    const { error } = await supabase.from('hub_project_events').update(patch).eq('id', state.editingEventId);
    editSubmit.disabled = false;
    if (error) { editStatus.textContent = error.message; editStatus.dataset.state = 'error'; return; }
    editStatus.textContent = 'Saved.'; editStatus.dataset.state = 'ok';
    setTimeout(closeEditDrawer, 800);
  });
}

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
    deleteStatus.hidden    = false;
    deleteStatus.textContent = 'Deleting…';
    deleteStatus.dataset.state = 'working';
    const { error } = await supabase.from('hub_project_events').delete().eq('id', state.pendingDeleteId);
    deleteConfirm.disabled = false;
    if (error) { deleteStatus.textContent = error.message; deleteStatus.dataset.state = 'error'; return; }
    state.pendingDeleteId = null;
    deleteDialog.close();
    closeEditDrawer();
  });
}

function setupNavListeners() {
  navPrev.addEventListener('click', () => {
    if (state.selectedIndex > 0) selectEvent(state.selectedIndex - 1);
  });
  navNext.addEventListener('click', () => {
    if (state.selectedIndex < state.visibleEvents.length - 1) selectEvent(state.selectedIndex + 1);
  });
  eventNavSelect.addEventListener('change', () => selectEvent(Number(eventNavSelect.value)));
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
function capitalise(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

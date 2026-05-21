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
  annotationSourceId: null,
  pendingInsertedAnnotationId: null,
  editingEventId: null,
  pendingDeleteId: null,
  filters: {
    kinds:    new Set(['milestone','update','decision','launch','blocker']),
    sources:  new Set(['automatic','manual']),
    contexts: new Set(['production','development','test']),
  },
};

/* ── DOM refs ──────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const projectSelect       = $('project-select');
const projectTitle        = $('project-title');
const projectStatus       = $('project-status');
const timelineTrack       = $('timeline-track');
const timelineAxis        = $('timeline-axis');
const timelineEmpty       = $('timeline-empty');
const realtimeBadge       = $('realtime-badge');
const detailEmpty         = $('detail-empty');
const detailCard          = $('detail-card');
const navPrev             = $('nav-prev');
const navNext             = $('nav-next');
const eventNavSelect      = $('event-nav-select');
const cardKind            = $('card-kind');
const cardSourceBadge     = $('card-source-badge');
const cardContextBadge    = $('card-context-badge');
const cardTime            = $('card-time');
const cardSummary         = $('card-summary');
const cardMeta            = $('card-meta');
const cardBody            = $('card-body');
const cardActions         = $('card-actions');
const annotationDrawer    = $('annotation-drawer');
const annotationLinked    = $('annotation-linked');
const annotationForm      = $('annotation-form');
const annotationKind      = $('annotation-kind');
const annotationContext   = $('annotation-context');
const annotationAuthor    = $('annotation-author');
const annotationSummary   = $('annotation-summary');
const annotationNarrative = $('annotation-narrative');
const annotationSubmit    = $('annotation-submit');
const annotationCancel    = $('annotation-cancel');
const annotationReset     = $('annotation-reset');
const annotationStatus    = $('annotation-status');
const linkedPanel         = $('linked-annotations');
const linkedList          = $('linked-annotations-list');
const linkedCount         = $('linked-annotations-count');
const editDrawer          = $('edit-drawer');
const editForm            = $('edit-form');
const editKind            = $('edit-kind');
const editContext         = $('edit-context');
const editAuthor          = $('edit-author');
const editSummary         = $('edit-summary');
const editNarrative       = $('edit-narrative');
const editSubmit          = $('edit-submit');
const editCancel          = $('edit-cancel');
const editDelete          = $('edit-delete');
const editStatus          = $('edit-status');
const deleteDialog        = $('delete-dialog');
const deleteDialogDesc    = $('delete-dialog-desc');
const deleteCancel        = $('delete-cancel');
const deleteConfirm       = $('delete-confirm');
const deleteStatus        = $('delete-status');
const cardPayloadWrap     = $('card-payload-wrapper');
const cardPayload         = $('card-payload');
const payloadToggle       = $('payload-toggle');
const TIMELINE_PADDING    = 40;

/* ── Boot ─────────────────────────────────────────────────── */
setupFilters();
setupNavListeners();
setupAnnotationForm();
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
  closeAllDrawers();
  unsubscribeRealtime();
  await loadEvents();
});

async function loadEvents() {
  const project = state.projects.find(p => p.id === state.activeProjectId);
  if (project) {
    projectTitle.textContent = project.title;
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
    const insertAt = state.allEvents.findIndex(e => new Date(e.event_date) > new Date(newRow.event_date));
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
    if (wasSelected) { state.selectedIndex = null; closeAllDrawers(); }
  }
  applyFiltersAndRender();
  if (state.pendingInsertedAnnotationId && newRow?.id === state.pendingInsertedAnnotationId) {
    const idx = state.visibleEvents.findIndex(e => e.id === newRow.id);
    if (idx !== -1) selectEvent(idx);
    state.pendingInsertedAnnotationId = null;
    closeAllDrawers();
  } else if (state.selectedIndex !== null) {
    renderDetailCard();
  } else {
    showDetailEmpty();
  }
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
      const kind    = btn.dataset.filterKind;
      const source  = btn.dataset.filterSource;
      const context = btn.dataset.filterContext;
      const toggle  = (set, key) => set.has(key) ? set.delete(key) : set.add(key);
      if (kind)    toggle(state.filters.kinds, kind);
      if (source)  toggle(state.filters.sources, source);
      if (context) toggle(state.filters.contexts, context);
      const isActive =
        (kind    && state.filters.kinds.has(kind)) ||
        (source  && state.filters.sources.has(source)) ||
        (context && state.filters.contexts.has(context));
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
      applyFiltersAndRender();
    });
  });
}

function applyFiltersAndRender() {
  state.visibleEvents = state.allEvents.filter(ev => {
    return state.filters.kinds.has(ev.event_type);
  });
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
  const times  = events.map(e => new Date(e.event_date).getTime());
  const tMin   = Math.min(...times);
  const tMax   = Math.max(...times);
  const tRange = tMax - tMin || 1;
  const wrapW  = $('timeline-wrapper').clientWidth - TIMELINE_PADDING * 2;
  buildAxisTicks(tMin, tMax, wrapW);
  events.forEach((ev, i) => {
    const leftPx = TIMELINE_PADDING + (((new Date(ev.event_date).getTime() - tMin) / tRange) * wrapW);
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

function buildAxisTicks(tMin, tMax, wrapW) {
  const intervals = [60e3, 5*60e3, 15*60e3, 60*60e3, 6*3600e3, 86400e3, 7*86400e3, 30*86400e3];
  const range = tMax - tMin;
  const interval = intervals.find(iv => Math.floor(range / iv) <= 8) ?? intervals.at(-1);
  const firstTick = Math.ceil(tMin / interval) * interval;
  for (let t = firstTick; t <= tMax; t += interval) {
    const leftPx = TIMELINE_PADDING + ((t - tMin) / (tMax - tMin || 1)) * wrapW;
    const tick = document.createElement('div');
    tick.className = 'timeline-axis__tick';
    tick.style.left = `${leftPx}px`;
    tick.textContent = formatAxisTick(t, range);
    timelineAxis.appendChild(tick);
  }
}

function formatAxisTick(ts, range) {
  const d = new Date(ts);
  if (range < 2 * 3600e3) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (range < 48 * 3600e3) return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
}

function selectEvent(index) {
  state.selectedIndex = index;
  document.querySelectorAll('.timeline-event').forEach((el, i) => el.classList.toggle('selected', i === index));
  closeAllDrawers();
  renderDetailNav();
  renderDetailCard();
}

function showDetailEmpty() { detailEmpty.hidden = false; detailCard.hidden = true; }

function renderDetailNav() {
  eventNavSelect.innerHTML = '';
  state.visibleEvents.forEach((ev, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = [formatDate(ev.event_date), '•', ev.event_type, ev.title ? '— ' + ev.title.slice(0, 55) : ''].filter(Boolean).join('  ');
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
  detailCard.hidden = false;
  cardKind.textContent = ev.event_type;
  cardKind.className = `detail-card__kind detail-card__kind--${ev.event_type}`;
  cardSourceBadge.textContent = '';
  cardSourceBadge.hidden = true;
  cardContextBadge.hidden = true;
  cardTime.textContent = formatDate(ev.event_date);
  cardSummary.textContent = ev.title || capitalise(ev.event_type);
  cardMeta.innerHTML = '';
  cardBody.textContent = ev.body || '';
  renderCardActions(ev);
  if (cardPayloadWrap) cardPayloadWrap.hidden = true;
  if (linkedPanel) linkedPanel.hidden = true;
}

function renderCardActions(ev) {
  cardActions.innerHTML = '';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'nav-btn nav-btn--primary'; btn.textContent = '✏ Edit event';
  btn.addEventListener('click', () => openEditDrawer(ev));
  cardActions.appendChild(btn);
}

function openAnnotationDrawer(ev) {
  closeAllDrawers();
  state.annotationSourceId = ev.id;
  annotationDrawer.hidden = false;
  annotationLinked.textContent = `${ev.event_type} • ${formatDate(ev.event_date)} • ${ev.title || 'event'}`;
  annotationKind.value = 'update';
  annotationContext.value = 'production';
  annotationSummary.value = '';
  annotationNarrative.value = '';
  annotationStatus.hidden = true;
  annotationStatus.textContent = '';
  annotationSummary.focus();
}

function closeAnnotationDrawer() {
  state.annotationSourceId = null;
  annotationDrawer.hidden = true;
  annotationStatus.hidden = true;
}

function setupAnnotationForm() {
  annotationCancel.addEventListener('click', closeAnnotationDrawer);
  annotationReset.addEventListener('click', () => {
    annotationKind.value = 'update'; annotationContext.value = 'production';
    annotationSummary.value = ''; annotationNarrative.value = ''; annotationStatus.hidden = true;
  });
  annotationForm.addEventListener('submit', async e => {
    e.preventDefault();
    const sourceEvent = state.allEvents.find(ev => ev.id === state.annotationSourceId);
    if (!sourceEvent) return;
    annotationSubmit.disabled = true;
    annotationStatus.hidden = false;
    annotationStatus.textContent = 'Saving…';
    annotationStatus.dataset.state = 'working';
    const row = {
      project_id:  sourceEvent.project_id,
      event_date:  new Date().toISOString().slice(0, 10),
      event_type:  annotationKind.value,
      title:       annotationSummary.value.trim(),
      body:        annotationNarrative.value.trim() || null,
    };
    const { data, error } = await supabase.from('hub_project_events').insert(row).select('*').single();
    annotationSubmit.disabled = false;
    if (error) { annotationStatus.textContent = error.message; annotationStatus.dataset.state = 'error'; return; }
    state.pendingInsertedAnnotationId = data.id;
    annotationStatus.textContent = 'Saved. Waiting for live event…';
    annotationStatus.dataset.state = 'ok';
  });
}

function openEditDrawer(ev) {
  closeAllDrawers();
  state.editingEventId = ev.id;
  editDrawer.hidden = false;
  editKind.value = ev.event_type ?? 'update';
  editContext.value = 'production';
  editAuthor.value = '';
  editSummary.value = ev.title ?? '';
  editNarrative.value = ev.body ?? '';
  editStatus.hidden = true; editStatus.textContent = '';
  editSummary.focus();
}

function closeEditDrawer() {
  state.editingEventId = null;
  editDrawer.hidden = true;
  editStatus.hidden = true;
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
    editStatus.hidden = false;
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
    deleteStatus.hidden = false;
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

function closeAllDrawers() { closeAnnotationDrawer(); closeEditDrawer(); }

function setupNavListeners() {
  navPrev.addEventListener('click', () => { if (state.selectedIndex > 0) selectEvent(state.selectedIndex - 1); });
  navNext.addEventListener('click', () => { if (state.selectedIndex < state.visibleEvents.length - 1) selectEvent(state.selectedIndex + 1); });
  eventNavSelect.addEventListener('change', () => selectEvent(Number(eventNavSelect.value)));
  if (payloadToggle) {
    payloadToggle.addEventListener('click', () => {
      const open = !cardPayload.hidden;
      cardPayload.hidden = open;
      payloadToggle.textContent = open ? 'Show raw payload ▾' : 'Hide raw payload ▴';
    });
  }
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
function capitalise(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

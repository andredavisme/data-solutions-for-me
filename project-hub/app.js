import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL      = 'https://hhyhulqngdkwsxhymmcd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_haKvwV0M7KMj4Qz69M6WGg_KmIfU-aI';
const VERIFY_URL        = `${SUPABASE_URL}/functions/v1/verify-passphrase`;
const TOKEN_KEY         = 'hub_auth_token';

/* ── Auth helpers ─────────────────────────────────────────── */
function getStoredToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const payload = JSON.parse(atob(raw.split('.')[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return raw;
  } catch { return null; }
}
function storeToken(token) { localStorage.setItem(TOKEN_KEY, token); }
function clearToken()      { localStorage.removeItem(TOKEN_KEY); }

// Each call gets its own unique storageKey so GoTrueClient never sees a duplicate
function buildSupabase(token) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `hub-${crypto.randomUUID()}`,
    },
    global: { headers: token ? { 'x-hub-token': token } : {} },
  });
}

let supabase = null;
let initialized = false;

/* ── Gate UI refs ─────────────────────────────────────────── */
const authGate      = document.getElementById('auth-gate');
const authGateForm  = document.getElementById('auth-gate-form');
const authGateInput = document.getElementById('auth-gate-input');
const authGateBtn   = document.getElementById('auth-gate-submit');
const authGateError = document.getElementById('auth-gate-error');
const appDiv        = document.getElementById('app');
const authSignout   = document.getElementById('auth-signout');

function showGate() {
  authGate.hidden = false;
  appDiv.hidden   = true;
  authGateInput.value  = '';
  authGateError.hidden = true;
  authGateInput.focus();
}
function showApp() {
  authGate.hidden = true;
  appDiv.hidden   = false;
}

async function attemptLogin(passphrase) {
  authGateBtn.disabled    = true;
  authGateBtn.textContent = 'Checking…';
  authGateError.hidden    = true;
  try {
    const res  = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    });
    const json = await res.json();
    if (!res.ok || !json.token) throw new Error(json.error || 'Incorrect passphrase');
    storeToken(json.token);
    supabase = buildSupabase(json.token);
    showApp();
    init();
  } catch (err) {
    authGateError.textContent = err.message;
    authGateError.hidden      = false;
    authGateInput.select();
  } finally {
    authGateBtn.disabled    = false;
    authGateBtn.textContent = 'Enter';
  }
}

authGateForm.addEventListener('submit', e => { e.preventDefault(); attemptLogin(authGateInput.value); });
authSignout.addEventListener('click', () => {
  clearToken();
  unsubscribeRealtime();
  initialized = false;
  supabase = null;
  showGate();
});

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
    kinds:    new Set(['insert','update','delete','expectation','deviation','adaptation']),
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

/* ── App functions ────────────────────────────────────────── */
function init() {
  if (initialized) return;
  initialized = true;
  setupFilters();
  setupNavListeners();
  setupAnnotationForm();
  setupEditForm();
  setupDeleteDialog();
  loadProjects();
}

async function loadProjects() {
  projectTitle.textContent = 'Loading…';
  const { data, error } = await supabase
    .from('skunkworks_projects')
    .select('id, title, status')
    .order('created_at', { ascending: false });
  if (error) { projectTitle.textContent = 'Error loading projects'; return; }
  state.projects = data ?? [];
  populateProjectSelect();
  if (state.projects.length > 0) {
    state.activeProjectId = state.projects[0].id;
    projectSelect.value   = state.activeProjectId;
    await loadEvents();
  } else {
    projectTitle.textContent = 'No projects found';
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
  if (project) { projectTitle.textContent = project.title; projectStatus.textContent = project.status ?? ''; }
  renderTimelineSkeleton();
  const { data, error } = await supabase
    .from('project_events')
    .select('*')
    .eq('project_id', state.activeProjectId)
    .order('created_at', { ascending: true });
  if (error) {
    timelineEmpty.hidden = false;
    timelineEmpty.querySelector('p').textContent = 'Failed to load events.';
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
    .channel(`project-events:${state.activeProjectId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'project_events',
      filter: `project_id=eq.${state.activeProjectId}`
    }, payload => handleRealtimeEvent(payload))
    .subscribe(status => {
      if (status === 'SUBSCRIBED')                               setRealtimeBadge('live');
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setRealtimeBadge('error');
      if (status === 'CLOSED')                                   setRealtimeBadge('off');
    });
}

function unsubscribeRealtime() {
  if (state.realtimeChannel && supabase) { supabase.removeChannel(state.realtimeChannel); state.realtimeChannel = null; }
  setRealtimeBadge('off');
}

function handleRealtimeEvent({ eventType, new: newRow, old: oldRow }) {
  if (eventType === 'INSERT') {
    const insertAt = state.allEvents.findIndex(e => new Date(e.created_at) > new Date(newRow.created_at));
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
    const kindOk   = state.filters.kinds.has(ev.event_kind);
    const isManual = ev.is_manual === true;
    const sourceOk = (isManual && state.filters.sources.has('manual')) || (!isManual && state.filters.sources.has('automatic'));
    const ctx = ev.context ?? 'production';
    return kindOk && sourceOk && state.filters.contexts.has(ctx);
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
  const times  = events.map(e => new Date(e.created_at).getTime());
  const tMin   = Math.min(...times);
  const tMax   = Math.max(...times);
  const tRange = tMax - tMin || 1;
  const wrapW  = $('timeline-wrapper').clientWidth - TIMELINE_PADDING * 2;
  buildAxisTicks(tMin, tMax, wrapW);
  events.forEach((ev, i) => {
    const leftPx   = TIMELINE_PADDING + (((new Date(ev.created_at).getTime() - tMin) / tRange) * wrapW);
    const isManual = ev.is_manual === true;
    const ctx      = ev.context ?? 'production';
    const isDev    = ctx === 'development' || ctx === 'test';
    const node = document.createElement('div');
    node.className = ['timeline-event', `timeline-event--${isManual ? 'manual' : 'auto'}`, isDev ? `timeline-event--${ctx}` : ''].filter(Boolean).join(' ');
    node.style.left = `${leftPx}px`;
    node.dataset.index = i;
    node.tabIndex = 0;
    const dot = document.createElement('div');
    dot.className = `timeline-event__dot timeline-event__dot--${ev.event_kind}`;
    if (isDev) {
      const label = document.createElement('span');
      label.className = `timeline-event__ctx-label timeline-event__ctx-label--${ctx}`;
      label.textContent = ctx === 'development' ? 'dev' : 'test';
      node.appendChild(label);
    }
    const connector = document.createElement('div');
    connector.className = 'timeline-event__connector';
    if (isManual) { node.appendChild(dot); node.appendChild(connector); }
    else { node.appendChild(connector); node.appendChild(dot); }
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
    const ctx = ev.context ?? 'production';
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = [formatTime(ev.created_at), '•', ev.event_kind, ctx !== 'production' ? `[${ctx}]` : '', ev.summary ? '— ' + ev.summary.slice(0, 55) : ''].filter(Boolean).join('  ');
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
  const isManual = ev.is_manual === true;
  const ctx = ev.context ?? 'production';
  cardKind.textContent = ev.event_kind;
  cardKind.className = `detail-card__kind detail-card__kind--${ev.event_kind}`;
  cardSourceBadge.textContent = isManual ? '✏ Manual' : '⚙ Automatic';
  cardSourceBadge.className = `detail-card__source-badge${isManual ? ' detail-card__source-badge--manual' : ''}`;
  if (ctx !== 'production') {
    cardContextBadge.textContent = ctx === 'development' ? '🛠 dev' : '🧪 test';
    cardContextBadge.className = `detail-card__context-badge detail-card__context-badge--${ctx}`;
    cardContextBadge.hidden = false;
  } else {
    cardContextBadge.hidden = true;
  }
  cardTime.textContent = formatTime(ev.created_at);
  cardSummary.textContent = ev.summary || `${capitalise(ev.event_kind)} on ${ev.source_type}`;
  cardMeta.innerHTML = [
    ev.author ? `<span>✏ <strong>${escHtml(ev.author)}</strong></span>` : '',
    ev.source_type ? `<span>Table: <strong>${escHtml(ev.source_type)}</strong></span>` : '',
    ev.status ? `<span>Status: <strong>${escHtml(ev.status)}</strong></span>` : '',
  ].filter(Boolean).join('');
  cardBody.textContent = ev.narrative || ev.notes || '';
  renderCardActions(ev);
  renderLinkedAnnotations(ev);
  if (ev.payload) {
    cardPayloadWrap.hidden = false;
    cardPayload.textContent = JSON.stringify(ev.payload, null, 2);
  } else {
    cardPayloadWrap.hidden = true;
    cardPayload.hidden = true;
  }
}

function renderCardActions(ev) {
  cardActions.innerHTML = '';
  if (ev.is_manual === true) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'nav-btn'; btn.textContent = '✏ Edit annotation';
    btn.addEventListener('click', () => openEditDrawer(ev));
    cardActions.appendChild(btn);
  } else {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'nav-btn nav-btn--primary'; btn.textContent = 'Annotate this event';
    btn.addEventListener('click', () => openAnnotationDrawer(ev));
    cardActions.appendChild(btn);
  }
}

function renderLinkedAnnotations(ev) {
  linkedList.innerHTML = '';
  if (ev.is_manual === true) { linkedPanel.hidden = true; return; }
  const linked = state.allEvents.filter(e => e.is_manual === true && Array.isArray(e.related_event_ids) && e.related_event_ids.includes(ev.id));
  if (!linked.length) { linkedPanel.hidden = true; return; }
  linkedPanel.hidden = false;
  linkedCount.textContent = `${linked.length}`;
  linked.forEach(ann => {
    const li = document.createElement('li');
    li.className = 'linked-annotations__item';
    li.innerHTML = `
      <span class="detail-card__kind detail-card__kind--${ann.event_kind}">${escHtml(ann.event_kind)}</span>
      <span class="linked-annotations__item-summary">${escHtml(ann.summary || '—')}</span>
      <time class="linked-annotations__item-time">${formatTime(ann.created_at)}</time>
      ${ann.author ? `<span class="linked-annotations__item-author">${escHtml(ann.author)}</span>` : ''}
    `;
    li.addEventListener('click', () => { const idx = state.visibleEvents.findIndex(e => e.id === ann.id); if (idx !== -1) selectEvent(idx); });
    linkedList.appendChild(li);
  });
}

function openAnnotationDrawer(ev) {
  closeAllDrawers();
  state.annotationSourceId = ev.id;
  annotationDrawer.hidden = false;
  annotationLinked.textContent = `${ev.event_kind} • ${formatTime(ev.created_at)} • ${ev.summary || ev.source_type || 'automatic event'}`;
  annotationKind.value = 'adaptation';
  annotationContext.value = ev.context ?? 'production';
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
    annotationKind.value = 'adaptation'; annotationContext.value = 'production';
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
      project_id: sourceEvent.project_id, event_kind: annotationKind.value,
      source_type: sourceEvent.source_type || 'other', source_record_id: sourceEvent.source_record_id || null,
      monitor_event_id: sourceEvent.monitor_event_id || null, status: 'pending', is_manual: true,
      author: annotationAuthor.value.trim() || null, summary: annotationSummary.value.trim(),
      narrative: annotationNarrative.value.trim(), notes: `Manual annotation linked to ${sourceEvent.id}`,
      related_event_ids: [sourceEvent.id], context: annotationContext.value,
    };
    const { data, error } = await supabase.from('project_events').insert(row).select('*').single();
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
  editKind.value = ev.event_kind ?? 'adaptation';
  editContext.value = ev.context ?? 'production';
  editAuthor.value = ev.author ?? '';
  editSummary.value = ev.summary ?? '';
  editNarrative.value = ev.narrative ?? ev.notes ?? '';
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
      event_kind: editKind.value, context: editContext.value,
      author: editAuthor.value.trim() || null, summary: editSummary.value.trim(),
      narrative: editNarrative.value.trim() || null,
    };
    const { error } = await supabase.from('project_events').update(patch).eq('id', state.editingEventId);
    editSubmit.disabled = false;
    if (error) { editStatus.textContent = error.message; editStatus.dataset.state = 'error'; return; }
    editStatus.textContent = 'Saved.'; editStatus.dataset.state = 'ok';
    setTimeout(closeEditDrawer, 800);
  });
}

function openDeleteDialog(ev) {
  state.pendingDeleteId = ev.id;
  deleteDialogDesc.textContent = `Delete "${ev.summary || ev.event_kind}"? This cannot be undone.`;
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
    const { error } = await supabase.from('project_events').delete().eq('id', state.pendingDeleteId);
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
  payloadToggle.addEventListener('click', () => {
    const open = !cardPayload.hidden;
    cardPayload.hidden = open;
    payloadToggle.textContent = open ? 'Show raw payload ▾' : 'Hide raw payload ▴';
  });
}

function formatTime(iso) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function capitalise(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* ── Boot (must be last — after all const declarations) ───── */
const _bootToken = getStoredToken();
if (_bootToken) {
  supabase = buildSupabase(_bootToken);
  showApp();
  init();
} else {
  showGate();
}

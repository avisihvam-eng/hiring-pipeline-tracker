/* =========================================
   Hiring Pipeline Tracker — Application Logic
   ========================================= */

// --- Constants ---
const STAGES = ['Internal Screen', 'Round 1', 'Round 2', 'Round 3', 'Offer', 'Joined'];
const STATUSES = ['Pending', 'Cleared', 'Rejected'];
const PAGE_SIZE = 25;
const LS_URL_KEY = 'hp_supabase_url';
const LS_KEY_KEY = 'hp_supabase_key';

// --- Built-in Supabase Credentials (anon key is public-safe with RLS) ---
const SUPABASE_URL = 'https://urfefzdzewvmcjmrcozf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_7uS-gF537CCBmTwIRDPpng_MREGRIJ9';

// --- State ---
const state = {
  db: null,
  candidates: [],
  filteredCandidates: [],
  currentPage: 1,
  filters: { search: '', client: '', stage: '', status: '' },
  dashboardStageFilter: null,
  editingCandidate: null,
  history: [],
};

// --- DOM Refs ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  setupScreen: $('#setup-screen'),
  setupUrl: $('#setup-url'),
  setupKey: $('#setup-key'),
  setupConnect: $('#setup-connect'),
  setupError: $('#setup-error'),
  app: $('#app'),
  dashboardStrip: $('#dashboard-strip'),
  filterSearch: $('#filter-search'),
  filterClient: $('#filter-client'),
  filterStage: $('#filter-stage'),
  filterStatus: $('#filter-status'),
  activeFiltersCount: $('#active-filters-count'),
  btnClearFilters: $('#btn-clear-filters'),
  tableBody: $('#table-body'),
  pagination: $('#pagination'),
  pageInfo: $('#page-info'),
  btnPrev: $('#btn-prev'),
  btnNext: $('#btn-next'),
  btnAdd: $('#btn-add'),
  btnExport: $('#btn-export'),
  btnSettings: $('#btn-settings'),
  settingsMenu: $('#settings-menu'),
  btnResetCreds: $('#btn-reset-creds'),
  panelOverlay: $('#panel-overlay'),
  slidePanel: $('#slide-panel'),
  panelTitle: $('#panel-title'),
  panelBody: $('#panel-body'),
  panelFooter: $('#panel-footer'),
  panelClose: $('#panel-close'),
  panelCancel: $('#panel-cancel'),
  panelSave: $('#panel-save'),
  confirmOverlay: $('#confirm-overlay'),
  confirmTitle: $('#confirm-title'),
  confirmMessage: $('#confirm-message'),
  confirmCancel: $('#confirm-cancel'),
  confirmYes: $('#confirm-yes'),
  toastContainer: $('#toast-container'),
};

// =========================================
// INIT
// =========================================
document.addEventListener('DOMContentLoaded', () => {
  // Auto-connect with built-in credentials — no setup screen needed
  initSupabase(SUPABASE_URL, SUPABASE_ANON_KEY);
  bindGlobalEvents();
});

function showSetupScreen() {
  dom.setupScreen.style.display = 'flex';
  dom.app.classList.remove('visible');
}

function hideSetupScreen() {
  dom.setupScreen.style.display = 'none';
  dom.app.classList.add('visible');
}

// =========================================
// SUPABASE
// =========================================
function initSupabase(url, key) {
  try {
    state.db = supabase.createClient(url, key);
    localStorage.setItem(LS_URL_KEY, url);
    localStorage.setItem(LS_KEY_KEY, key);
    hideSetupScreen();
    loadCandidates();
  } catch (e) {
    showSetupError('Failed to initialize Supabase client.');
  }
}

function showSetupError(msg) {
  dom.setupError.textContent = msg;
  dom.setupError.classList.add('visible');
}

async function loadCandidates() {
  showTableLoading();
  const { data, error } = await state.db
    .from('hiring_pipeline')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    toast('Failed to load candidates: ' + error.message, 'error');
    showTableEmpty('Could not load data. Check your Supabase connection.');
    return;
  }
  state.candidates = data || [];
  populateFilterDropdowns();
  applyFilters();
  renderDashboard();
}

async function loadHistory(candidateId) {
  const { data, error } = await state.db
    .from('pipeline_history')
    .select('*')
    .eq('candidate_id', candidateId)
    .order('timestamp', { ascending: true });

  if (error) {
    toast('Failed to load history', 'error');
    return [];
  }
  return data || [];
}

async function insertCandidate(record) {
  const { data, error } = await state.db
    .from('hiring_pipeline')
    .insert([record])
    .select()
    .single();

  if (error) {
    toast('Failed to add candidate: ' + error.message, 'error');
    return null;
  }

  // Insert initial history
  await insertHistory({
    candidate_id: data.id,
    stage: data.current_stage,
    status: data.stage_status,
    note: 'Candidate added to pipeline',
  });

  return data;
}

async function updateCandidate(id, updates) {
  const { data, error } = await state.db
    .from('hiring_pipeline')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    toast('Failed to update candidate: ' + error.message, 'error');
    return null;
  }
  return data;
}

async function deleteCandidate(id) {
  const { error } = await state.db
    .from('hiring_pipeline')
    .delete()
    .eq('id', id);

  if (error) {
    toast('Failed to delete candidate: ' + error.message, 'error');
    return false;
  }
  return true;
}

async function insertHistory(entry) {
  const { error } = await state.db
    .from('pipeline_history')
    .insert([entry]);

  if (error) {
    console.error('History insert failed:', error.message);
  }
}

// =========================================
// DASHBOARD
// =========================================
function renderDashboard() {
  const all = state.candidates;
  const totalActive = all.filter(c => c.current_stage !== 'Joined' && c.current_stage !== 'Declined').length;
  const rejected = all.filter(c => c.stage_status === 'Rejected').length;

  const cards = [
    { key: 'total', label: 'Total Active', count: totalActive },
    ...STAGES.map(s => ({
      key: s,
      label: s,
      count: all.filter(c => c.current_stage === s).length,
    })),
    { key: 'rejected', label: 'Rejected', count: rejected },
  ];

  dom.dashboardStrip.innerHTML = cards.map(c => `
    <div class="dash-card ${state.dashboardStageFilter === c.key ? 'active' : ''}"
         data-stage="${c.key}" id="dash-${c.key.replace(/\s+/g, '-').toLowerCase()}">
      <div class="dash-count">${c.count}</div>
      <div class="dash-label">${c.label}</div>
    </div>
  `).join('');

  // Click handlers
  dom.dashboardStrip.querySelectorAll('.dash-card').forEach(card => {
    card.addEventListener('click', () => {
      const key = card.dataset.stage;
      if (state.dashboardStageFilter === key) {
        state.dashboardStageFilter = null; // toggle off
      } else {
        state.dashboardStageFilter = key;
      }
      // Clear stage & status dropdown filters when using dashboard
      dom.filterStage.value = '';
      dom.filterStatus.value = '';
      state.filters.stage = '';
      state.filters.status = '';
      applyFilters();
      renderDashboard();
    });
  });
}

// =========================================
// FILTERS
// =========================================
function populateFilterDropdowns() {
  // Clients
  const clients = [...new Set(state.candidates.map(c => c.client).filter(Boolean))].sort();
  dom.filterClient.innerHTML = '<option value="">All Clients</option>' +
    clients.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

  // Stages
  dom.filterStage.innerHTML = '<option value="">All Stages</option>' +
    STAGES.map(s => `<option value="${s}">${s}</option>`).join('') +
    '<option value="Declined">Declined</option>';
}

function applyFilters() {
  let list = [...state.candidates];

  // Dashboard stage filter
  if (state.dashboardStageFilter) {
    if (state.dashboardStageFilter === 'total') {
      list = list.filter(c => c.current_stage !== 'Joined' && c.current_stage !== 'Declined');
    } else if (state.dashboardStageFilter === 'rejected') {
      list = list.filter(c => c.stage_status === 'Rejected');
    } else {
      list = list.filter(c => c.current_stage === state.dashboardStageFilter);
    }
  }

  // Text search
  const q = state.filters.search.toLowerCase().trim();
  if (q) {
    list = list.filter(c =>
      (c.full_name || '').toLowerCase().includes(q) ||
      (c.role || '').toLowerCase().includes(q) ||
      (c.client || '').toLowerCase().includes(q)
    );
  }

  // Client filter
  if (state.filters.client) {
    list = list.filter(c => c.client === state.filters.client);
  }

  // Stage filter
  if (state.filters.stage) {
    list = list.filter(c => c.current_stage === state.filters.stage);
  }

  // Status filter
  if (state.filters.status) {
    list = list.filter(c => c.stage_status === state.filters.status);
  }

  state.filteredCandidates = list;
  state.currentPage = 1;
  renderTable();
  renderPagination();
  updateActiveFiltersCount();
}

function updateActiveFiltersCount() {
  let count = 0;
  if (state.filters.search) count++;
  if (state.filters.client) count++;
  if (state.filters.stage) count++;
  if (state.filters.status) count++;
  if (state.dashboardStageFilter) count++;

  if (count > 0) {
    dom.activeFiltersCount.textContent = `${count} filter${count > 1 ? 's' : ''} active`;
    dom.activeFiltersCount.classList.add('visible');
  } else {
    dom.activeFiltersCount.classList.remove('visible');
  }
}

function clearAllFilters() {
  state.filters = { search: '', client: '', stage: '', status: '' };
  state.dashboardStageFilter = null;
  dom.filterSearch.value = '';
  dom.filterClient.value = '';
  dom.filterStage.value = '';
  dom.filterStatus.value = '';
  applyFilters();
  renderDashboard();
}

// =========================================
// TABLE
// =========================================
function renderTable() {
  const start = (state.currentPage - 1) * PAGE_SIZE;
  const page = state.filteredCandidates.slice(start, start + PAGE_SIZE);

  if (state.filteredCandidates.length === 0) {
    showTableEmpty('No candidates found', 'Try adjusting your filters or add a new candidate');
    return;
  }

  dom.tableBody.innerHTML = page.map(c => {
    const screeners = [c.screened_by_1, c.screened_by_2].filter(Boolean).join(', ');
    const interviewers = [c.interviewed_by_1, c.interviewed_by_2].filter(Boolean).join(', ');
    return `
    <tr data-id="${c.id}" class="candidate-row">
      <td>${esc(c.full_name)}</td>
      <td>${esc(c.location || '—')}</td>
      <td>${esc(c.role || '—')}</td>
      <td>${esc(c.client || '—')}</td>
      <td>
        <span class="stage-label">
          <span class="stage-dot"></span>
          ${esc(c.current_stage || '—')}
        </span>
      </td>
      <td>
        <span class="status-tag ${(c.stage_status || '').toLowerCase()}">
          ${esc(c.stage_status || '—')}
        </span>
      </td>
      <td class="td-screened" title="${esc(screeners)}">${esc(screeners || '—')}</td>
      <td class="td-interviewed" title="${esc(interviewers)}">${esc(interviewers || '—')}</td>
      <td class="td-date">${formatDate(c.date)}</td>
      <td class="td-notes" title="${esc(c.notes || '')}">${esc(c.notes || '—')}</td>
      <td>
        <div class="row-actions">
          <button title="Edit" class="btn-edit-row" data-id="${c.id}">✏️</button>
        </div>
      </td>
    </tr>
  `;
  }).join('');

  // Row click → edit
  dom.tableBody.querySelectorAll('.candidate-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.btn-edit-row')) return;
      openEditPanel(row.dataset.id);
    });
  });

  dom.tableBody.querySelectorAll('.btn-edit-row').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditPanel(btn.dataset.id);
    });
  });
}

function showTableLoading() {
  dom.tableBody.innerHTML = `
    <tr><td colspan="11">
      <div class="table-loading">
        <div class="loading-spinner"></div>
        Loading candidates…
      </div>
    </td></tr>`;
}

function showTableEmpty(msg, sub) {
  dom.tableBody.innerHTML = `
    <tr><td colspan="11">
      <div class="table-empty">
        <div class="empty-icon">📋</div>
        <p>${msg || 'No candidates yet'}</p>
        ${sub ? `<p class="empty-sub">${sub}</p>` : ''}
      </div>
    </td></tr>`;
}

// =========================================
// PAGINATION
// =========================================
function renderPagination() {
  const total = state.filteredCandidates.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  dom.pageInfo.innerHTML = `Page <span>${state.currentPage}</span> of <span>${totalPages}</span> · ${total} candidate${total !== 1 ? 's' : ''}`;
  dom.btnPrev.disabled = state.currentPage <= 1;
  dom.btnNext.disabled = state.currentPage >= totalPages;

  dom.pagination.style.display = total > 0 ? 'flex' : 'none';
}

// =========================================
// PANEL (Add / Edit)
// =========================================
function openAddPanel() {
  state.editingCandidate = null;
  dom.panelTitle.textContent = 'Add Candidate';
  renderPanelForm(null);
  dom.panelFooter.style.display = 'flex';
  openPanel();
}

async function openEditPanel(id) {
  const candidate = state.candidates.find(c => c.id === id);
  if (!candidate) return;

  state.editingCandidate = candidate;
  dom.panelTitle.textContent = 'Edit Candidate';

  // Load history
  state.history = await loadHistory(id);
  renderPanelForm(candidate);
  dom.panelFooter.style.display = 'flex';
  openPanel();
}

function renderPanelForm(c) {
  const isEdit = !!c;
  const currentStageIdx = c ? STAGES.indexOf(c.current_stage) : -1;
  const canAdvance = isEdit && currentStageIdx >= 0 && currentStageIdx < STAGES.length - 1 && c.stage_status !== 'Rejected';
  const canReject = isEdit && c.stage_status !== 'Rejected';
  const isDeclined = isEdit && c.current_stage === 'Declined';

  dom.panelBody.innerHTML = `
    <form class="panel-form" id="panel-form">
      <div class="form-group">
        <label class="form-required" for="pf-name">Full Name</label>
        <input type="text" id="pf-name" placeholder="e.g. Rahul Sharma" value="${esc(c?.full_name || '')}" required>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="pf-location">Location</label>
          <input type="text" id="pf-location" placeholder="e.g. Bangalore" value="${esc(c?.location || '')}">
        </div>
        <div class="form-group">
          <label for="pf-client">Client</label>
          <input type="text" id="pf-client" placeholder="e.g. WAB" value="${esc(c?.client || '')}">
        </div>
      </div>
      <div class="form-group">
        <label for="pf-role">Role</label>
        <input type="text" id="pf-role" placeholder="e.g. Frontend Developer" value="${esc(c?.role || '')}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="pf-stage">Current Stage</label>
          <select id="pf-stage">
            ${STAGES.map(s => `<option value="${s}" ${c?.current_stage === s ? 'selected' : ''}>${s}</option>`).join('')}
            <option value="Declined" ${c?.current_stage === 'Declined' ? 'selected' : ''}>Declined</option>
          </select>
        </div>
        <div class="form-group">
          <label for="pf-status">Stage Status</label>
          <select id="pf-status">
            ${STATUSES.map(s => `<option value="${s}" ${c?.stage_status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="screening-section">
        <div class="form-section-label">Screening Panel</div>
        <div class="form-row">
          <div class="form-group">
            <label for="pf-screened1">Screened By #1</label>
            <input type="text" id="pf-screened1" placeholder="e.g. Priya Mehta" value="${esc(c?.screened_by_1 || '')}">
          </div>
          <div class="form-group">
            <label for="pf-screened2">Screened By #2</label>
            <input type="text" id="pf-screened2" placeholder="e.g. Ravi Kumar" value="${esc(c?.screened_by_2 || '')}">
          </div>
        </div>
      </div>
      <div id="interview-section">
        <div class="form-section-label">Interview Panel</div>
        <div class="form-row">
          <div class="form-group">
            <label for="pf-interviewer1">Interviewer #1</label>
            <input type="text" id="pf-interviewer1" placeholder="e.g. Amit Shah" value="${esc(c?.interviewed_by_1 || '')}">
          </div>
          <div class="form-group">
            <label for="pf-interviewer2">Interviewer #2</label>
            <input type="text" id="pf-interviewer2" placeholder="e.g. Sneha Rao" value="${esc(c?.interviewed_by_2 || '')}">
          </div>
        </div>
      </div>
      <div class="form-group">
        <label for="pf-date">Date</label>
        <input type="date" id="pf-date" value="${c?.date || ''}">
      </div>
      <div class="form-group">
        <label for="pf-notes">Notes</label>
        <textarea id="pf-notes" placeholder="Quick note about this candidate…">${esc(c?.notes || '')}</textarea>
      </div>

      ${isEdit ? `
        <div class="panel-actions">
          ${canAdvance ? `<button type="button" class="btn btn-secondary btn-sm" id="btn-advance">⏩ Move to Next Stage</button>` : ''}
          ${canReject ? `<button type="button" class="btn btn-danger btn-sm" id="btn-reject">✖ Reject</button>` : ''}
          ${!isDeclined && c.current_stage === 'Offer' ? `<button type="button" class="btn btn-secondary btn-sm" id="btn-decline" style="border-color:rgba(240,165,0,0.3);color:var(--status-pending);">🚫 Declined</button>` : ''}
          <button type="button" class="btn btn-danger btn-sm" id="btn-delete">🗑 Delete</button>
        </div>

        <div class="add-note-row">
          <input type="text" id="add-note-input" placeholder="Add a timestamped note…">
          <button type="button" class="btn btn-secondary btn-sm" id="btn-add-note">Add</button>
        </div>

        ${renderHistoryTimeline(state.history)}
      ` : ''}
    </form>
  `;

  // Bind edit actions
  if (isEdit) {
    const advanceBtn = $('#btn-advance');
    const rejectBtn = $('#btn-reject');
    const declineBtn = $('#btn-decline');
    const deleteBtn = $('#btn-delete');
    const addNoteBtn = $('#btn-add-note');

    if (advanceBtn) advanceBtn.addEventListener('click', () => handleAdvance(c));
    if (rejectBtn) rejectBtn.addEventListener('click', () => handleReject(c));
    if (declineBtn) declineBtn.addEventListener('click', () => handleDecline(c));
    if (deleteBtn) deleteBtn.addEventListener('click', () => handleDelete(c));
    if (addNoteBtn) addNoteBtn.addEventListener('click', () => handleAddNote(c));
  }

  // Toggle screening/interview sections based on stage
  togglePanelSections();
  const stageSelect = $('#pf-stage');
  if (stageSelect) {
    stageSelect.addEventListener('change', togglePanelSections);
  }
}

function togglePanelSections() {
  const stage = $('#pf-stage')?.value || '';
  const screeningSection = $('#screening-section');
  const interviewSection = $('#interview-section');

  if (screeningSection) {
    screeningSection.style.display = (stage === 'Internal Screen') ? 'block' : 'none';
  }
  if (interviewSection) {
    interviewSection.style.display = (['Round 1', 'Round 2', 'Round 3'].includes(stage)) ? 'block' : 'none';
  }
}

function renderHistoryTimeline(history) {
  if (!history || history.length === 0) {
    return `
      <div class="history-section">
        <h3>Stage History</h3>
        <p style="color:var(--text-muted); font-size:0.85rem;">No history yet</p>
      </div>`;
  }

  return `
    <div class="history-section">
      <h3>Stage History</h3>
      <div class="timeline">
        ${history.map(h => `
          <div class="timeline-item status-${(h.status || 'pending').toLowerCase()}">
            <div class="timeline-stage">${esc(h.stage)}</div>
            <div class="timeline-meta">
              <span class="status-tag ${(h.status || '').toLowerCase()}">${esc(h.status)}</span>
              <span class="timeline-date">${formatTimestamp(h.timestamp)}</span>
            </div>
            ${h.note ? `<div class="timeline-note">"${esc(h.note)}"</div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>`;
}

function openPanel() {
  dom.slidePanel.classList.add('open');
  dom.panelOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closePanel() {
  dom.slidePanel.classList.remove('open');
  dom.panelOverlay.classList.remove('open');
  document.body.style.overflow = '';
  state.editingCandidate = null;
  state.history = [];
}

// =========================================
// PANEL ACTIONS
// =========================================
async function handleSave() {
  const name = $('#pf-name')?.value?.trim();
  if (!name) {
    toast('Full Name is required', 'error');
    return;
  }

  const record = {
    full_name: name,
    location: $('#pf-location')?.value?.trim() || null,
    role: $('#pf-role')?.value?.trim() || null,
    client: $('#pf-client')?.value?.trim() || null,
    current_stage: $('#pf-stage')?.value || 'Internal Screen',
    stage_status: $('#pf-status')?.value || 'Pending',
    screened_by_1: $('#pf-screened1')?.value?.trim() || null,
    screened_by_2: $('#pf-screened2')?.value?.trim() || null,
    interviewed_by_1: $('#pf-interviewer1')?.value?.trim() || null,
    interviewed_by_2: $('#pf-interviewer2')?.value?.trim() || null,
    date: $('#pf-date')?.value || null,
    notes: $('#pf-notes')?.value?.trim() || null,
  };

  dom.panelSave.disabled = true;
  dom.panelSave.innerHTML = '<span class="loading-spinner"></span>';

  if (state.editingCandidate) {
    // Check if stage/status changed
    const old = state.editingCandidate;
    const stageChanged = old.current_stage !== record.current_stage;
    const statusChanged = old.stage_status !== record.stage_status;

    const result = await updateCandidate(state.editingCandidate.id, record);
    if (result) {
      if (stageChanged || statusChanged) {
        await insertHistory({
          candidate_id: result.id,
          stage: record.current_stage,
          status: record.stage_status,
          note: `Updated${stageChanged ? ' stage' : ''}${statusChanged ? ' status' : ''}`,
        });
      }
      toast('Candidate updated', 'success');
    }
  } else {
    const result = await insertCandidate(record);
    if (result) {
      toast('Candidate added', 'success');
    }
  }

  dom.panelSave.disabled = false;
  dom.panelSave.innerHTML = 'Save';
  closePanel();
  await loadCandidates();
}

async function handleAdvance(candidate) {
  const idx = STAGES.indexOf(candidate.current_stage);
  if (idx < 0 || idx >= STAGES.length - 1) return;

  const nextStage = STAGES[idx + 1];

  // Mark current as Cleared
  await updateCandidate(candidate.id, {
    current_stage: nextStage,
    stage_status: 'Pending',
  });
  await insertHistory({
    candidate_id: candidate.id,
    stage: candidate.current_stage,
    status: 'Cleared',
    note: `Cleared — moved to ${nextStage}`,
  });
  await insertHistory({
    candidate_id: candidate.id,
    stage: nextStage,
    status: 'Pending',
    note: null,
  });

  toast(`Moved to ${nextStage}`, 'success');
  closePanel();
  await loadCandidates();
}

async function handleReject(candidate) {
  await updateCandidate(candidate.id, { stage_status: 'Rejected' });
  await insertHistory({
    candidate_id: candidate.id,
    stage: candidate.current_stage,
    status: 'Rejected',
    note: 'Candidate rejected',
  });
  toast('Candidate rejected', 'info');
  closePanel();
  await loadCandidates();
}

async function handleDecline(candidate) {
  await updateCandidate(candidate.id, {
    current_stage: 'Declined',
    stage_status: 'Rejected',
  });
  await insertHistory({
    candidate_id: candidate.id,
    stage: 'Declined',
    status: 'Rejected',
    note: 'Candidate declined the offer',
  });
  toast('Candidate marked as declined', 'info');
  closePanel();
  await loadCandidates();
}

function handleDelete(candidate) {
  dom.confirmTitle.textContent = 'Delete Candidate';
  dom.confirmMessage.textContent = `Permanently delete ${candidate.full_name}? This action cannot be undone.`;
  dom.confirmOverlay.classList.add('open');

  // Detach old + attach new
  const newYes = dom.confirmYes.cloneNode(true);
  dom.confirmYes.parentNode.replaceChild(newYes, dom.confirmYes);
  dom.confirmYes = newYes;

  const newCancel = dom.confirmCancel.cloneNode(true);
  dom.confirmCancel.parentNode.replaceChild(newCancel, dom.confirmCancel);
  dom.confirmCancel = newCancel;

  dom.confirmYes.addEventListener('click', async () => {
    dom.confirmOverlay.classList.remove('open');
    const ok = await deleteCandidate(candidate.id);
    if (ok) {
      toast('Candidate deleted', 'success');
      closePanel();
      await loadCandidates();
    }
  });

  dom.confirmCancel.addEventListener('click', () => {
    dom.confirmOverlay.classList.remove('open');
  });
}

async function handleAddNote(candidate) {
  const input = $('#add-note-input');
  const note = input?.value?.trim();
  if (!note) return;

  // Append to candidate notes
  const existingNotes = candidate.notes || '';
  const timestamp = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const updatedNotes = existingNotes
    ? `${existingNotes}\n[${timestamp}] ${note}`
    : `[${timestamp}] ${note}`;

  await updateCandidate(candidate.id, { notes: updatedNotes });
  await insertHistory({
    candidate_id: candidate.id,
    stage: candidate.current_stage,
    status: candidate.stage_status,
    note: note,
  });

  toast('Note added', 'success');
  input.value = '';

  // Refresh panel
  state.history = await loadHistory(candidate.id);
  candidate.notes = updatedNotes;
  state.editingCandidate = candidate;
  renderPanelForm(candidate);
}

// =========================================
// EXPORT CSV
// =========================================
function exportCSV() {
  const rows = state.filteredCandidates;
  if (rows.length === 0) {
    toast('No data to export', 'error');
    return;
  }

  const headers = ['Name', 'Location', 'Role', 'Client', 'Stage', 'Stage Status', 'Screened By 1', 'Screened By 2', 'Interviewer 1', 'Interviewer 2', 'Date', 'Notes'];
  const csvRows = [headers.join(',')];

  rows.forEach(c => {
    csvRows.push([
      csvEscape(c.full_name),
      csvEscape(c.location),
      csvEscape(c.role),
      csvEscape(c.client),
      csvEscape(c.current_stage),
      csvEscape(c.stage_status),
      csvEscape(c.screened_by_1),
      csvEscape(c.screened_by_2),
      csvEscape(c.interviewed_by_1),
      csvEscape(c.interviewed_by_2),
      csvEscape(c.date),
      csvEscape(c.notes),
    ].join(','));
  });

  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const today = new Date().toISOString().split('T')[0];
  a.href = url;
  a.download = `pipeline-${today}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${rows.length} candidates`, 'success');
}

function csvEscape(val) {
  if (!val) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// =========================================
// EVENTS
// =========================================
function bindGlobalEvents() {
  // Setup
  dom.setupConnect.addEventListener('click', () => {
    const url = dom.setupUrl.value.trim();
    const key = dom.setupKey.value.trim();
    if (!url || !key) {
      showSetupError('Both fields are required.');
      return;
    }
    if (!url.startsWith('https://')) {
      showSetupError('URL must start with https://');
      return;
    }
    initSupabase(url, key);
  });

  // Allow enter on setup
  dom.setupKey.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') dom.setupConnect.click();
  });

  // Add candidate
  dom.btnAdd.addEventListener('click', openAddPanel);

  // Export
  dom.btnExport.addEventListener('click', exportCSV);

  // Settings
  dom.btnSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    dom.settingsMenu.classList.toggle('open');
  });
  document.addEventListener('click', () => dom.settingsMenu.classList.remove('open'));

  dom.btnResetCreds.addEventListener('click', () => {
    localStorage.removeItem(LS_URL_KEY);
    localStorage.removeItem(LS_KEY_KEY);
    state.db = null;
    state.candidates = [];
    showSetupScreen();
    dom.settingsMenu.classList.remove('open');
    toast('Credentials cleared', 'info');
  });

  // Panel close
  dom.panelClose.addEventListener('click', closePanel);
  dom.panelCancel.addEventListener('click', closePanel);
  dom.panelOverlay.addEventListener('click', closePanel);
  dom.panelSave.addEventListener('click', handleSave);

  // Filters
  let searchDebounce;
  dom.filterSearch.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.filters.search = dom.filterSearch.value;
      state.dashboardStageFilter = null;
      applyFilters();
      renderDashboard();
    }, 250);
  });

  dom.filterClient.addEventListener('change', () => {
    state.filters.client = dom.filterClient.value;
    state.dashboardStageFilter = null;
    applyFilters();
    renderDashboard();
  });

  dom.filterStage.addEventListener('change', () => {
    state.filters.stage = dom.filterStage.value;
    state.dashboardStageFilter = null;
    applyFilters();
    renderDashboard();
  });

  dom.filterStatus.addEventListener('change', () => {
    state.filters.status = dom.filterStatus.value;
    state.dashboardStageFilter = null;
    applyFilters();
    renderDashboard();
  });

  dom.btnClearFilters.addEventListener('click', clearAllFilters);

  // Pagination
  dom.btnPrev.addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      renderTable();
      renderPagination();
    }
  });

  dom.btnNext.addEventListener('click', () => {
    const totalPages = Math.ceil(state.filteredCandidates.length / PAGE_SIZE);
    if (state.currentPage < totalPages) {
      state.currentPage++;
      renderTable();
      renderPagination();
    }
  });

  // Keyboard: Escape to close panel
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (dom.confirmOverlay.classList.contains('open')) {
        dom.confirmOverlay.classList.remove('open');
      } else if (dom.slidePanel.classList.contains('open')) {
        closePanel();
      }
    }
  });
}

// =========================================
// UTILITIES
// =========================================
function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatTimestamp(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return ts;
  }
}

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  dom.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(30px)';
    el.style.transition = 'all 0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

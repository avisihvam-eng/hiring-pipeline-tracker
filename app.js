/* =========================================
   Hiring Pipeline Tracker — Production App
   ========================================= */

// --- Supabase Config (anon key is public by design; RLS enforces auth) ---
const SUPABASE_URL = 'https://urfefzdzewvmcjmrcozf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyZmVmemR6ZXd2bWNqbXJjb3pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MDU5ODQsImV4cCI6MjA5MDI4MTk4NH0.wmZbxwk0KZsiKlvr0HCyUM2p5hrnwwqItaf9bZ5rcpo';

// --- Constants ---
const STAGES = ['Internal Screen', 'Round 1', 'Round 2', 'Round 3', 'Offer', 'Joined'];
const STATUSES = ['Pending', 'Cleared', 'Rejected'];
const PAGE_SIZE = 25;

// --- Single Supabase Client Instance (§9a) ---
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- State ---
const state = {
  user: null,
  candidates: [],
  filteredCandidates: [],
  currentPage: 1,
  filters: { search: '', client: '', stage: '', status: '' },
  dashboardStageFilter: null,
  editingCandidate: null,
  history: [],
};

// --- Rate Limit (§7) ---
const rateLimit = { attempts: 0, resetAt: 0 };

// --- DOM Refs (lazy — populated after DOMContentLoaded) ---
let dom = {};

// =========================================
// INIT
// =========================================
document.addEventListener('DOMContentLoaded', () => {
  dom = {
    loginScreen: $('#login-screen'),
    loginEmail: $('#login-email'),
    loginSubmit: $('#login-submit'),
    loginError: $('#login-error'),
    loginSuccess: $('#login-success'),
    loginClose: $('#login-close'),
    app: $('#app'),
    userGreeting: $('#user-greeting'),
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
    btnActivity: $('#btn-activity'),
    btnLogout: $('#btn-logout'),
    btnSignIn: $('#btn-signin'),
    ccUserArea: $('#cc-user-area'),
    ccAvatar: $('#cc-avatar'),
    ccUsername: $('#cc-username'),
    activitySection: $('#activity-log-section'),
    activityBody: $('#activity-log-body'),
    btnCloseActivity: $('#btn-close-activity'),
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

  // Listen for auth state changes (§1, §5)
  db.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      state.user = session.user;
      updateAuthUI();
      loadCandidates(); // Reload with auth context
    } else if (event === 'SIGNED_OUT') {
      state.user = null;
      updateAuthUI();
    }
  });

  // Always show the app immediately — login is optional
  checkSession();
  bindGlobalEvents();
});

async function checkSession() {
  try {
    const { data: { session } } = await db.auth.getSession();
    if (session) {
      state.user = session.user;
    }
  } catch { /* ignore */ }
  // Always show the app — data is publicly readable
  showApp();
}

function showLogin() {
  dom.loginScreen.classList.remove('hidden');
}

function hideLogin() {
  dom.loginScreen.classList.add('hidden');
}

function showApp() {
  dom.loginScreen.classList.add('hidden');
  dom.app.classList.add('visible');
  updateAuthUI();
  loadCandidates();
}

function updateAuthUI() {
  if (state.user) {
    const email = state.user.email || '';
    const initials = email.split('@')[0].substring(0, 2).toUpperCase();
    dom.userGreeting.textContent = `Signed in as ${email}`;
    dom.btnSignIn.style.display = 'none';
    dom.ccUserArea.style.display = 'flex';
    dom.ccAvatar.textContent = initials;
    dom.ccUsername.textContent = email.split('@')[0];
  } else {
    dom.userGreeting.textContent = 'Track every candidate from screen to offer';
    dom.btnSignIn.style.display = '';
    dom.ccUserArea.style.display = 'none';
    dom.ccAvatar.textContent = '';
    dom.ccUsername.textContent = '';
  }
}

function requireAuth() {
  if (state.user) return true;
  toast('Please sign in to make changes', 'info');
  showLogin();
  return false;
}

// =========================================
// AUTH — Magic Link (§1)
// =========================================
async function handleLogin() {
  const email = dom.loginEmail.value.trim().toLowerCase();
  hideLoginMessages();

  if (!email || !email.includes('@')) {
    showLoginError('Please enter a valid email address.');
    return;
  }

  // Rate limit check (§7)
  const now = Date.now();
  if (now < rateLimit.resetAt && rateLimit.attempts >= 3) {
    const secsLeft = Math.ceil((rateLimit.resetAt - now) / 1000);
    showLoginError(`Too many attempts. Please wait ${secsLeft} seconds.`);
    return;
  }
  if (now >= rateLimit.resetAt) {
    rateLimit.attempts = 0;
    rateLimit.resetAt = now + 60000;
  }
  rateLimit.attempts++;

  // Check whitelist
  try {
    const { data, error } = await db.from('allowed_users').select('email').eq('email', email).maybeSingle();
    if (error || !data) {
      showLoginError('This email is not authorized. Contact your admin.');
      return;
    }
  } catch {
    showLoginError('Something went wrong. Please try again.');
    return;
  }

  // Send magic link
  dom.loginSubmit.disabled = true;
  dom.loginSubmit.innerHTML = '<span class="loading-spinner"></span>';

  try {
    const { error } = await db.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    });

    if (error) {
      showLoginError('Could not send the sign-in link. Please try again.');
    } else {
      showLoginSuccess('✓ Magic link sent! Check your inbox.');
    }
  } catch {
    showLoginError('Something went wrong. Please try again.');
  }

  dom.loginSubmit.disabled = false;
  dom.loginSubmit.textContent = 'Send Magic Link';
}

async function handleLogout() {
  try {
    await db.auth.signOut();
  } catch { /* ignore */ }
  state.user = null;
  updateAuthUI();
  toast('Logged out', 'info');
}

function showLoginError(msg) {
  dom.loginError.textContent = msg;
  dom.loginError.classList.add('visible');
}

function showLoginSuccess(msg) {
  dom.loginSuccess.textContent = msg;
  dom.loginSuccess.classList.add('visible');
}

function hideLoginMessages() {
  dom.loginError.textContent = '';
  dom.loginError.classList.remove('visible');
  dom.loginSuccess.textContent = '';
  dom.loginSuccess.classList.remove('visible');
}

// =========================================
// SUPABASE DATA (§5 — all wrapped in try/catch)
// =========================================
async function loadCandidates() {
  showTableLoading();
  try {
    const { data, error } = await db
      .from('hiring_pipeline')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    state.candidates = data || [];
    populateFilterDropdowns();
    applyFilters();
    renderDashboard();
  } catch {
    toast('Something went wrong. Please try again.', 'error');
    showTableEmpty('Could not load data. Please refresh the page.');
  }
}

async function loadHistory(candidateId) {
  try {
    const { data, error } = await db
      .from('pipeline_history')
      .select('*')
      .eq('candidate_id', candidateId)
      .order('timestamp', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch {
    toast('Something went wrong. Please try again.', 'error');
    return [];
  }
}

async function insertCandidate(record) {
  try {
    const { data, error } = await db
      .from('hiring_pipeline')
      .insert([record])
      .select()
      .single();

    if (error) throw error;

    await insertHistory({
      candidate_id: data.id,
      stage: data.current_stage,
      status: data.stage_status,
      note: 'Candidate added to pipeline',
    });

    await logAudit('added', data.full_name);
    return data;
  } catch {
    toast('Something went wrong. Please try again.', 'error');
    return null;
  }
}

async function updateCandidate(id, updates) {
  try {
    const { data, error } = await db
      .from('hiring_pipeline')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    await logAudit('updated', data.full_name);
    return data;
  } catch {
    toast('Something went wrong. Please try again.', 'error');
    return null;
  }
}

async function deleteCandidate(id) {
  try {
    // Get name before deleting for audit
    const candidate = state.candidates.find(c => c.id === id);
    const { error } = await db
      .from('hiring_pipeline')
      .delete()
      .eq('id', id);

    if (error) throw error;
    if (candidate) await logAudit('deleted', candidate.full_name);
    return true;
  } catch {
    toast('Something went wrong. Please try again.', 'error');
    return false;
  }
}

async function insertHistory(entry) {
  try {
    await db.from('pipeline_history').insert([entry]);
  } catch { /* non-critical */ }
}

// =========================================
// AUDIT LOG (§3)
// =========================================
async function logAudit(action, candidateName) {
  try {
    await db.from('audit_log').insert([{
      user_email: state.user?.email || 'unknown',
      action,
      candidate_name: candidateName,
    }]);
  } catch { /* non-critical, don't block UX */ }
}

async function loadAuditLog() {
  try {
    const { data, error } = await db
      .from('audit_log')
      .select('*')
      .order('changed_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    renderAuditLog(data || []);
  } catch {
    dom.activityBody.innerHTML = '<p style="color:var(--text-muted); padding:20px;">Could not load activity log.</p>';
  }
}

function renderAuditLog(entries) {
  if (entries.length === 0) {
    dom.activityBody.innerHTML = '<p style="color:var(--text-muted); padding:20px;">No activity recorded yet.</p>';
    return;
  }

  dom.activityBody.innerHTML = `
    <table class="activity-log-table">
      <thead><tr>
        <th>User</th><th>Action</th><th>Candidate</th><th>When</th>
      </tr></thead>
      <tbody>
        ${entries.map(e => `
          <tr>
            <td>${esc(e.user_email)}</td>
            <td><span class="action-tag ${e.action}">${esc(e.action)}</span></td>
            <td>${esc(e.candidate_name)}</td>
            <td>${formatTimestamp(e.changed_at)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
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

  dom.dashboardStrip.querySelectorAll('.dash-card').forEach(card => {
    card.addEventListener('click', () => {
      const key = card.dataset.stage;
      state.dashboardStageFilter = state.dashboardStageFilter === key ? null : key;
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
// FILTERS (§9b — local filtering, no Supabase calls)
// =========================================
function populateFilterDropdowns() {
  const clients = [...new Set(state.candidates.map(c => c.client).filter(Boolean))].sort();
  dom.filterClient.innerHTML = '<option value="">All Clients</option>' +
    clients.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

  dom.filterStage.innerHTML = '<option value="">All Stages</option>' +
    STAGES.map(s => `<option value="${s}">${s}</option>`).join('') +
    '<option value="Declined">Declined</option>';
}

function applyFilters() {
  let list = [...state.candidates];

  if (state.dashboardStageFilter) {
    if (state.dashboardStageFilter === 'total') {
      list = list.filter(c => c.current_stage !== 'Joined' && c.current_stage !== 'Declined');
    } else if (state.dashboardStageFilter === 'rejected') {
      list = list.filter(c => c.stage_status === 'Rejected');
    } else {
      list = list.filter(c => c.current_stage === state.dashboardStageFilter);
    }
  }

  const q = state.filters.search.toLowerCase().trim();
  if (q) {
    list = list.filter(c =>
      (c.full_name || '').toLowerCase().includes(q) ||
      (c.role || '').toLowerCase().includes(q) ||
      (c.client || '').toLowerCase().includes(q)
    );
  }

  if (state.filters.client) list = list.filter(c => c.client === state.filters.client);
  if (state.filters.stage) list = list.filter(c => c.current_stage === state.filters.stage);
  if (state.filters.status) list = list.filter(c => c.stage_status === state.filters.status);

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
    <form class="panel-form" id="panel-form" novalidate>
      <div class="form-group">
        <label class="form-required" for="pf-name">Full Name</label>
        <input type="text" id="pf-name" placeholder="e.g. Rahul Sharma" value="${esc(c?.full_name || '')}" maxlength="100" required>
        <span class="field-error" id="err-name"></span>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="pf-location">Location</label>
          <input type="text" id="pf-location" placeholder="e.g. Bangalore" value="${esc(c?.location || '')}" maxlength="100">
        </div>
        <div class="form-group">
          <label class="form-required" for="pf-client">Client</label>
          <input type="text" id="pf-client" placeholder="e.g. WAB" value="${esc(c?.client || '')}" maxlength="100">
          <span class="field-error" id="err-client"></span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-required" for="pf-role">Role</label>
        <input type="text" id="pf-role" placeholder="e.g. Frontend Developer" value="${esc(c?.role || '')}" maxlength="100">
        <span class="field-error" id="err-role"></span>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-required" for="pf-stage">Current Stage</label>
          <select id="pf-stage">
            ${STAGES.map(s => `<option value="${s}" ${c?.current_stage === s ? 'selected' : ''}>${s}</option>`).join('')}
            <option value="Declined" ${c?.current_stage === 'Declined' ? 'selected' : ''}>Declined</option>
          </select>
          <span class="field-error" id="err-stage"></span>
        </div>
        <div class="form-group">
          <label class="form-required" for="pf-status">Stage Status</label>
          <select id="pf-status">
            ${STATUSES.map(s => `<option value="${s}" ${c?.stage_status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          <span class="field-error" id="err-status"></span>
        </div>
      </div>
      <div id="screening-section">
        <div class="form-section-label">Screening Panel</div>
        <div class="form-row">
          <div class="form-group">
            <label for="pf-screened1">Screened By #1</label>
            <input type="text" id="pf-screened1" placeholder="e.g. Priya Mehta" value="${esc(c?.screened_by_1 || '')}" maxlength="100">
          </div>
          <div class="form-group">
            <label for="pf-screened2">Screened By #2</label>
            <input type="text" id="pf-screened2" placeholder="e.g. Ravi Kumar" value="${esc(c?.screened_by_2 || '')}" maxlength="100">
          </div>
        </div>
      </div>
      <div id="interview-section">
        <div class="form-section-label">Interview Panel</div>
        <div class="form-row">
          <div class="form-group">
            <label for="pf-interviewer1">Interviewer #1</label>
            <input type="text" id="pf-interviewer1" placeholder="e.g. Amit Shah" value="${esc(c?.interviewed_by_1 || '')}" maxlength="100">
          </div>
          <div class="form-group">
            <label for="pf-interviewer2">Interviewer #2</label>
            <input type="text" id="pf-interviewer2" placeholder="e.g. Sneha Rao" value="${esc(c?.interviewed_by_2 || '')}" maxlength="100">
          </div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-required" for="pf-date">Date</label>
        <input type="date" id="pf-date" value="${c?.date || ''}" max="${new Date().toISOString().split('T')[0]}">
        <span class="field-error" id="err-date"></span>
      </div>
      <div class="form-group">
        <label for="pf-notes">Notes <span style="color:var(--text-muted);font-weight:400;">(max 500 chars)</span></label>
        <textarea id="pf-notes" placeholder="Quick note about this candidate…" maxlength="500">${esc(c?.notes || '')}</textarea>
        <span class="field-error" id="err-notes"></span>
      </div>

      ${isEdit ? `
        <div class="panel-actions">
          ${canAdvance ? `<button type="button" class="btn btn-secondary btn-sm" id="btn-advance">⏩ Move to Next Stage</button>` : ''}
          ${canReject ? `<button type="button" class="btn btn-danger btn-sm" id="btn-reject">✖ Reject</button>` : ''}
          ${!isDeclined && c.current_stage === 'Offer' ? `<button type="button" class="btn btn-secondary btn-sm" id="btn-decline" style="border-color:rgba(240,165,0,0.3);color:var(--status-pending);">🚫 Declined</button>` : ''}
          <button type="button" class="btn btn-danger btn-sm" id="btn-delete">🗑 Delete</button>
        </div>

        <div class="add-note-row">
          <input type="text" id="add-note-input" placeholder="Add a timestamped note…" maxlength="500">
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

  togglePanelSections();
  const stageSelect = $('#pf-stage');
  if (stageSelect) stageSelect.addEventListener('change', togglePanelSections);
}

function togglePanelSections() {
  const stage = $('#pf-stage')?.value || '';
  const screeningSection = $('#screening-section');
  const interviewSection = $('#interview-section');

  if (screeningSection) screeningSection.style.display = (stage === 'Internal Screen') ? 'block' : 'none';
  if (interviewSection) interviewSection.style.display = (['Round 1', 'Round 2', 'Round 3'].includes(stage)) ? 'block' : 'none';
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
// INPUT VALIDATION (§4)
// =========================================
function sanitize(str) {
  if (!str) return '';
  return str.trim().replace(/<[^>]*>/g, '');
}

function validateCandidateForm() {
  let valid = true;

  // Clear all errors
  $$('.field-error').forEach(el => el.textContent = '');

  const name = sanitize($('#pf-name')?.value);
  const role = sanitize($('#pf-role')?.value);
  const client = sanitize($('#pf-client')?.value);
  const stage = $('#pf-stage')?.value;
  const status = $('#pf-status')?.value;
  const date = $('#pf-date')?.value;
  const notes = sanitize($('#pf-notes')?.value);

  if (!name || name.length < 2) {
    $('#err-name').textContent = 'Full Name is required (min 2 characters)';
    valid = false;
  }
  if (!role) {
    $('#err-role').textContent = 'Role is required';
    valid = false;
  }
  if (!client) {
    $('#err-client').textContent = 'Client is required';
    valid = false;
  }
  if (!stage || (![...STAGES, 'Declined'].includes(stage))) {
    $('#err-stage').textContent = 'A valid stage is required';
    valid = false;
  }
  if (!status || !STATUSES.includes(status)) {
    $('#err-status').textContent = 'A valid status is required';
    valid = false;
  }
  if (!date) {
    $('#err-date').textContent = 'Date is required';
    valid = false;
  } else {
    const d = new Date(date);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (isNaN(d.getTime())) {
      $('#err-date').textContent = 'Invalid date';
      valid = false;
    } else if (d > today) {
      $('#err-date').textContent = 'Date cannot be in the future';
      valid = false;
    }
  }
  if (notes && notes.length > 500) {
    $('#err-notes').textContent = 'Notes cannot exceed 500 characters';
    valid = false;
  }

  return valid;
}

// =========================================
// PANEL ACTIONS
// =========================================
async function handleSave() {
  if (!requireAuth()) return;
  if (!validateCandidateForm()) return;

  const record = {
    full_name: sanitize($('#pf-name')?.value),
    location: sanitize($('#pf-location')?.value) || null,
    role: sanitize($('#pf-role')?.value),
    client: sanitize($('#pf-client')?.value),
    current_stage: $('#pf-stage')?.value || 'Internal Screen',
    stage_status: $('#pf-status')?.value || 'Pending',
    screened_by_1: sanitize($('#pf-screened1')?.value) || null,
    screened_by_2: sanitize($('#pf-screened2')?.value) || null,
    interviewed_by_1: sanitize($('#pf-interviewer1')?.value) || null,
    interviewed_by_2: sanitize($('#pf-interviewer2')?.value) || null,
    date: $('#pf-date')?.value || null,
    notes: sanitize($('#pf-notes')?.value) || null,
  };

  dom.panelSave.disabled = true;
  dom.panelSave.innerHTML = '<span class="loading-spinner"></span>';

  if (state.editingCandidate) {
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
      toast('Candidate saved', 'success');
    }
  }

  dom.panelSave.disabled = false;
  dom.panelSave.innerHTML = 'Save';
  closePanel();
  await loadCandidates(); // Refetch after mutation (§9c)
}

async function handleAdvance(candidate) {
  if (!requireAuth()) return;
  const idx = STAGES.indexOf(candidate.current_stage);
  if (idx < 0 || idx >= STAGES.length - 1) return;

  const nextStage = STAGES[idx + 1];
  await updateCandidate(candidate.id, { current_stage: nextStage, stage_status: 'Pending' });
  await insertHistory({ candidate_id: candidate.id, stage: candidate.current_stage, status: 'Cleared', note: `Cleared — moved to ${nextStage}` });
  await insertHistory({ candidate_id: candidate.id, stage: nextStage, status: 'Pending', note: null });

  toast(`Moved to ${nextStage}`, 'success');
  closePanel();
  await loadCandidates();
}

async function handleReject(candidate) {
  if (!requireAuth()) return;
  await updateCandidate(candidate.id, { stage_status: 'Rejected' });
  await insertHistory({ candidate_id: candidate.id, stage: candidate.current_stage, status: 'Rejected', note: 'Candidate rejected' });
  toast('Candidate rejected', 'info');
  closePanel();
  await loadCandidates();
}

async function handleDecline(candidate) {
  if (!requireAuth()) return;
  await updateCandidate(candidate.id, { current_stage: 'Declined', stage_status: 'Rejected' });
  await insertHistory({ candidate_id: candidate.id, stage: 'Declined', status: 'Rejected', note: 'Candidate declined the offer' });
  toast('Candidate marked as declined', 'info');
  closePanel();
  await loadCandidates();
}

function handleDelete(candidate) {
  if (!requireAuth()) return;
  dom.confirmTitle.textContent = 'Delete Candidate';
  dom.confirmMessage.textContent = `Permanently delete ${candidate.full_name}? This action cannot be undone.`;
  dom.confirmOverlay.classList.add('open');

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
  if (!requireAuth()) return;
  const input = $('#add-note-input');
  const note = sanitize(input?.value);
  if (!note) return;

  const existingNotes = candidate.notes || '';
  const timestamp = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const updatedNotes = existingNotes
    ? `${existingNotes}\n[${timestamp}] ${note}`
    : `[${timestamp}] ${note}`;

  await updateCandidate(candidate.id, { notes: updatedNotes });
  await insertHistory({ candidate_id: candidate.id, stage: candidate.current_stage, status: candidate.stage_status, note });

  toast('Note added', 'success');
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
      csvEscape(c.full_name), csvEscape(c.location), csvEscape(c.role), csvEscape(c.client),
      csvEscape(c.current_stage), csvEscape(c.stage_status),
      csvEscape(c.screened_by_1), csvEscape(c.screened_by_2),
      csvEscape(c.interviewed_by_1), csvEscape(c.interviewed_by_2),
      csvEscape(c.date), csvEscape(c.notes),
    ].join(','));
  });

  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pipeline-${new Date().toISOString().split('T')[0]}.csv`;
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
  // Login
  dom.loginSubmit.addEventListener('click', handleLogin);
  dom.loginEmail.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });
  dom.loginClose.addEventListener('click', hideLogin);
  dom.loginScreen.addEventListener('click', (e) => { if (e.target === dom.loginScreen) hideLogin(); });

  // Sign In button (header)
  dom.btnSignIn.addEventListener('click', showLogin);

  // Logout
  dom.btnLogout.addEventListener('click', handleLogout);

  // Add candidate
  dom.btnAdd.addEventListener('click', openAddPanel);

  // Export
  dom.btnExport.addEventListener('click', exportCSV);

  // Activity Log
  dom.btnActivity.addEventListener('click', () => {
    const section = dom.activitySection;
    if (section.style.display === 'none') {
      section.style.display = 'block';
      loadAuditLog();
    } else {
      section.style.display = 'none';
    }
  });
  dom.btnCloseActivity.addEventListener('click', () => {
    dom.activitySection.style.display = 'none';
  });

  // Panel close
  dom.panelClose.addEventListener('click', closePanel);
  dom.panelCancel.addEventListener('click', closePanel);
  dom.panelOverlay.addEventListener('click', closePanel);
  dom.panelSave.addEventListener('click', handleSave);

  // Filters — debounced search (§9b) and local dropdown filters
  let searchDebounce;
  dom.filterSearch.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.filters.search = dom.filterSearch.value;
      state.dashboardStageFilter = null;
      applyFilters();
      renderDashboard();
    }, 300);
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
    if (state.currentPage > 1) { state.currentPage--; renderTable(); renderPagination(); }
  });
  dom.btnNext.addEventListener('click', () => {
    const totalPages = Math.ceil(state.filteredCandidates.length / PAGE_SIZE);
    if (state.currentPage < totalPages) { state.currentPage++; renderTable(); renderPagination(); }
  });

  // Keyboard: Escape to close
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
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

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
  } catch { return dateStr; }
}

function formatTimestamp(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return ts; }
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

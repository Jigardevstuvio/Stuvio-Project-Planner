/**
 * Gantt Chart Editor — Full-featured .gantt file editor
 * Compatible with OnlineGantt.com file format
 */
(() => {
  'use strict';

  // ═══════════════════════════════════════
  // CONSTANTS
  // ═══════════════════════════════════════
  const COLORS = [
    { id: '61', hex: '#6366f1', name: 'Indigo' },
    { id: '62', hex: '#f43f5e', name: 'Rose' },
    { id: '63', hex: '#10b981', name: 'Emerald' },
    { id: '64', hex: '#f97316', name: 'Orange' },
    { id: '65', hex: '#f59e0b', name: 'Amber' },
    { id: '66', hex: '#06b6d4', name: 'Cyan' },
    { id: '67', hex: '#8b5cf6', name: 'Violet' },
    { id: '68', hex: '#ec4899', name: 'Pink' },
    { id: '69', hex: '#14b8a6', name: 'Teal' },
    { id: '70', hex: '#0ea5e9', name: 'Sky' },
    { id: '71', hex: '#84cc16', name: 'Lime' },
    { id: '72', hex: '#ef4444', name: 'Red' },
    { id: '73', hex: '#a855f7', name: 'Purple' },
    { id: '74', hex: '#64748b', name: 'Slate' },
    { id: '75', hex: '#78716c', name: 'Stone' },
    { id: '76', hex: '#ea580c', name: 'Burnt' },
    { id: '77', hex: '#0891b2', name: 'Dark Cyan' },
    { id: '78', hex: '#059669', name: 'Dark Green' },
  ];
  const COLOR_MAP = {};
  COLORS.forEach(c => COLOR_MAP[c.id] = c.hex);

  const RES_COLORS = [
    '#6366f1','#06b6d4','#10b981','#f59e0b','#ec4899',
    '#8b5cf6','#f43f5e','#0ea5e9','#84cc16','#a855f7',
    '#14b8a6','#f97316','#ef4444','#64748b','#0891b2',
  ];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const DEFAULT_DAY_W = 32;
  const MIN_DAY_W = 12;
  const MAX_DAY_W = 80;
  const ZOOM_STEP = 6;

  const DEFAULT_COLUMNS = [
    { name: 'Task ID', field: 'TaskID', width: 50, show: true },
    { name: 'Task Name', field: 'TaskName', width: 260, show: true },
    { name: 'Start Date', field: 'StartDate', width: 100, show: true },
    { name: 'End Date', field: 'EndDate', width: 100, show: true },
    { name: 'Duration', field: 'Duration', width: 80, show: true },
    { name: 'Resources', field: 'resources', width: 130, show: true },
    { name: 'Allocated Hrs', field: 'AllocatedHours', width: 90, show: true },
    { name: 'Spent Hrs', field: 'SpentHours', width: 80, show: true },
    { name: 'Remaining Hrs', field: 'RemainingHours', width: 90, show: true },
    { name: 'Progress %', field: 'Progress', width: 80, show: true },
    { name: 'Dependency', field: 'Predecessor', width: 80, show: false },
    { name: 'Color', field: 'color', width: 50, show: false },
  ];

  // ═══════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════
  let G = null; // ganttData – the root JSON object
  let flat = []; // flat render list [{ref, isPhase, phaseIdx, depth}]
  let dayW = DEFAULT_DAY_W;
  let pStart = null, pEnd = null, totalDays = 0;
  let collapsed = new Set();
  let selected = new Set(); // selected TaskIDs
  let lastSelectedId = null;
  let resColorMap = {};
  let curView = 'gantt';
  let undoStack = [], redoStack = [];
  let dirty = false;
  let editingCell = null; // {rowEl, field, taskRef}
  let nextTaskId = 100;
  let projectName = 'Untitled Project';
  let cloudProjectId = null; // Supabase UUID for current project
  const STORAGE_KEY = 'gantt_saved_projects';

  // ═══════════════════════════════════════
  // DOM
  // ═══════════════════════════════════════
  const $ = id => document.getElementById(id);
  const emptyState = $('empty-state');
  const appEl = $('app');
  const tableHeader = $('task-table-header');
  const tableBody = $('task-table-body');
  const tableEl = $('task-table');
  const tlHeader = $('timeline-header');
  const tlBody = $('timeline-body');
  const tlPanel = $('timeline-panel');
  const ctxMenu = $('ctx-menu');
  const colorPicker = $('color-picker');
  const colorGrid = $('color-grid');
  const resPicker = $('res-picker');
  const resPickerList = $('res-picker-list');

  // ═══════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════
  function init() {
    buildColorGrid();
    setupFileIO();
    setupDragDrop();
    setupToolbar();
    setupViewTabs();
    setupContextMenu();
    setupResizeHandle();
    setupZoom();
    setupScrollSync();
    setupKeyboard();
    setupModals();
    setupWizard();
    initCloud();
    autoLoad();
  }

  function initCloud() {
    if (typeof SupabaseStore !== 'undefined') {
      const ok = SupabaseStore.init();
      SupabaseStore.setStatusCallback(updateSyncUI);
      if (ok) updateSyncUI('idle');
    }
  }

  function updateSyncUI(status) {
    const el = $('sync-indicator');
    const txt = $('sync-text');
    if (!el || !txt) return;
    el.dataset.status = status;
    const labels = { idle: 'Cloud', syncing: 'Syncing...', synced: '☁ Synced', error: 'Sync Error' };
    txt.textContent = labels[status] || status;
  }

  // ═══════════════════════════════════════
  // FILE I/O
  // ═══════════════════════════════════════
  function setupFileIO() {
    $('file-input').addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ''; });
    $('file-input-main').addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ''; });
  }

  function readFile(file) {
    projectName = file.name.replace(/\.gantt$/i, '');
    const r = new FileReader();
    r.onload = e => loadData(e.target.result);
    r.readAsText(file);
  }

  async function autoLoad() {
    // First check localStorage for a last-opened project
    const lastProject = localStorage.getItem('gantt_last_project');
    if (lastProject) {
      const saved = getSavedProjects();
      if (saved[lastProject]) {
        projectName = lastProject;
        loadData(saved[lastProject]);
        return;
      }
    }
    // Then try the local .gantt file
    try {
      const r = await fetch('LAILA_NUTRA_Clean_Phase_Plan_With_Daily_Hours.gantt');
      if (r.ok) {
        projectName = 'LAILA NUTRA';
        loadData(await r.text());
        return;
      }
    } catch (_) {}
    renderSavedProjects();
    emptyState.classList.remove('hidden');
    appEl.classList.add('hidden');
  }

  // Map column names to data fields
  const NAME_TO_FIELD = {
    'Task ID': 'TaskID', 'Task Name': 'TaskName',
    'Start Date': 'StartDate', 'End Date': 'EndDate',
    'Duration': 'Duration',
    'Allocated Hrs': 'AllocatedHours', 'Spent Hrs': 'SpentHours',
    'Remaining Hrs': 'RemainingHours',
    'Progress %': 'Progress', 'Dependency': 'Predecessor',
    'Resources': 'resources', 'Color': 'color',
    // Legacy mappings for migration
    'Daily Hours': 'DailyHours',
  };

  function normalizeColumns() {
    (G.advanced.columns || []).forEach(col => {
      // Add field if missing, by mapping from name
      if (!col.field && col.name && NAME_TO_FIELD[col.name]) {
        col.field = NAME_TO_FIELD[col.name];
      }
      // Parse string widths to numbers
      if (typeof col.width === 'string') col.width = parseInt(col.width, 10) || 100;
    });
  }

  function loadData(raw) {
    try { G = JSON.parse(raw); } catch (e) { alert('Invalid .gantt file'); return; }
    if (!G.advanced) G.advanced = {};
    if (!G.advanced.columns) G.advanced.columns = JSON.parse(JSON.stringify(DEFAULT_COLUMNS));
    if (!G.resources) G.resources = [];
    if (!G.data) G.data = [];

    // Normalize existing columns: add field mapping and fix string widths
    normalizeColumns();

    // Remove deprecated columns (DailyHours)
    G.advanced.columns = G.advanced.columns.filter(c => c.field !== 'DailyHours');

    // Ensure all required columns exist
    DEFAULT_COLUMNS.forEach(dc => {
      if (!G.advanced.columns.find(c => c.field === dc.field)) {
        G.advanced.columns.push(JSON.parse(JSON.stringify(dc)));
      }
    });

    buildResColorMap();
    computeNextId();
    recalcAllDurations(); // Fix durations to inclusive counting + migrate hours
    saveToBrowser(); // Persist migrated data
    undoStack = []; redoStack = []; dirty = false;
    collapsed.clear(); selected.clear();
    emptyState.classList.add('hidden');
    appEl.classList.remove('hidden');
    fullRender();
    updateProjectNameLabel();
    requestAnimationFrame(() => scrollToToday());
  }

  // Recalculate all task durations from their dates (inclusive: 20→24 Jul = 5 days)
  // Also normalize all date strings to YYYY-MM-DD format
  function recalcAllDurations() {
    if (!G || !G.data) return;
    function walk(tasks) {
      tasks.forEach(t => {
        // Normalize dates to YYYY-MM-DD (strip any ISO time component)
        if (t.StartDate) t.StartDate = t.StartDate.slice(0, 10);
        if (t.EndDate) t.EndDate = t.EndDate.slice(0, 10);
        if (t.StartDate && t.EndDate) {
          const s = new Date(t.StartDate), e = new Date(t.EndDate);
          if (!isNaN(s) && !isNaN(e)) {
            t.Duration = Math.max(1, Math.round((e - s) / 86400000) + 1);
          }
        }
        // Migrate old DailyHours → AllocatedHours
        if (!t.AllocatedHours && t.AllocatedHours !== 0) {
          const dh = t.DailyHours || t['Daily Hours'];
          if (typeof dh === 'number' && dh > 0 && t.Duration) {
            t.AllocatedHours = dh * t.Duration;
          } else {
            t.AllocatedHours = 0;
          }
        }
        if (t.SpentHours == null) t.SpentHours = 0;
        if (t.subtasks && t.subtasks.length) walk(t.subtasks);
      });
    }
    walk(G.data);
  }

  function openNewProjectWizard() {
    $('wiz-name').value = '';
    $('wiz-start').value = todayISO();
    $('wiz-duration').value = '90';
    // Reset template selection
    $('template-grid').querySelectorAll('.template-card').forEach(c => c.classList.remove('active'));
    $('template-grid').querySelector('[data-tpl="blank"]').classList.add('active');
    $('wizard-backdrop').classList.remove('hidden');
    $('wiz-name').focus();
  }

  function setupWizard() {
    $('wizard-close').addEventListener('click', () => $('wizard-backdrop').classList.add('hidden'));
    $('wizard-cancel').addEventListener('click', () => $('wizard-backdrop').classList.add('hidden'));
    $('wizard-backdrop').addEventListener('click', e => { if (e.target === $('wizard-backdrop')) $('wizard-backdrop').classList.add('hidden'); });
    $('template-grid').addEventListener('click', e => {
      const card = e.target.closest('.template-card');
      if (!card) return;
      $('template-grid').querySelectorAll('.template-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
    });
    $('wizard-create').addEventListener('click', createProjectFromWizard);
  }

  function createProjectFromWizard() {
    const name = $('wiz-name').value.trim() || ('Project ' + new Date().toLocaleDateString());
    const start = $('wiz-start').value || todayISO();
    const totalDays = parseInt($('wiz-duration').value) || 90;
    const tpl = $('template-grid').querySelector('.template-card.active')?.dataset.tpl || 'blank';

    projectName = name;
    const data = generateTemplate(tpl, start, totalDays);

    G = {
      data,
      resources: [],
      projectStartDate: null, projectEndDate: null,
      advanced: { columns: JSON.parse(JSON.stringify(DEFAULT_COLUMNS)), zoomLevel: 0, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, timezoneOffset: new Date().getTimezoneOffset() * -1, dependencyConflict: 'Add Offset to Dependency', dateFormat: 'dd MMM yyyy', timeFormat: 'h a', firstDayOfWeek: 1, workWeek: ['Monday','Tuesday','Wednesday','Thursday','Friday'], workTime: [{from:9,to:17}], holidays: [] }
    };

    buildResColorMap();
    computeNextId();
    undoStack = []; redoStack = []; dirty = false;
    collapsed.clear(); selected.clear();
    emptyState.classList.add('hidden');
    appEl.classList.remove('hidden');
    $('wizard-backdrop').classList.add('hidden');
    fullRender();
    updateProjectNameLabel();
    saveToBrowser();
    showSaveToast();
  }

  function goToProjects() {
    // Auto-save current project before leaving
    if (G) {
      saveToBrowser();
    }
    // Hide app, show landing page
    appEl.classList.add('hidden');
    emptyState.classList.remove('hidden');
    renderSavedProjects();
    // Reset view tab to Gantt for next time
    curView = 'gantt';
    $('view-tabs').querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
    $('tab-gantt').classList.add('active');
    $('gantt-view').classList.remove('hidden');
    $('resources-view').classList.add('hidden');
    $('summary-view').classList.add('hidden');
  }

  let _tplId = 0;
  function tId() { return ++_tplId; }

  function generateTemplate(tpl, start, totalDays) {
    _tplId = 0;
    const COLORS = ['61','71','81','91','101'];
    const s = start;
    const seg = Math.floor(totalDays / 4); // Divide project into segments

    if (tpl === 'marketing') {
      return [
        mkPhase('Research & Strategy', s, seg, COLORS[0], [
          mkTask('Market Research', s, Math.floor(seg*0.5)),
          mkTask('Competitor Analysis', addDaysISO(s, Math.floor(seg*0.3)), Math.floor(seg*0.4)),
          mkTask('Define Target Audience', addDaysISO(s, Math.floor(seg*0.5)), Math.floor(seg*0.3)),
          mkTask('Set KPIs & Goals', addDaysISO(s, Math.floor(seg*0.7)), Math.floor(seg*0.3)),
        ]),
        mkPhase('Content Creation', addDaysISO(s, seg), seg, COLORS[1], [
          mkTask('Brand Messaging', addDaysISO(s, seg), Math.floor(seg*0.3)),
          mkTask('Visual Assets Design', addDaysISO(s, seg + Math.floor(seg*0.2)), Math.floor(seg*0.5)),
          mkTask('Copywriting', addDaysISO(s, seg + Math.floor(seg*0.1)), Math.floor(seg*0.4)),
          mkTask('Social Media Content', addDaysISO(s, seg + Math.floor(seg*0.3)), Math.floor(seg*0.5)),
          mkTask('Video Production', addDaysISO(s, seg + Math.floor(seg*0.4)), Math.floor(seg*0.5)),
        ]),
        mkPhase('Campaign Execution', addDaysISO(s, seg*2), seg, COLORS[2], [
          mkTask('Email Marketing Setup', addDaysISO(s, seg*2), Math.floor(seg*0.3)),
          mkTask('Social Media Launch', addDaysISO(s, seg*2 + Math.floor(seg*0.2)), Math.floor(seg*0.5)),
          mkTask('Paid Ads Campaign', addDaysISO(s, seg*2 + Math.floor(seg*0.3)), Math.floor(seg*0.5)),
          mkTask('PR & Outreach', addDaysISO(s, seg*2 + Math.floor(seg*0.2)), Math.floor(seg*0.4)),
        ]),
        mkPhase('Analysis & Optimization', addDaysISO(s, seg*3), seg, COLORS[3], [
          mkTask('Performance Tracking', addDaysISO(s, seg*3), Math.floor(seg*0.5)),
          mkTask('A/B Testing', addDaysISO(s, seg*3 + Math.floor(seg*0.2)), Math.floor(seg*0.4)),
          mkTask('Report Generation', addDaysISO(s, seg*3 + Math.floor(seg*0.5)), Math.floor(seg*0.3)),
          mkTask('Strategy Refinement', addDaysISO(s, seg*3 + Math.floor(seg*0.6)), Math.floor(seg*0.4)),
        ]),
      ];
    }
    if (tpl === 'software') {
      const sprint = Math.floor(totalDays / 5);
      return [
        mkPhase('Planning & Design', s, sprint, COLORS[0], [
          mkTask('Requirements Gathering', s, Math.floor(sprint*0.4)),
          mkTask('System Architecture', addDaysISO(s, Math.floor(sprint*0.3)), Math.floor(sprint*0.4)),
          mkTask('UI/UX Wireframes', addDaysISO(s, Math.floor(sprint*0.4)), Math.floor(sprint*0.5)),
          mkTask('Tech Stack Decision', addDaysISO(s, Math.floor(sprint*0.2)), Math.floor(sprint*0.3)),
        ]),
        mkPhase('Sprint 1 – Core Features', addDaysISO(s, sprint), sprint, COLORS[1], [
          mkTask('Database Setup', addDaysISO(s, sprint), Math.floor(sprint*0.3)),
          mkTask('Authentication', addDaysISO(s, sprint + Math.floor(sprint*0.2)), Math.floor(sprint*0.4)),
          mkTask('Core API Development', addDaysISO(s, sprint + Math.floor(sprint*0.3)), Math.floor(sprint*0.5)),
          mkTask('Frontend Foundation', addDaysISO(s, sprint + Math.floor(sprint*0.2)), Math.floor(sprint*0.6)),
        ]),
        mkPhase('Sprint 2 – Features', addDaysISO(s, sprint*2), sprint, COLORS[2], [
          mkTask('Feature Development', addDaysISO(s, sprint*2), Math.floor(sprint*0.7)),
          mkTask('Integration Testing', addDaysISO(s, sprint*2 + Math.floor(sprint*0.5)), Math.floor(sprint*0.4)),
          mkTask('Bug Fixes', addDaysISO(s, sprint*2 + Math.floor(sprint*0.6)), Math.floor(sprint*0.3)),
        ]),
        mkPhase('Testing & QA', addDaysISO(s, sprint*3), sprint, COLORS[3], [
          mkTask('Unit Testing', addDaysISO(s, sprint*3), Math.floor(sprint*0.4)),
          mkTask('Integration Testing', addDaysISO(s, sprint*3 + Math.floor(sprint*0.2)), Math.floor(sprint*0.4)),
          mkTask('UAT', addDaysISO(s, sprint*3 + Math.floor(sprint*0.4)), Math.floor(sprint*0.4)),
          mkTask('Performance Testing', addDaysISO(s, sprint*3 + Math.floor(sprint*0.5)), Math.floor(sprint*0.3)),
        ]),
        mkPhase('Deployment & Launch', addDaysISO(s, sprint*4), sprint, COLORS[4], [
          mkTask('Staging Deploy', addDaysISO(s, sprint*4), Math.floor(sprint*0.3)),
          mkTask('Documentation', addDaysISO(s, sprint*4 + Math.floor(sprint*0.1)), Math.floor(sprint*0.5)),
          mkTask('Production Deploy', addDaysISO(s, sprint*4 + Math.floor(sprint*0.5)), Math.floor(sprint*0.2)),
          mkTask('Post-Launch Monitoring', addDaysISO(s, sprint*4 + Math.floor(sprint*0.6)), Math.floor(sprint*0.4)),
        ]),
      ];
    }
    if (tpl === 'event') {
      return [
        mkPhase('Pre-Planning', s, seg, COLORS[0], [
          mkTask('Define Event Goals', s, Math.floor(seg*0.3)),
          mkTask('Budget Planning', addDaysISO(s, Math.floor(seg*0.2)), Math.floor(seg*0.4)),
          mkTask('Venue Research', addDaysISO(s, Math.floor(seg*0.3)), Math.floor(seg*0.5)),
          mkTask('Date Selection', addDaysISO(s, Math.floor(seg*0.5)), Math.floor(seg*0.2)),
        ]),
        mkPhase('Logistics & Vendors', addDaysISO(s, seg), seg, COLORS[1], [
          mkTask('Venue Booking', addDaysISO(s, seg), Math.floor(seg*0.3)),
          mkTask('Catering Arrangements', addDaysISO(s, seg + Math.floor(seg*0.2)), Math.floor(seg*0.4)),
          mkTask('AV Equipment', addDaysISO(s, seg + Math.floor(seg*0.3)), Math.floor(seg*0.3)),
          mkTask('Speaker Confirmations', addDaysISO(s, seg + Math.floor(seg*0.1)), Math.floor(seg*0.5)),
          mkTask('Transportation', addDaysISO(s, seg + Math.floor(seg*0.5)), Math.floor(seg*0.3)),
        ]),
        mkPhase('Promotion', addDaysISO(s, seg*2), seg, COLORS[2], [
          mkTask('Create Event Website', addDaysISO(s, seg*2), Math.floor(seg*0.4)),
          mkTask('Social Media Campaign', addDaysISO(s, seg*2 + Math.floor(seg*0.2)), Math.floor(seg*0.6)),
          mkTask('Email Invitations', addDaysISO(s, seg*2 + Math.floor(seg*0.3)), Math.floor(seg*0.3)),
          mkTask('PR & Media Outreach', addDaysISO(s, seg*2 + Math.floor(seg*0.4)), Math.floor(seg*0.4)),
        ]),
        mkPhase('Execution & Follow-Up', addDaysISO(s, seg*3), seg, COLORS[3], [
          mkTask('Final Rehearsal', addDaysISO(s, seg*3), Math.floor(seg*0.2)),
          mkTask('Event Day Coordination', addDaysISO(s, seg*3 + Math.floor(seg*0.2)), Math.floor(seg*0.1)),
          mkTask('Post-Event Survey', addDaysISO(s, seg*3 + Math.floor(seg*0.3)), Math.floor(seg*0.3)),
          mkTask('Debrief & Report', addDaysISO(s, seg*3 + Math.floor(seg*0.5)), Math.floor(seg*0.3)),
        ]),
      ];
    }
    if (tpl === 'product') {
      return [
        mkPhase('Discovery & Research', s, seg, COLORS[0], [
          mkTask('User Research', s, Math.floor(seg*0.5)),
          mkTask('Market Analysis', addDaysISO(s, Math.floor(seg*0.2)), Math.floor(seg*0.4)),
          mkTask('Feature Prioritization', addDaysISO(s, Math.floor(seg*0.5)), Math.floor(seg*0.3)),
          mkTask('Roadmap Creation', addDaysISO(s, Math.floor(seg*0.7)), Math.floor(seg*0.3)),
        ]),
        mkPhase('Design & Prototyping', addDaysISO(s, seg), seg, COLORS[1], [
          mkTask('UI Design', addDaysISO(s, seg), Math.floor(seg*0.5)),
          mkTask('Prototype Development', addDaysISO(s, seg + Math.floor(seg*0.3)), Math.floor(seg*0.5)),
          mkTask('User Testing', addDaysISO(s, seg + Math.floor(seg*0.6)), Math.floor(seg*0.3)),
          mkTask('Design Iteration', addDaysISO(s, seg + Math.floor(seg*0.7)), Math.floor(seg*0.3)),
        ]),
        mkPhase('Development', addDaysISO(s, seg*2), seg, COLORS[2], [
          mkTask('Core Development', addDaysISO(s, seg*2), Math.floor(seg*0.7)),
          mkTask('API Integration', addDaysISO(s, seg*2 + Math.floor(seg*0.3)), Math.floor(seg*0.4)),
          mkTask('QA & Bug Fixes', addDaysISO(s, seg*2 + Math.floor(seg*0.6)), Math.floor(seg*0.4)),
        ]),
        mkPhase('Launch', addDaysISO(s, seg*3), seg, COLORS[3], [
          mkTask('Marketing Materials', addDaysISO(s, seg*3), Math.floor(seg*0.4)),
          mkTask('Beta Launch', addDaysISO(s, seg*3 + Math.floor(seg*0.3)), Math.floor(seg*0.2)),
          mkTask('Public Launch', addDaysISO(s, seg*3 + Math.floor(seg*0.5)), Math.floor(seg*0.1)),
          mkTask('Post-Launch Support', addDaysISO(s, seg*3 + Math.floor(seg*0.5)), Math.floor(seg*0.5)),
        ]),
      ];
    }
    if (tpl === 'content') {
      return [
        mkPhase('Content Strategy', s, seg, COLORS[0], [
          mkTask('Content Audit', s, Math.floor(seg*0.4)),
          mkTask('Audience Personas', addDaysISO(s, Math.floor(seg*0.2)), Math.floor(seg*0.3)),
          mkTask('Content Pillars', addDaysISO(s, Math.floor(seg*0.4)), Math.floor(seg*0.3)),
          mkTask('Editorial Calendar', addDaysISO(s, Math.floor(seg*0.5)), Math.floor(seg*0.4)),
        ]),
        mkPhase('Blog & Articles', addDaysISO(s, seg), seg, COLORS[1], [
          mkTask('Topic Research', addDaysISO(s, seg), Math.floor(seg*0.3)),
          mkTask('Article Writing', addDaysISO(s, seg + Math.floor(seg*0.2)), Math.floor(seg*0.5)),
          mkTask('SEO Optimization', addDaysISO(s, seg + Math.floor(seg*0.5)), Math.floor(seg*0.3)),
          mkTask('Publishing', addDaysISO(s, seg + Math.floor(seg*0.7)), Math.floor(seg*0.3)),
        ]),
        mkPhase('Social Media', addDaysISO(s, seg*2), seg, COLORS[2], [
          mkTask('Platform Strategy', addDaysISO(s, seg*2), Math.floor(seg*0.3)),
          mkTask('Post Creation', addDaysISO(s, seg*2 + Math.floor(seg*0.2)), Math.floor(seg*0.5)),
          mkTask('Scheduling', addDaysISO(s, seg*2 + Math.floor(seg*0.5)), Math.floor(seg*0.3)),
          mkTask('Engagement Monitoring', addDaysISO(s, seg*2 + Math.floor(seg*0.5)), Math.floor(seg*0.5)),
        ]),
        mkPhase('Analytics & Reporting', addDaysISO(s, seg*3), seg, COLORS[3], [
          mkTask('Data Collection', addDaysISO(s, seg*3), Math.floor(seg*0.4)),
          mkTask('Performance Analysis', addDaysISO(s, seg*3 + Math.floor(seg*0.3)), Math.floor(seg*0.4)),
          mkTask('Monthly Report', addDaysISO(s, seg*3 + Math.floor(seg*0.6)), Math.floor(seg*0.3)),
          mkTask('Strategy Adjustment', addDaysISO(s, seg*3 + Math.floor(seg*0.7)), Math.floor(seg*0.3)),
        ]),
      ];
    }
    // Blank template
    return [
      mkPhase('Phase 1', s, Math.floor(totalDays * 0.3), COLORS[0], [
        mkTask('Task 1', s, 5),
      ]),
    ];
  }

  function mkPhase(name, start, days, color, subtasks) {
    days = Math.max(1, days);
    return {
      TaskID: tId(), TaskName: name, StartDate: start, EndDate: addDaysISO(start, days),
      Duration: days, Predecessor: null, resources: [], Progress: 0, color,
      info: '', DurationUnit: 'day', AllocatedHours: 0, SpentHours: 0,
      subtasks: subtasks || []
    };
  }

  function mkTask(name, start, days) {
    days = Math.max(1, days);
    return {
      TaskID: tId(), TaskName: name, StartDate: start, EndDate: addDaysISO(start, days),
      Duration: days, Progress: 0, color: '', Predecessor: '', resources: [],
      info: '', DurationUnit: 'day', AllocatedHours: 0, SpentHours: 0
    };
  }

  function saveFile() {
    if (!G) return;
    saveToBrowser();
    showSaveToast();
  }

  function saveAsFile() {
    if (!G) return;
    const name = prompt('Save as:', projectName + '.gantt');
    if (!name) return;
    const blob = new Blob([JSON.stringify(G)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name.endsWith('.gantt') ? name : name + '.gantt';
    a.click();
    URL.revokeObjectURL(a.href);
    dirty = false;
    updateProjectNameLabel();
  }

  // ═══════════════════════════════════════
  // BROWSER STORAGE
  // ═══════════════════════════════════════
  function getSavedProjects() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch (_) { return {}; }
  }

  function saveToBrowser() {
    if (!G) return;
    const saved = getSavedProjects();
    const jsonStr = JSON.stringify(G);
    saved[projectName] = jsonStr;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      localStorage.setItem('gantt_last_project', projectName);
    } catch (e) {
      console.warn('localStorage full, could not save');
    }
    dirty = false;
    updateProjectNameLabel();
    // Cloud sync
    if (typeof SupabaseStore !== 'undefined' && SupabaseStore.isReady()) {
      SupabaseStore.debouncedSave(projectName, G, cloudProjectId);
    }
  }

  function loadFromBrowser(name) {
    const saved = getSavedProjects();
    if (saved[name]) {
      projectName = name;
      cloudProjectId = null;
      loadData(saved[name]);
      // Also try to find cloud ID for this project
      if (typeof SupabaseStore !== 'undefined' && SupabaseStore.isReady()) {
        SupabaseStore.loadProjectByName(name).then(p => {
          if (p) cloudProjectId = p.id;
        });
      }
      return;
    }
  }

  async function loadFromCloud(id, name) {
    if (typeof SupabaseStore === 'undefined' || !SupabaseStore.isReady()) return;
    const p = await SupabaseStore.loadProject(id);
    if (p && p.data) {
      projectName = p.name;
      cloudProjectId = p.id;
      loadData(JSON.stringify(p.data));
    }
  }

  function deleteSavedProject(name, cloudId) {
    if (!confirm('Delete "' + name + '"?')) return;
    const saved = getSavedProjects();
    delete saved[name];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    if (localStorage.getItem('gantt_last_project') === name) {
      localStorage.removeItem('gantt_last_project');
    }
    // Also delete from cloud
    if (cloudId && typeof SupabaseStore !== 'undefined' && SupabaseStore.isReady()) {
      SupabaseStore.deleteProject(cloudId);
    }
    renderSavedProjects();
  }

  async function renderSavedProjects() {
    const list = $('saved-projects-list');
    const section = $('saved-projects-section');
    if (!list || !section) return;

    // Collect local projects
    const saved = getSavedProjects();
    const localNames = Object.keys(saved);

    // Collect cloud projects
    let cloudProjects = [];
    if (typeof SupabaseStore !== 'undefined' && SupabaseStore.isReady()) {
      cloudProjects = await SupabaseStore.listProjects();
    }

    // Merge: cloud projects take priority, add local-only projects too
    const merged = new Map(); // name → { name, source, cloudId, localData, cloudUpdated }
    cloudProjects.forEach(cp => {
      merged.set(cp.name, { name: cp.name, source: 'cloud', cloudId: cp.id, cloudUpdated: cp.updated_at });
    });
    localNames.forEach(name => {
      if (merged.has(name)) {
        merged.get(name).source = 'both';
        merged.get(name).localData = saved[name];
      } else {
        merged.set(name, { name, source: 'local', localData: saved[name] });
      }
    });

    const entries = Array.from(merged.values());
    if (!entries.length) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');
    list.innerHTML = '';

    entries.forEach(entry => {
      let phaseCount = 0, taskCount = 0, dateRange = '';
      if (entry.localData) {
        try {
          const d = JSON.parse(entry.localData);
          phaseCount = (d.data || []).length;
          function countTasks(tasks) { tasks.forEach(t => { taskCount++; if (t.subtasks && t.subtasks.length) countTasks(t.subtasks); }); }
          (d.data || []).forEach(p => { if (p.subtasks) countTasks(p.subtasks); });
          if (d.data && d.data.length) {
            const s = d.data[0].StartDate, e = d.data[d.data.length - 1].EndDate;
            if (s && e) dateRange = fmtDate(new Date(s)) + ' → ' + fmtDate(new Date(e));
          }
        } catch (_) {}
      }

      const cloudIcon = entry.source === 'local' ? '' :
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" style="margin-left:4px;vertical-align:middle"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>';
      const timeAgo = entry.cloudUpdated ? ' · ' + getTimeAgo(new Date(entry.cloudUpdated)) : '';

      const card = document.createElement('div');
      card.className = 'saved-project-card';
      card.innerHTML =
        '<div class="sp-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>' +
        '<div class="sp-info"><h4>' + entry.name + cloudIcon + '</h4><p>' + (phaseCount ? phaseCount + ' phases · ' + taskCount + ' tasks' : 'Cloud project') + (dateRange ? ' · ' + dateRange : '') + timeAgo + '</p></div>' +
        '<div class="sp-actions"><button class="sp-delete" title="Delete project">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
        '</button></div>';
      card.querySelector('.sp-delete').addEventListener('click', e => {
        e.stopPropagation();
        deleteSavedProject(entry.name, entry.cloudId);
      });
      card.addEventListener('click', () => {
        if (entry.source === 'cloud' && !entry.localData) {
          loadFromCloud(entry.cloudId, entry.name);
        } else {
          loadFromBrowser(entry.name);
        }
      });
      list.appendChild(card);
    });
  }

  function getTimeAgo(date) {
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    return days + 'd ago';
  }

  function updateProjectNameLabel() {
    const el = $('project-name');
    if (!el) return;
    el.textContent = projectName;
    el.classList.toggle('unsaved', dirty);
  }

  function showSaveToast() {
    const t = $('save-toast');
    if (!t) return;
    t.textContent = '\u2713 "' + projectName + '" saved';
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2000);
  }

  // Auto-save debounce
  let autoSaveTimer = null;
  function scheduleAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => { if (G && dirty) saveToBrowser(); }, 3000);
  }

  // ═══════════════════════════════════════
  // UNDO / REDO
  // ═══════════════════════════════════════
  function pushUndo() {
    undoStack.push(JSON.stringify(G));
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
    dirty = true;
    updateUndoButtons();
    updateProjectNameLabel();
    scheduleAutoSave();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(G));
    G = JSON.parse(undoStack.pop());
    buildResColorMap(); computeNextId();
    fullRender(); updateUndoButtons();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(G));
    G = JSON.parse(redoStack.pop());
    buildResColorMap(); computeNextId();
    fullRender(); updateUndoButtons();
  }

  function updateUndoButtons() {
    $('tb-undo').disabled = !undoStack.length;
    $('tb-redo').disabled = !redoStack.length;
  }

  // ═══════════════════════════════════════
  // DATA HELPERS
  // ═══════════════════════════════════════
  function buildResColorMap() {
    resColorMap = {};
    (G.resources || []).forEach((r, i) => resColorMap[r.resourceId] = RES_COLORS[i % RES_COLORS.length]);
  }

  function computeNextId() {
    nextTaskId = 1;
    G.data.forEach(p => {
      if (p.TaskID >= nextTaskId) nextTaskId = p.TaskID + 1;
      (p.subtasks || []).forEach(t => { if (t.TaskID >= nextTaskId) nextTaskId = t.TaskID + 1; });
    });
  }

  function getColumns() {
    return (G && G.advanced && G.advanced.columns) ? G.advanced.columns : DEFAULT_COLUMNS;
  }

  function visibleColumns() { return getColumns().filter(c => c.show !== false); }

  function buildFlat() {
    flat = [];
    let minD = Infinity, maxD = -Infinity;
    function walk(tasks, depth, phaseIdx) {
      tasks.forEach(t => {
        const s = new Date(t.StartDate), e = new Date(t.EndDate);
        if (s < minD) minD = s; if (e > maxD) maxD = e;
        const hasSubs = t.subtasks && t.subtasks.length > 0;
        flat.push({ ref: t, isPhase: depth === 0, phaseIdx, depth, hasChildren: hasSubs });
        if (hasSubs && !collapsed.has(t.TaskID)) {
          walk(t.subtasks, depth + 1, phaseIdx);
        }
      });
    }
    G.data.forEach((phase, pi) => walk([phase], 0, pi));
    // Also walk top-level if phase has subtasks already counted
    pStart = new Date(minD === Infinity ? Date.now() : minD);
    pStart.setDate(pStart.getDate() - 3);
    pEnd = new Date(maxD === -Infinity ? Date.now() : maxD);
    pEnd.setDate(pEnd.getDate() + 5);
    totalDays = Math.max(1, Math.ceil((pEnd - pStart) / 864e5));
  }

  function findTaskById(id) {
    function search(tasks, parent) {
      for (const t of tasks) {
        if (t.TaskID === id) return { ref: t, isPhase: parent === null, parent };
        if (t.subtasks && t.subtasks.length) {
          const found = search(t.subtasks, t);
          if (found) return found;
        }
      }
      return null;
    }
    return search(G.data, null);
  }

  function recalcPhase(phase) {
    if (!phase.subtasks || !phase.subtasks.length) return;
    let mn = Infinity, mx = -Infinity;
    function walk(tasks) {
      tasks.forEach(t => {
        const s = new Date(t.StartDate).getTime(), e = new Date(t.EndDate).getTime();
        if (s < mn) mn = s;
        if (e > mx) mx = e;
        if (t.subtasks && t.subtasks.length) walk(t.subtasks);
      });
    }
    walk(phase.subtasks);
    if (mn !== Infinity) {
      phase.StartDate = toDateInputVal(new Date(mn));
      phase.EndDate = toDateInputVal(new Date(mx));
    }
    phase.Duration = Math.max(1, Math.round((mx - mn) / 86400000) + 1);
  }

  // ═══════════════════════════════════════
  // TASK CRUD
  // ═══════════════════════════════════════
  function addTask() {
    pushUndo();
    const id = nextTaskId++;
    const now = todayISO();
    const task = { TaskID: id, TaskName: 'New Task', StartDate: now, EndDate: addDaysISO(now, 3), Duration: 3, Progress: 0, color: '', Predecessor: '', resources: [], info: '', DurationUnit: 'day', AllocatedHours: 0, SpentHours: 0 };

    if (!G.data.length) {
      // Create a new phase with this task
      const phaseId = nextTaskId++;
      G.data.push({ TaskID: phaseId, TaskName: 'Phase 1', StartDate: now, EndDate: addDaysISO(now, 3), Duration: 3, Predecessor: null, resources: [], Progress: 0, color: '61', info: '', DurationUnit: 'day', subtasks: [task], AllocatedHours: 0, SpentHours: 0 });
    } else if (lastSelectedId) {
      const found = findTaskById(lastSelectedId);
      if (found) {
        if (found.isPhase) {
          // Add as subtask of selected phase
          found.ref.subtasks = found.ref.subtasks || [];
          found.ref.subtasks.push(task);
          recalcPhase(found.ref);
          collapsed.delete(G.data.indexOf(found.ref));
        } else {
          // Add after selected task in same phase
          const idx = found.parent.subtasks.indexOf(found.ref);
          found.parent.subtasks.splice(idx + 1, 0, task);
          recalcPhase(found.parent);
        }
      }
    } else {
      // Add to last phase
      const lastPhase = G.data[G.data.length - 1];
      lastPhase.subtasks = lastPhase.subtasks || [];
      lastPhase.subtasks.push(task);
      recalcPhase(lastPhase);
    }
    selected.clear(); selected.add(id); lastSelectedId = id;
    fullRender();
  }

  function addSubtask() {
    if (!lastSelectedId) { addTask(); return; }
    pushUndo();
    const found = findTaskById(lastSelectedId);
    if (!found) return;
    const id = nextTaskId++;
    const now = todayISO();
    const task = { TaskID: id, TaskName: 'New Subtask', StartDate: now, EndDate: addDaysISO(now, 2), Duration: 2, Progress: 0, color: '', Predecessor: '', resources: [], info: '', DurationUnit: 'day', AllocatedHours: 0, SpentHours: 0 };

    if (found.isPhase) {
      found.ref.subtasks = found.ref.subtasks || [];
      found.ref.subtasks.push(task);
      recalcPhase(found.ref);
      collapsed.delete(found.phaseIdx || G.data.indexOf(found.ref));
    } else {
      // Convert the selected task into a "phase" by keeping it a subtask but adding a sibling
      found.parent.subtasks = found.parent.subtasks || [];
      const idx = found.parent.subtasks.indexOf(found.ref);
      found.parent.subtasks.splice(idx + 1, 0, task);
      recalcPhase(found.parent);
    }
    selected.clear(); selected.add(id); lastSelectedId = id;
    fullRender();
  }

  function deleteSelected() {
    if (!selected.size) return;
    pushUndo();
    selected.forEach(tid => {
      for (let pi = G.data.length - 1; pi >= 0; pi--) {
        const phase = G.data[pi];
        if (phase.TaskID === tid) { G.data.splice(pi, 1); continue; }
        if (phase.subtasks) {
          phase.subtasks = phase.subtasks.filter(t => t.TaskID !== tid);
          if (!phase.subtasks.length) G.data.splice(pi, 1);
          else recalcPhase(phase);
        }
      }
    });
    selected.clear(); lastSelectedId = null;
    fullRender();
  }

  function duplicateTask() {
    if (!lastSelectedId) return;
    pushUndo();
    const found = findTaskById(lastSelectedId);
    if (!found) return;
    const clone = JSON.parse(JSON.stringify(found.ref));
    clone.TaskID = nextTaskId++;
    clone.TaskName += ' (copy)';
    if (found.isPhase) {
      // Clone subtasks with new IDs
      (clone.subtasks || []).forEach(t => t.TaskID = nextTaskId++);
      const idx = G.data.indexOf(found.ref);
      G.data.splice(idx + 1, 0, clone);
    } else {
      const idx = found.parent.subtasks.indexOf(found.ref);
      found.parent.subtasks.splice(idx + 1, 0, clone);
      recalcPhase(found.parent);
    }
    selected.clear(); selected.add(clone.TaskID); lastSelectedId = clone.TaskID;
    fullRender();
  }

  function indentTask() {
    if (!lastSelectedId) return;
    const found = findTaskById(lastSelectedId);
    if (!found || found.isPhase) return;
    // Find the phase and the index of this task
    const phase = found.parent;
    const idx = phase.subtasks.indexOf(found.ref);
    if (idx <= 0) return; // Can't indent the first subtask (no previous sibling to become parent)
    // Not applicable in flat model - indent moves it into a new or existing phase
    // In OnlineGantt's model, "indent" makes the task a subtask of the previous phase
    // Check if there's a previous phase in G.data
    const phaseIdx = G.data.indexOf(phase);
    if (phaseIdx <= 0) return;
    pushUndo();
    const prevPhase = G.data[phaseIdx - 1];
    // Move task from current phase to previous phase
    phase.subtasks.splice(idx, 1);
    prevPhase.subtasks = prevPhase.subtasks || [];
    prevPhase.subtasks.push(found.ref);
    recalcPhase(prevPhase);
    if (!phase.subtasks.length) G.data.splice(phaseIdx, 1);
    else recalcPhase(phase);
    fullRender();
  }

  function outdentTask() {
    if (!lastSelectedId) return;
    const found = findTaskById(lastSelectedId);
    if (!found) return;
    if (found.isPhase) return; // Already top-level phase
    pushUndo();
    const phase = found.parent;
    const idx = phase.subtasks.indexOf(found.ref);
    // Remove from current phase
    phase.subtasks.splice(idx, 1);
    // Create a new phase from this task
    const phaseIdx = G.data.indexOf(phase);
    const newPhase = {
      TaskID: found.ref.TaskID, TaskName: found.ref.TaskName,
      StartDate: found.ref.StartDate, EndDate: found.ref.EndDate,
      Duration: found.ref.Duration, Predecessor: null, resources: [],
      Progress: found.ref.Progress, color: found.ref.color || '61',
      info: '', DurationUnit: 'day', subtasks: [], AllocatedHours: 0, SpentHours: 0
    };
    // Move remaining tasks after this idx into the new phase as subtasks
    const remaining = phase.subtasks.splice(idx);
    newPhase.subtasks = remaining;
    // The original task becomes a phase header - give it a new subtask representation
    if (newPhase.subtasks.length === 0) {
      // Make it a phase with itself as only subtask
      const sub = JSON.parse(JSON.stringify(found.ref));
      sub.TaskID = nextTaskId++;
      newPhase.subtasks = [sub];
    }
    G.data.splice(phaseIdx + 1, 0, newPhase);
    if (!phase.subtasks.length) G.data.splice(phaseIdx, 1);
    else recalcPhase(phase);
    recalcPhase(newPhase);
    fullRender();
  }

  // ═══════════════════════════════════════
  // RENDERING
  // ═══════════════════════════════════════
  function fullRender() {
    recalcPhaseDates();
    buildFlat();
    updateTableWidth();
    renderTableHeader();
    renderTableBody();
    renderTimeline();
    updateZoomLabel();
  }

  // Auto-compute parent dates from children (recursive, bottom-up)
  function recalcPhaseDates() {
    function recalc(tasks) {
      tasks.forEach(t => {
        if (t.subtasks && t.subtasks.length) {
          // Recurse into children first (bottom-up)
          recalc(t.subtasks);
          let minStart = Infinity, maxEnd = -Infinity;
          t.subtasks.forEach(sub => {
            const s = new Date(sub.StartDate).getTime();
            const e = new Date(sub.EndDate).getTime();
            if (s < minStart) minStart = s;
            if (e > maxEnd) maxEnd = e;
          });
          if (minStart !== Infinity) {
            const sd = new Date(minStart);
            const ed = new Date(maxEnd);
            t.StartDate = toDateInputVal(sd);
            t.EndDate = toDateInputVal(ed);
            t.Duration = Math.max(1, Math.round((maxEnd - minStart) / 86400000) + 1);
          }
        }
      });
    }
    if (G && G.data) recalc(G.data);
  }

  function updateTableWidth() {
    const cols = visibleColumns();
    const totalW = cols.reduce((s, c) => s + (c.width || 100), 0);
    tableEl.style.width = Math.max(300, totalW + 10) + 'px';
  }

  // --- Table Header ---
  function renderTableHeader() {
    const cols = visibleColumns();
    tableHeader.innerHTML = '';
    cols.forEach((col, ci) => {
      const th = document.createElement('div');
      th.className = 'th-cell';
      const cw = col.width || 100;
      th.style.width = cw + 'px';
      th.style.minWidth = cw + 'px';
      th.style.flexShrink = '0';
      th.textContent = col.name;

      // Column resizer
      const resizer = document.createElement('div');
      resizer.className = 'th-resizer';
      resizer.addEventListener('mousedown', e => startColResize(e, col, ci));
      th.appendChild(resizer);
      tableHeader.appendChild(th);
    });
  }

  // --- Table Body ---
  function renderTableBody() {
    tableBody.innerHTML = '';
    const cols = visibleColumns();
    flat.forEach((item, ri) => {
      const task = item.ref;
      const row = document.createElement('div');
      row.className = 'task-row' + (item.isPhase ? ' phase-row' : '') + (selected.has(task.TaskID) ? ' selected' : '');
      row.dataset.taskId = task.TaskID;
      row.dataset.ri = ri;

      // Drag handle – only enable drag when grabbing the handle
      const handle = document.createElement('div');
      handle.className = 'drag-handle';
      handle.innerHTML = '<svg width="10" height="14" viewBox="0 0 10 14"><circle cx="3" cy="3" r="1.2" fill="currentColor"/><circle cx="7" cy="3" r="1.2" fill="currentColor"/><circle cx="3" cy="7" r="1.2" fill="currentColor"/><circle cx="7" cy="7" r="1.2" fill="currentColor"/><circle cx="3" cy="11" r="1.2" fill="currentColor"/><circle cx="7" cy="11" r="1.2" fill="currentColor"/></svg>';
      handle.addEventListener('mousedown', () => { row.draggable = true; });
      row.addEventListener('dragend', () => { row.draggable = false; });
      row.appendChild(handle);

      cols.forEach(col => {
        const td = document.createElement('div');
        td.className = 'td-cell';
        const cw = col.width || 100;
        td.style.width = cw + 'px';
        td.style.minWidth = cw + 'px';
        td.style.flexShrink = '0';

        if (col.field === 'TaskName') {
          td.classList.add('td-name');
          // Indentation based on depth
          if (item.depth > 0) {
            const spacer = document.createElement('span');
            spacer.className = 'indent-spacer';
            spacer.style.width = (item.depth * 20) + 'px';
            td.appendChild(spacer);
          }
          // Collapse button for any task with children
          if (item.hasChildren) {
            const btn = document.createElement('button');
            btn.className = 'collapse-btn' + (collapsed.has(task.TaskID) ? ' collapsed' : '');
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';
            btn.addEventListener('click', e => { e.stopPropagation(); toggleCollapse(task.TaskID); });
            td.appendChild(btn);
          } else if (item.depth === 0) {
            // Top-level without children, still add space for alignment
            const spacer = document.createElement('span');
            spacer.className = 'indent-spacer';
            spacer.style.width = '20px';
            td.appendChild(spacer);
          } else {
            const spacer = document.createElement('span');
            spacer.className = 'indent-spacer';
            spacer.style.width = '18px';
            td.appendChild(spacer);
          }
          // Phase color dot only for top-level
          if (item.isPhase) {
            const dot = document.createElement('span');
            dot.className = 'phase-dot';
            dot.style.background = COLOR_MAP[task.color] || '#6366f1';
            td.appendChild(dot);
          }
          const txt = document.createElement('span');
          txt.className = 'task-name-text';
          txt.textContent = task.TaskName;
          txt.title = task.TaskName;
          td.appendChild(txt);
          // Pencil edit button inside task name cell
          const editBtn = document.createElement('button');
          editBtn.className = 'row-edit-btn';
          editBtn.title = 'Edit task';
          editBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>';
          editBtn.addEventListener('click', e => { e.stopPropagation(); openTaskEdit(task.TaskID); });
          td.appendChild(editBtn);
        } else if (col.field === 'TaskID') {
          td.textContent = task.TaskID;
          td.title = 'ID: ' + task.TaskID;
          td.style.color = '#9ca3af'; td.style.fontSize = '11px';
        } else if (col.field === 'StartDate' || col.field === 'EndDate') {
          const dateStr = fmtDate(new Date(task[col.field]));
          td.textContent = dateStr;
          td.title = dateStr;
          td.style.fontSize = '11.5px'; td.style.color = '#4b5563';
        } else if (col.field === 'Duration') {
          const d = task.Duration || 0;
          td.textContent = d + (d === 1 ? ' day' : ' days');
          td.title = d + (d === 1 ? ' day' : ' days');
          td.style.fontSize = '11.5px'; td.style.color = '#4b5563';
        } else if (col.field === 'AllocatedHours') {
          const ah = getHours(task, 'AllocatedHours', item.isPhase);
          td.textContent = ah > 0 ? ah + 'h' : '—';
          td.title = ah > 0 ? ah + ' hours allocated' : 'No hours allocated';
          td.style.fontSize = '11.5px'; td.style.color = ah > 0 ? '#4b5563' : '#9ca3af';
        } else if (col.field === 'SpentHours') {
          const sh = getHours(task, 'SpentHours', item.isPhase);
          const ah = getHours(task, 'AllocatedHours', item.isPhase);
          td.textContent = sh > 0 ? sh + 'h' : '—';
          if (ah > 0 && sh > 0) {
            const rem = ah - sh;
            td.title = sh + 'h spent / ' + ah + 'h allocated (' + (rem >= 0 ? rem + 'h remaining' : Math.abs(rem) + 'h over') + ')';
            td.style.color = sh > ah ? '#dc2626' : '#16a34a';
          } else {
            td.title = sh > 0 ? sh + ' hours spent' : 'No hours logged';
            td.style.color = '#9ca3af';
          }
          td.style.fontSize = '11.5px';
        } else if (col.field === 'RemainingHours') {
          const ah = getHours(task, 'AllocatedHours', item.isPhase);
          const sh = getHours(task, 'SpentHours', item.isPhase);
          const rem = ah - sh;
          if (ah > 0) {
            td.textContent = (rem >= 0 ? rem : rem) + 'h';
            td.style.color = rem > 0 ? '#ea580c' : (rem === 0 ? '#16a34a' : '#dc2626');
            td.style.fontWeight = '600';
            td.title = rem > 0 ? rem + 'h remaining' : (rem === 0 ? 'Fully utilized' : Math.abs(rem) + 'h over budget');
          } else {
            td.textContent = '—';
            td.style.color = '#9ca3af';
            td.title = 'No hours allocated';
          }
          td.style.fontSize = '11.5px';
        } else if (col.field === 'Progress') {
          const pct = task.Progress || 0;
          td.innerHTML = `<div class="progress-bar-cell"><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><span class="progress-text">${pct}%</span></div>`;
        } else if (col.field === 'Predecessor') {
          td.textContent = task.Predecessor || '—';
          td.title = task.Predecessor ? 'Depends on task ' + task.Predecessor : 'No dependency';
          td.style.fontSize = '11.5px'; td.style.color = '#4b5563';
        } else if (col.field === 'resources') {
          const res = task.resources || [];
          if (res.length > 0) {
            const wrapper = document.createElement('div');
            wrapper.style.display = 'flex'; wrapper.style.gap = '4px'; wrapper.style.alignItems = 'center'; wrapper.style.flexWrap = 'wrap'; wrapper.style.overflow = 'hidden';
            res.forEach(r => {
              const b = document.createElement('span');
              b.className = 'res-badge';
              b.style.background = resColorMap[r.resourceId] || RES_COLORS[0];
              b.textContent = r.resourceName;
              b.title = r.resourceName;
              wrapper.appendChild(b);
            });
            td.appendChild(wrapper);
          }
          td.style.cursor = 'pointer';
          td.addEventListener('click', e => { e.stopPropagation(); openResPicker(e, task); });
        } else if (col.field === 'color') {
          td.classList.add('td-color');
          const sw = document.createElement('div');
          sw.className = 'color-swatch' + (task.color ? '' : ' empty');
          sw.style.background = COLOR_MAP[task.color] || '';
          td.appendChild(sw);
          td.addEventListener('click', e => { e.stopPropagation(); openColorPicker(e, task); });
        } else {
          // Custom / unknown column
          const val = task[col.field];
          const displayVal = val != null && val !== '' ? val : '—';
          td.textContent = displayVal;
          td.title = String(displayVal);
          td.style.fontSize = '11.5px'; td.style.color = '#4b5563';
        }
        row.appendChild(td);
      });

      // Row events
      row.addEventListener('click', e => {
        if (e.target.closest('.collapse-btn') || e.target.closest('.color-swatch') || e.target.closest('.res-badge') || e.target.closest('.row-edit-btn')) return;
        selectRow(task.TaskID, e);
      });
      row.addEventListener('contextmenu', e => { e.preventDefault(); selectRow(task.TaskID, e); showCtxMenu(e); });
      row.addEventListener('mouseenter', () => highlightRow(ri, true));
      row.addEventListener('mouseleave', () => highlightRow(ri, false));
      setupRowDrag(row, task.TaskID);

      tableBody.appendChild(row);
    });
  }

  // ═══════════════════════════════════════
  // ROW DRAG-AND-DROP
  // ═══════════════════════════════════════
  let dragSrcId = null;

  function setupRowDrag(row, taskId) {
    row.addEventListener('dragstart', e => {
      dragSrcId = taskId;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', taskId);
    });
    row.addEventListener('dragend', () => {
      dragSrcId = null;
      row.draggable = false;
      row.classList.remove('dragging');
      tableBody.querySelectorAll('.drag-over-top,.drag-over-bottom,.drag-over-into').forEach(r =>
        r.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-into'));
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (parseInt(row.dataset.taskId) === dragSrcId) return;
      const rect = row.getBoundingClientRect();
      const y = e.clientY - rect.top;
      row.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-into');
      if (y > rect.height * 0.25 && y < rect.height * 0.75) {
        row.classList.add('drag-over-into'); // Drop into (make subtask)
      } else if (y < rect.height / 2) {
        row.classList.add('drag-over-top');
      } else {
        row.classList.add('drag-over-bottom');
      }
    });
    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-into');
    });
    row.addEventListener('drop', e => {
      e.preventDefault();
      const targetId = parseInt(row.dataset.taskId);
      if (targetId === dragSrcId || dragSrcId == null) return;
      const rect = row.getBoundingClientRect();
      const y = e.clientY - rect.top;
      let dropMode = 'after';
      if (y > rect.height * 0.25 && y < rect.height * 0.75) {
        dropMode = 'into';
      } else if (y < rect.height / 2) {
        dropMode = 'before';
      }
      performDrop(dragSrcId, targetId, dropMode);
      row.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-into');
    });
  }

  function performDrop(srcId, targetId, mode) {
    const src = findTaskById(srcId);
    const tgt = findTaskById(targetId);
    if (!src || !tgt) return;
    // Prevent dropping a task into its own descendant
    if (isDescendant(src.ref, tgt.ref)) return;
    pushUndo();

    // Remove source from its current position
    removeTask(src);

    if (mode === 'into') {
      // Make source a subtask of target
      if (!tgt.ref.subtasks) tgt.ref.subtasks = [];
      tgt.ref.subtasks.push(src.ref);
    } else {
      // before/after: insert as sibling of target
      if (tgt.parent === null) {
        // Target is top-level
        const tgtIdx = G.data.indexOf(tgt.ref);
        G.data.splice(mode === 'before' ? tgtIdx : tgtIdx + 1, 0, src.ref);
      } else {
        const tgtSubs = tgt.parent.subtasks;
        const tgtIdx = tgtSubs.indexOf(tgt.ref);
        tgtSubs.splice(mode === 'before' ? tgtIdx : tgtIdx + 1, 0, src.ref);
      }
    }
    fullRender();
  }

  function removeTask(info) {
    if (info.parent === null) {
      const idx = G.data.indexOf(info.ref);
      if (idx > -1) G.data.splice(idx, 1);
    } else {
      const subs = info.parent.subtasks || [];
      const idx = subs.indexOf(info.ref);
      if (idx > -1) subs.splice(idx, 1);
    }
  }

  function isDescendant(ancestor, node) {
    // Check if node is inside ancestor's subtask tree
    if (!ancestor.subtasks) return false;
    for (const child of ancestor.subtasks) {
      if (child === node) return true;
      if (isDescendant(child, node)) return true;
    }
    return false;
  }

  function moveTaskUp() {
    const id = getFirstSelectedId();
    if (id == null) return;
    const info = findTaskById(id);
    if (!info) return;
    pushUndo();
    if (info.isPhase) {
      const idx = G.data.indexOf(info.ref);
      if (idx <= 0) return;
      G.data.splice(idx, 1);
      G.data.splice(idx - 1, 0, info.ref);
    } else {
      const subs = info.parent.subtasks || [];
      const idx = subs.indexOf(info.ref);
      if (idx <= 0) {
        // Move to previous phase
        const pi = G.data.indexOf(info.parent);
        if (pi <= 0) return;
        subs.splice(idx, 1);
        const prev = G.data[pi - 1];
        if (!prev.subtasks) prev.subtasks = [];
        prev.subtasks.push(info.ref);
      } else {
        subs.splice(idx, 1);
        subs.splice(idx - 1, 0, info.ref);
      }
    }
    fullRender();
  }

  function moveTaskDown() {
    const id = getFirstSelectedId();
    if (id == null) return;
    const info = findTaskById(id);
    if (!info) return;
    pushUndo();
    if (info.isPhase) {
      const idx = G.data.indexOf(info.ref);
      if (idx >= G.data.length - 1) return;
      G.data.splice(idx, 1);
      G.data.splice(idx + 1, 0, info.ref);
    } else {
      const subs = info.parent.subtasks || [];
      const idx = subs.indexOf(info.ref);
      if (idx >= subs.length - 1) {
        // Move to next phase
        const pi = G.data.indexOf(info.parent);
        if (pi >= G.data.length - 1) return;
        subs.splice(idx, 1);
        const next = G.data[pi + 1];
        if (!next.subtasks) next.subtasks = [];
        next.subtasks.unshift(info.ref);
      } else {
        subs.splice(idx, 1);
        subs.splice(idx + 1, 0, info.ref);
      }
    }
    fullRender();
  }

  function moveTaskToPhase(phaseIdx) {
    const id = getFirstSelectedId();
    if (id == null) return;
    const info = findTaskById(id);
    if (!info || info.isPhase) return;
    const targetPhase = G.data[phaseIdx];
    if (targetPhase === info.parent) return; // Already in this phase
    pushUndo();
    // Remove from current phase
    const subs = info.parent.subtasks || [];
    const idx = subs.indexOf(info.ref);
    if (idx > -1) subs.splice(idx, 1);
    // Add to target phase
    if (!targetPhase.subtasks) targetPhase.subtasks = [];
    targetPhase.subtasks.push(info.ref);
    fullRender();
  }

  function getFirstSelectedId() {
    if (!selected.size) return null;
    return selected.values().next().value;
  }

  // --- Timeline ---
  function renderTimeline() {
    renderTLHeader();
    renderTLBars();
  }

  function renderTLHeader() {
    const tw = totalDays * dayW;
    tlHeader.innerHTML = '';
    const mRow = document.createElement('div'); mRow.className = 'tl-months'; mRow.style.width = tw + 'px';
    const dRow = document.createElement('div'); dRow.className = 'tl-days'; dRow.style.width = tw + 'px';
    const today = new Date(); today.setHours(0,0,0,0);
    let curM = -1, mStartX = 0;
    for (let d = 0; d < totalDays; d++) {
      const dt = new Date(pStart); dt.setDate(dt.getDate() + d);
      const m = dt.getMonth();
      if (m !== curM) {
        if (curM !== -1) { const mc = cEl('div','month-cell'); mc.style.width = (d*dayW - mStartX)+'px'; const pd = new Date(pStart); pd.setDate(pd.getDate()+d-1); mc.textContent = MONTHS[curM]+' '+pd.getFullYear(); mRow.appendChild(mc); }
        curM = m; mStartX = d * dayW;
      }
      const dc = cEl('div','day-cell'); dc.style.width = dayW+'px';
      if (dt.getDay()===0||dt.getDay()===6) dc.classList.add('weekend');
      if (dt.toDateString()===today.toDateString()) dc.classList.add('today');
      if (dayW >= 22) dc.textContent = dt.getDate();
      else if (dayW >= 16 && dt.getDate() % 2 === 1) dc.textContent = dt.getDate();
      dRow.appendChild(dc);
    }
    if (curM !== -1) { const mc = cEl('div','month-cell'); mc.style.width = (totalDays*dayW - mStartX)+'px'; mc.textContent = MONTHS[curM]+' '+pEnd.getFullYear(); mRow.appendChild(mc); }
    tlHeader.appendChild(mRow); tlHeader.appendChild(dRow);
  }

  function renderTLBars() {
    const tw = totalDays * dayW;
    const th = flat.length * 36;
    tlBody.innerHTML = '';
    const canvas = cEl('div','timeline-canvas');
    canvas.style.width = tw+'px'; canvas.style.height = th+'px';

    const today = new Date(); today.setHours(0,0,0,0);
    const rh = 36;

    // SVG for dependency arrows
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('class','dep-arrows-svg');
    svg.setAttribute('width', tw); svg.setAttribute('height', th);
    svg.innerHTML = '<defs><marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="#9ca3af"/></marker></defs>';

    // Weekend stripes
    for (let d = 0; d < totalDays; d++) {
      const dt = new Date(pStart); dt.setDate(dt.getDate() + d);
      if (dt.getDay()===0||dt.getDay()===6) {
        const s = cEl('div','wk-stripe');
        s.style.left = (d*dayW)+'px'; s.style.width = dayW+'px'; s.style.height = th+'px';
        canvas.appendChild(s);
      }
    }

    // Today line
    const tOff = daysBetween(pStart, today);
    if (tOff >= 0 && tOff < totalDays) {
      const tl = cEl('div','today-line');
      tl.style.left = (tOff*dayW + dayW/2)+'px'; tl.style.height = th+'px';
      canvas.appendChild(tl);
    }

    // Bar position map for dependency arrows
    const barMap = {};

    flat.forEach((item, ri) => {
      const task = item.ref;
      // Row bg
      const br = cEl('div','bar-row' + (item.isPhase ? ' phase-row-bg' : ''));
      br.style.top = (ri*rh)+'px'; br.style.height = rh+'px'; br.dataset.ri = ri;
      br.addEventListener('mouseenter', () => highlightRow(ri, true));
      br.addEventListener('mouseleave', () => highlightRow(ri, false));
      br.addEventListener('click', e => selectRow(task.TaskID, e));
      br.addEventListener('contextmenu', e => { e.preventDefault(); selectRow(task.TaskID, e); showCtxMenu(e); });
      canvas.appendChild(br);

      // Bar
      const sOff = daysBetween(pStart, new Date(task.StartDate));
      const eOff = daysBetween(pStart, new Date(task.EndDate));
      const bL = sOff * dayW;
      const bW = Math.max((eOff - sOff + 1) * dayW, dayW);
      const color = COLOR_MAP[task.color] || (item.isPhase ? '#6366f1' : getPhaseColor(item.phaseIdx));

      const bar = cEl('div','task-bar' + (item.isPhase ? ' phase-bar' : ''));
      bar.style.left = bL+'px'; bar.style.width = bW+'px';
      bar.style.top = (ri*rh + rh/2)+'px';
      bar.style.animation = `barIn .35s ${ri*.015}s var(--ease) both`;
      bar.dataset.taskId = task.TaskID;

      const bg = cEl('div','bar-bg');
      bg.style.background = item.isPhase
        ? `linear-gradient(90deg,${color},${lighten(color, 15)})`
        : `linear-gradient(135deg,${color}dd,${darken(color, 10)}dd)`;
      bar.appendChild(bg);

      if (task.Progress > 0 && !item.isPhase) {
        const pg = cEl('div','bar-progress');
        pg.style.width = task.Progress+'%';
        bar.appendChild(pg);
      }

      if (!item.isPhase && bW > 50) {
        const lbl = cEl('span','bar-label');
        lbl.textContent = task.TaskName;
        bar.appendChild(lbl);
      }

      // Drag handles
      if (!item.isPhase) {
        const dl = cEl('div','bar-drag-left');
        const dr = cEl('div','bar-drag-right');
        dl.addEventListener('mousedown', e => startBarResize(e, task, 'left'));
        dr.addEventListener('mousedown', e => startBarResize(e, task, 'right'));
        bar.appendChild(dl); bar.appendChild(dr);
        bar.addEventListener('mousedown', e => {
          if (e.target.classList.contains('bar-drag-left') || e.target.classList.contains('bar-drag-right')) return;
          startBarDrag(e, task);
        });
      }

      bar.addEventListener('click', e => { e.stopPropagation(); selectRow(task.TaskID, e); });

      canvas.appendChild(bar);
      barMap[task.TaskID] = { x: bL, w: bW, y: ri * rh + rh / 2 };
    });

    // Dependency arrows
    flat.forEach(item => {
      const task = item.ref;
      const pred = task.Predecessor;
      if (!pred || !pred.toString().trim()) return;
      const predId = parseInt(pred);
      if (isNaN(predId)) return;
      const from = barMap[predId];
      const to = barMap[task.TaskID];
      if (!from || !to) return;
      const path = document.createElementNS('http://www.w3.org/2000/svg','path');
      const x1 = from.x + from.w, y1 = from.y;
      const x2 = to.x, y2 = to.y;
      const midX = x1 + (x2 - x1) / 2;
      path.setAttribute('d', `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`);
      path.setAttribute('class','dep-arrow');
      svg.appendChild(path);
    });

    canvas.appendChild(svg);
    tlBody.appendChild(canvas);
  }

  function getPhaseColor(pi) {
    if (pi >= 0 && pi < G.data.length) return COLOR_MAP[G.data[pi].color] || RES_COLORS[pi % RES_COLORS.length];
    return '#6366f1';
  }

  // ═══════════════════════════════════════
  // INLINE EDITING
  // ═══════════════════════════════════════
  function startEdit(td, field, task, item) {
    cancelEdit();
    td.classList.add('editing');
    editingCell = { td, field, task, item };

    if (field === 'TaskName') {
      const inp = document.createElement('input');
      inp.type = 'text'; inp.value = task.TaskName;
      td.innerHTML = ''; td.appendChild(inp);
      inp.focus(); inp.select();
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); if (e.key === 'Tab') { e.preventDefault(); commitEdit(); } });
      inp.addEventListener('blur', () => setTimeout(commitEdit, 100));
    } else if (field === 'StartDate' || field === 'EndDate') {
      const inp = document.createElement('input');
      inp.type = 'date'; inp.value = toDateInputVal(new Date(task[field]));
      td.innerHTML = ''; td.appendChild(inp);
      inp.focus();
      inp.addEventListener('change', commitEdit);
      inp.addEventListener('keydown', e => { if (e.key === 'Escape') cancelEdit(); });
      inp.addEventListener('blur', () => setTimeout(commitEdit, 100));
    } else if (field === 'Duration') {
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = 1; inp.value = task.Duration;
      td.innerHTML = ''; td.appendChild(inp);
      inp.focus(); inp.select();
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); });
      inp.addEventListener('blur', () => setTimeout(commitEdit, 100));
    } else if (field === 'AllocatedHours' || field === 'SpentHours') {
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = 0; inp.step = 1;
      inp.value = task[field] || 0;
      td.innerHTML = ''; td.appendChild(inp);
      inp.focus(); inp.select();
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); });
      inp.addEventListener('blur', () => setTimeout(commitEdit, 100));
    } else if (field === 'Progress') {
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = 0; inp.max = 100; inp.value = task.Progress || 0;
      td.innerHTML = ''; td.appendChild(inp);
      inp.focus(); inp.select();
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); });
      inp.addEventListener('blur', () => setTimeout(commitEdit, 100));
    } else if (field === 'Predecessor') {
      const inp = document.createElement('input');
      inp.type = 'text'; inp.value = task.Predecessor || '';
      inp.placeholder = 'e.g. 2';
      td.innerHTML = ''; td.appendChild(inp);
      inp.focus(); inp.select();
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); });
      inp.addEventListener('blur', () => setTimeout(commitEdit, 100));
    } else {
      // Custom field — generic text editor
      const inp = document.createElement('input');
      inp.type = 'text'; inp.value = task[field] != null ? task[field] : '';
      td.innerHTML = ''; td.appendChild(inp);
      inp.focus(); inp.select();
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); });
      inp.addEventListener('blur', () => setTimeout(commitEdit, 100));
    }
  }

  function commitEdit() {
    if (!editingCell) return;
    const { td, field, task, item } = editingCell;
    const inp = td.querySelector('input');
    if (!inp) { cancelEdit(); return; }

    pushUndo();
    const val = inp.value;

    if (field === 'TaskName') {
      task.TaskName = val || task.TaskName;
    } else if (field === 'StartDate') {
      if (val) {
        task.StartDate = val;
        // Recalculate end date from duration (inclusive)
        task.EndDate = addDaysISO(task.StartDate, task.Duration - 1);
      }
    } else if (field === 'EndDate') {
      if (val) {
        task.EndDate = val;
        task.Duration = Math.max(1, daysBetween(new Date(task.StartDate), new Date(task.EndDate)) + 1);
      }
    } else if (field === 'Duration') {
      const d = parseInt(val);
      if (d > 0) {
        task.Duration = d;
        task.EndDate = addDaysISO(task.StartDate, d);
      }
    } else if (field === 'AllocatedHours' || field === 'SpentHours') {
      const h = parseFloat(val);
      task[field] = isNaN(h) ? 0 : Math.max(0, h);
    } else if (field === 'Progress') {
      task.Progress = Math.max(0, Math.min(100, parseInt(val) || 0));
    } else if (field === 'Predecessor') {
      task.Predecessor = val;
    } else {
      // Custom field — store directly on task
      task[field] = val;
    }

    // Recalculate parent phase dates
    if (!item.isPhase && item.phaseIdx >= 0 && item.phaseIdx < G.data.length) {
      recalcPhase(G.data[item.phaseIdx]);
    }

    editingCell = null;
    fullRender();
  }

  function cancelEdit() {
    if (!editingCell) return;
    editingCell = null;
    fullRender();
  }

  // ═══════════════════════════════════════
  // DRAG BAR MOVE / RESIZE
  // ═══════════════════════════════════════
  function startBarDrag(e, task) {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const origStart = new Date(task.StartDate);
    const origEnd = new Date(task.EndDate);
    pushUndo();

    const onMove = e2 => {
      const dx = e2.clientX - startX;
      const daysDelta = Math.round(dx / dayW);
      if (daysDelta === 0) return;
      const ns = new Date(origStart); ns.setDate(ns.getDate() + daysDelta);
      const ne = new Date(origEnd); ne.setDate(ne.getDate() + daysDelta);
      task.StartDate = toDateInputVal(ns);
      task.EndDate = toDateInputVal(ne);
      // Find parent and recalc
      const found = findTaskById(task.TaskID);
      if (found && !found.isPhase && found.parent) recalcPhase(found.parent);
      fullRender();
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function startBarResize(e, task, side) {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const origStart = new Date(task.StartDate);
    const origEnd = new Date(task.EndDate);
    pushUndo();

    const onMove = e2 => {
      const dx = e2.clientX - startX;
      const daysDelta = Math.round(dx / dayW);
      if (side === 'left') {
        const ns = new Date(origStart); ns.setDate(ns.getDate() + daysDelta);
        if (ns < new Date(task.EndDate)) {
          task.StartDate = toDateInputVal(ns);
          task.Duration = Math.max(1, daysBetween(ns, new Date(task.EndDate)) + 1);
        }
      } else {
        const ne = new Date(origEnd); ne.setDate(ne.getDate() + daysDelta);
        if (ne > new Date(task.StartDate)) {
          task.EndDate = toDateInputVal(ne);
          task.Duration = Math.max(1, daysBetween(new Date(task.StartDate), ne) + 1);
        }
      }
      const found = findTaskById(task.TaskID);
      if (found && !found.isPhase && found.parent) recalcPhase(found.parent);
      fullRender();
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ═══════════════════════════════════════
  // SELECTION
  // ═══════════════════════════════════════
  function selectRow(tid, e) {
    if (e && e.shiftKey && lastSelectedId) {
      // Range select
      const ids = flat.map(f => f.ref.TaskID);
      const a = ids.indexOf(lastSelectedId);
      const b = ids.indexOf(tid);
      if (a >= 0 && b >= 0) {
        const [start, end] = a < b ? [a, b] : [b, a];
        for (let i = start; i <= end; i++) selected.add(ids[i]);
      }
    } else if (e && (e.ctrlKey || e.metaKey)) {
      if (selected.has(tid)) selected.delete(tid);
      else selected.add(tid);
    } else {
      selected.clear();
      selected.add(tid);
    }
    lastSelectedId = tid;
    // Update row classes without full re-render
    tableBody.querySelectorAll('.task-row').forEach(r => {
      r.classList.toggle('selected', selected.has(parseInt(r.dataset.taskId)));
    });
  }

  function highlightRow(ri, on) {
    const tr = tableBody.querySelectorAll('.task-row')[ri];
    const br = tlBody.querySelectorAll('.bar-row')[ri];
    if (tr) tr.classList.toggle('highlight', on);
    if (br) br.classList.toggle('highlight', on);
  }

  // ═══════════════════════════════════════
  // COLLAPSE / EXPAND
  // ═══════════════════════════════════════
  function toggleCollapse(taskId) { if (collapsed.has(taskId)) collapsed.delete(taskId); else collapsed.add(taskId); fullRender(); }
  function expandAll() { collapsed.clear(); fullRender(); }
  function collapseAll() {
    function collect(tasks) {
      tasks.forEach(t => {
        if (t.subtasks && t.subtasks.length) { collapsed.add(t.TaskID); collect(t.subtasks); }
      });
    }
    collect(G.data);
    fullRender();
  }

  // ═══════════════════════════════════════
  // CONTEXT MENU
  // ═══════════════════════════════════════
  function setupContextMenu() {
    ctxMenu.querySelectorAll('.ctx-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'move-to-phase') return; // handled by submenu
        hideCtxMenu();
        if (action === 'add-task') addTask();
        else if (action === 'add-subtask') addSubtask();
        else if (action === 'move-up') moveTaskUp();
        else if (action === 'move-down') moveTaskDown();
        else if (action === 'duplicate') duplicateTask();
        else if (action === 'delete') deleteSelected();
        else if (action === 'expand-all') expandAll();
        else if (action === 'collapse-all') collapseAll();
      });
    });
    document.addEventListener('click', e => { if (!ctxMenu.contains(e.target)) hideCtxMenu(); });
  }

  function showCtxMenu(e) {
    ctxMenu.classList.remove('hidden');
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 300);
    ctxMenu.style.left = x+'px'; ctxMenu.style.top = y+'px';

    // Populate phase submenu
    const phaseList = $('ctx-phase-list');
    const moveSection = $('ctx-move-to-phase');
    phaseList.innerHTML = '';
    const selId = getFirstSelectedId();
    const selInfo = selId != null ? findTaskById(selId) : null;
    // Hide "Move to Phase" for phases
    if (!selInfo || selInfo.isPhase) {
      moveSection.style.display = 'none';
    } else {
      moveSection.style.display = '';
      G.data.forEach((phase, pi) => {
        const btn = document.createElement('button');
        btn.className = 'ctx-phase-item';
        const color = COLOR_MAP[phase.color] || RES_COLORS[pi % RES_COLORS.length];
        btn.innerHTML = '<span class="phase-dot-sm" style="background:' + color + '"></span>' + phase.TaskName;
        if (phase === selInfo.parent) {
          btn.style.fontWeight = '700';
          btn.style.color = 'var(--accent)';
        }
        btn.addEventListener('click', () => { hideCtxMenu(); moveTaskToPhase(pi); });
        phaseList.appendChild(btn);
      });
    }
  }

  function hideCtxMenu() { ctxMenu.classList.add('hidden'); }

  // ═══════════════════════════════════════
  // COLOR PICKER
  // ═══════════════════════════════════════
  let colorTarget = null;

  function buildColorGrid() {
    colorGrid.innerHTML = '';
    COLORS.forEach(c => {
      const chip = cEl('div','color-chip');
      chip.style.background = c.hex;
      chip.title = c.name;
      chip.dataset.colorId = c.id;
      chip.addEventListener('click', () => applyColor(c.id));
      colorGrid.appendChild(chip);
    });
    $('color-clear').addEventListener('click', () => applyColor(''));
    document.addEventListener('click', e => { if (!colorPicker.contains(e.target) && !e.target.closest('.td-color')) colorPicker.classList.add('hidden'); });
  }

  function openColorPicker(e, task) {
    colorTarget = task;
    colorPicker.classList.remove('hidden');
    const rect = e.currentTarget.getBoundingClientRect();
    colorPicker.style.left = Math.min(rect.left, window.innerWidth - 190) + 'px';
    colorPicker.style.top = (rect.bottom + 4) + 'px';
    // Highlight active
    colorGrid.querySelectorAll('.color-chip').forEach(ch => ch.classList.toggle('active', ch.dataset.colorId === task.color));
  }

  function applyColor(colorId) {
    if (!colorTarget) return;
    pushUndo();
    colorTarget.color = colorId;
    colorPicker.classList.add('hidden');
    colorTarget = null;
    fullRender();
  }

  // ═══════════════════════════════════════
  // RESOURCE PICKER
  // ═══════════════════════════════════════
  let resPickerTarget = null;

  function openResPicker(e, task) {
    resPickerTarget = task;
    resPicker.classList.remove('hidden');
    const rect = e.currentTarget.getBoundingClientRect();
    resPicker.style.left = Math.min(rect.left, window.innerWidth - 220) + 'px';
    resPicker.style.top = (rect.bottom + 4) + 'px';
    renderResPickerList();
  }

  function renderResPickerList() {
    resPickerList.innerHTML = '';
    const assigned = new Set((resPickerTarget.resources || []).map(r => r.resourceId));
    (G.resources || []).forEach(res => {
      const item = cEl('div', 'res-pick-item' + (assigned.has(res.resourceId) ? ' checked' : ''));
      item.innerHTML = `<div class="res-pick-check"></div><div class="res-pick-dot" style="background:${resColorMap[res.resourceId]||RES_COLORS[0]}"></div><span>${res.resourceName}</span>`;
      item.addEventListener('click', () => toggleResource(res));
      resPickerList.appendChild(item);
    });
    if (!G.resources.length) {
      resPickerList.innerHTML = '<div style="padding:8px;color:#9ca3af;font-size:12px;text-align:center">No resources. Add them via the toolbar.</div>';
    }
  }

  function toggleResource(res) {
    pushUndo();
    const task = resPickerTarget;
    if (!task.resources) task.resources = [];
    const idx = task.resources.findIndex(r => r.resourceId === res.resourceId);
    if (idx >= 0) task.resources.splice(idx, 1);
    else task.resources.push({ resourceId: res.resourceId, resourceName: res.resourceName, unit: 100 });
    renderResPickerList();
    fullRender();
  }

  document.addEventListener('click', e => { if (!resPicker.contains(e.target) && !e.target.closest('.res-badge') && !e.target.closest('[data-field="resources"]')) resPicker.classList.add('hidden'); });

  // ═══════════════════════════════════════
  // COLUMN RESIZE
  // ═══════════════════════════════════════
  function startColResize(e, col, ci) {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startW = col.width || 100;
    const resizer = e.target;
    resizer.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = e2 => {
      const w = Math.max(40, startW + (e2.clientX - startX));
      col.width = w;
      const wpx = w + 'px';
      // Update header cell
      const thCells = tableHeader.querySelectorAll('.th-cell');
      if (thCells[ci]) { thCells[ci].style.width = wpx; thCells[ci].style.minWidth = wpx; }
      // Update all body cells in this column
      const rows = tableBody.querySelectorAll('.task-row');
      rows.forEach(row => {
        const tds = row.querySelectorAll('.td-cell');
        if (tds[ci]) { tds[ci].style.width = wpx; tds[ci].style.minWidth = wpx; }
      });
    };
    const onUp = () => {
      resizer.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      fullRender();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ═══════════════════════════════════════
  // TOOLBAR
  // ═══════════════════════════════════════
  function setupToolbar() {
    $('tb-home').addEventListener('click', goToProjects);
    $('tb-new').addEventListener('click', openNewProjectWizard);
    $('new-project-btn').addEventListener('click', openNewProjectWizard);
    $('tb-save').addEventListener('click', saveFile);
    $('tb-save-as').addEventListener('click', saveAsFile);
    $('tb-undo').addEventListener('click', undo);
    $('tb-redo').addEventListener('click', redo);
    $('tb-add-task').addEventListener('click', addTask);
    $('tb-add-subtask').addEventListener('click', addSubtask);
    $('tb-delete').addEventListener('click', deleteSelected);
    $('tb-expand-all').addEventListener('click', expandAll);
    $('tb-collapse-all').addEventListener('click', collapseAll);
    $('tb-settings').addEventListener('click', openSettings);
    $('tb-resources-mgr').addEventListener('click', openResMgr);
    // Export menu
    $('tb-export').addEventListener('click', e => {
      e.stopPropagation();
      $('export-menu').classList.toggle('hidden');
    });
    document.addEventListener('click', e => {
      if (!$('export-wrap').contains(e.target)) $('export-menu').classList.add('hidden');
    });
    $('exp-excel').addEventListener('click', () => { $('export-menu').classList.add('hidden'); exportToExcel(); });
    $('exp-pdf').addEventListener('click', () => { $('export-menu').classList.add('hidden'); exportToPDF(); });
    $('exp-print').addEventListener('click', () => { $('export-menu').classList.add('hidden'); window.print(); });
    $('add-row-btn').addEventListener('click', addTask);
  }

  // ═══════════════════════════════════════
  // RESOURCES VIEW
  // ═══════════════════════════════════════
  function getAllTasks(taskList) {
    const result = [];
    function walk(tasks, phaseColor) {
      tasks.forEach(t => {
        const color = COLOR_MAP[t.color] || phaseColor || '#6366f1';
        result.push({ ...t, phaseColor: color });
        if (t.subtasks && t.subtasks.length) walk(t.subtasks, color);
      });
    }
    if (taskList) {
      walk(taskList, '#6366f1');
    } else {
      G.data.forEach(p => {
        const pc = COLOR_MAP[p.color] || '#6366f1';
        if (p.subtasks && p.subtasks.length) walk(p.subtasks, pc);
      });
    }
    return result;
  }

  function renderResourcesView() {
    const grid = $('resources-grid');
    grid.innerHTML = '';
    const allTasks = getAllTasks();
    (G.resources || []).forEach(res => {
      const color = resColorMap[res.resourceId] || RES_COLORS[0];
      const tasks = allTasks.filter(t => (t.resources||[]).some(r => r.resourceId === res.resourceId));
      const totalAlloc = tasks.reduce((s,t) => s + (typeof t.AllocatedHours === 'number' ? t.AllocatedHours : 0), 0);
      const totalSpent = tasks.reduce((s,t) => s + (typeof t.SpentHours === 'number' ? t.SpentHours : 0), 0);
      const totalRem = totalAlloc - totalSpent;
      const remColor = totalRem >= 0 ? '#16a34a' : '#dc2626';
      const card = cEl('div','resource-card');
      card.innerHTML = `<div class="rc-header"><div class="rc-avatar" style="background:${color}">${res.resourceName.substring(0,2).toUpperCase()}</div><div class="rc-info"><h3>${res.resourceName}</h3><p>${tasks.length} task${tasks.length!==1?'s':''}</p></div></div><div class="rc-tasks">${tasks.map(t=>`<div class="rc-task"><span class="rc-task-dot" style="background:${t.phaseColor}"></span><span class="rc-task-name" title="${t.TaskName}">${t.TaskName}</span><span class="rc-task-hrs">${t.AllocatedHours>0?t.AllocatedHours+'h':''}</span></div>`).join('')}</div><div class="rc-stats"><div class="rc-stat-row"><span class="rc-stat-label">Allocated</span><span class="rc-stat-val">${totalAlloc>0?totalAlloc+'h':'—'}</span></div><div class="rc-stat-row"><span class="rc-stat-label">Spent</span><span class="rc-stat-val">${totalSpent>0?totalSpent+'h':'0h'}</span></div><div class="rc-stat-row"><span class="rc-stat-label">Remaining</span><span class="rc-stat-val" style="color:${remColor};font-weight:600">${totalAlloc>0?(totalRem>=0?totalRem+'h':Math.abs(totalRem)+'h over'):'—'}</span></div></div>`;
      grid.appendChild(card);
    });
    if (!G.resources.length) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#9ca3af">No resources added yet. Use the <b>Manage Resources</b> button in the toolbar.</div>';
  }

  // ═══════════════════════════════════════
  // VIEW TABS
  // ═══════════════════════════════════════
  function setupViewTabs() {
    $('view-tabs').addEventListener('click', e => {
      const tab = e.target.closest('.view-tab');
      if (!tab) return;
      const v = tab.dataset.view;
      if (v === curView) return;
      $('view-tabs').querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      curView = v;
      $('gantt-view').classList.toggle('hidden', v !== 'gantt');
      $('resources-view').classList.toggle('hidden', v !== 'resources');
      $('summary-view').classList.toggle('hidden', v !== 'summary');
      if (v === 'resources') renderResourcesView();
      if (v === 'summary') renderSummaryView();
    });
  }

  // ═══════════════════════════════════════
  // SUMMARY VIEW
  // ═══════════════════════════════════════
  function renderSummaryView() {
    const el = $('summary-content');
    el.innerHTML = '';
    const phases = G.data || [];
    const allSub = getAllTasks();
    const totalAlloc = allSub.reduce((s,t) => s + (t.AllocatedHours || 0), 0);
    const totalSpent = allSub.reduce((s,t) => s + (t.SpentHours || 0), 0);
    const totalRem = totalAlloc - totalSpent;
    let minD = Infinity, maxD = -Infinity;
    phases.forEach(p => { const s = new Date(p.StartDate), e = new Date(p.EndDate); if(s<minD)minD=s; if(e>maxD)maxD=e; });
    const mn = new Date(minD === Infinity ? Date.now() : minD);
    const mx = new Date(maxD === -Infinity ? Date.now() : maxD);

    el.innerHTML = `<div class="sum-header"><h2>Project Summary</h2><p class="sum-dates">${fmtDate(mn)} → ${fmtDate(mx)}</p><div class="sum-stats"><div class="sum-stat"><div class="sum-stat-val">${phases.length}</div><div class="sum-stat-lbl">Phases</div></div><div class="sum-stat"><div class="sum-stat-val">${allSub.length}</div><div class="sum-stat-lbl">Tasks</div></div><div class="sum-stat"><div class="sum-stat-val">${(G.resources||[]).length}</div><div class="sum-stat-lbl">People</div></div><div class="sum-stat"><div class="sum-stat-val">${totalAlloc>0?totalAlloc+'h':'—'}</div><div class="sum-stat-lbl">Allocated</div></div><div class="sum-stat"><div class="sum-stat-val">${totalSpent>0?totalSpent+'h':'0h'}</div><div class="sum-stat-lbl">Spent</div></div><div class="sum-stat"><div class="sum-stat-val" style="color:${totalRem>=0?'#16a34a':'#dc2626'}">${totalAlloc>0?(totalRem>=0?totalRem+'h':Math.abs(totalRem)+'h over'):'—'}</div><div class="sum-stat-lbl">Remaining</div></div></div></div>`;

    const span = mx - mn || 1;
    phases.forEach((p, pi) => {
      const pc = COLOR_MAP[p.color] || RES_COLORS[pi % RES_COLORS.length];
      const ps = new Date(p.StartDate), pe = new Date(p.EndDate);
      const leftPct = ((ps - mn) / span) * 100;
      const widthPct = ((pe - ps) / span) * 100;
      const sc = (p.subtasks||[]).length;
      const card = cEl('div','sum-phase');
      card.innerHTML = `<div class="sum-phase-hdr"><div class="sum-phase-bar" style="background:${pc}"></div><h3>${p.TaskName}</h3><span class="sum-phase-dur">${p.Duration} days</span></div><div class="sum-phase-info">${sc} task${sc!==1?'s':''} · ${fmtShort(ps)} – ${fmtShort(pe)}</div><div class="sum-phase-track"><div class="sum-phase-fill" style="background:${pc};margin-left:${leftPct}%;width:${widthPct}%"></div></div>`;
      el.appendChild(card);
    });
  }

  // ═══════════════════════════════════════
  // SETTINGS MODAL
  // ═══════════════════════════════════════
  function setupModals() {
    $('settings-close').addEventListener('click', () => $('settings-backdrop').classList.add('hidden'));
    $('settings-backdrop').addEventListener('click', e => { if (e.target === $('settings-backdrop')) $('settings-backdrop').classList.add('hidden'); });
    $('settings-apply').addEventListener('click', applySettings);
    $('resmgr-close').addEventListener('click', () => $('resmgr-backdrop').classList.add('hidden'));
    $('resmgr-backdrop').addEventListener('click', e => { if (e.target === $('resmgr-backdrop')) $('resmgr-backdrop').classList.add('hidden'); });
    $('resmgr-done').addEventListener('click', () => $('resmgr-backdrop').classList.add('hidden'));
    $('resmgr-add-btn').addEventListener('click', addResource);
    $('resmgr-new-name').addEventListener('keydown', e => { if (e.key === 'Enter') addResource(); });
    $('s-add-col-btn').addEventListener('click', addCustomColumn);
    $('s-new-col-name').addEventListener('keydown', e => { if (e.key === 'Enter') addCustomColumn(); });
    // Task edit modal
    $('task-edit-close').addEventListener('click', closeTaskEdit);
    $('task-edit-cancel').addEventListener('click', closeTaskEdit);
    $('task-edit-backdrop').addEventListener('click', e => { if (e.target === $('task-edit-backdrop')) closeTaskEdit(); });
    $('task-edit-save').addEventListener('click', saveTaskEdit);

    // Auto-calc: dates ↔ duration (inclusive: Jul 20→24 = 5 days)
    $('te-start').addEventListener('change', () => {
      const s = $('te-start').value, e = $('te-end').value;
      if (s && e) {
        const diff = Math.round((new Date(e) - new Date(s)) / 86400000) + 1;
        if (diff >= 1) $('te-duration').value = diff;
      }
    });
    $('te-end').addEventListener('change', () => {
      const s = $('te-start').value, e = $('te-end').value;
      if (s && e) {
        const diff = Math.round((new Date(e) - new Date(s)) / 86400000) + 1;
        if (diff >= 1) $('te-duration').value = diff;
      }
    });
    $('te-duration').addEventListener('input', () => {
      const s = $('te-start').value;
      const d = parseInt($('te-duration').value);
      if (s && !isNaN(d) && d >= 1) {
        $('te-end').value = addDaysISO(s, d - 1);
      }
    });
  }

  // ═══════════════════════════════════════
  // TASK EDIT MODAL
  // ═══════════════════════════════════════
  let taskEditId = null;

  function openTaskEdit(id) {
    const info = findTaskById(id);
    if (!info) return;
    const task = info.ref;
    taskEditId = id;

    $('task-edit-title').textContent = info.isPhase ? 'Edit Phase' : 'Edit Task';
    $('te-name').value = task.TaskName || '';
    $('te-start').value = (task.StartDate || '').slice(0, 10);
    $('te-end').value = (task.EndDate || '').slice(0, 10);
    $('te-duration').value = task.Duration || '';
    $('te-alloc-hrs').value = task.AllocatedHours || 0;
    $('te-spent-hrs').value = task.SpentHours || 0;
    $('te-progress').value = task.Progress || 0;
    $('te-dep').value = task.Predecessor || '';
    $('te-notes').value = task.info || '';

    // Populate "Move to Phase" dropdown
    const phaseSelect = $('te-phase');
    phaseSelect.innerHTML = '';
    if (info.isPhase) {
      // For phases, show disabled option
      const opt = document.createElement('option');
      opt.textContent = '— This is a phase —';
      opt.disabled = true;
      opt.selected = true;
      phaseSelect.appendChild(opt);
      phaseSelect.disabled = true;
    } else {
      phaseSelect.disabled = false;
      G.data.forEach((phase, pi) => {
        const opt = document.createElement('option');
        opt.value = pi;
        opt.textContent = phase.TaskName;
        if (phase === info.parent) opt.selected = true;
        phaseSelect.appendChild(opt);
      });
    }

    $('task-edit-backdrop').classList.remove('hidden');
    $('te-name').focus();
    $('te-name').select();
  }

  function closeTaskEdit() {
    $('task-edit-backdrop').classList.add('hidden');
    taskEditId = null;
  }

  function saveTaskEdit() {
    if (taskEditId == null) return;
    const info = findTaskById(taskEditId);
    if (!info) return;
    pushUndo();
    const task = info.ref;

    task.TaskName = $('te-name').value.trim() || task.TaskName;
    const newStart = $('te-start').value;
    const newEnd = $('te-end').value;
    const dur = parseInt($('te-duration').value);

    if (newStart) task.StartDate = newStart;
    if (newEnd) task.EndDate = newEnd;

    // Recalc duration from dates
    if (newStart && newEnd) {
      task.Duration = Math.max(1, Math.round((new Date(newEnd) - new Date(newStart)) / 86400000) + 1);
    } else if (!isNaN(dur) && dur >= 1) {
      task.Duration = dur;
      if (newStart) task.EndDate = addDaysISO(newStart, dur - 1);
    }

    const alloc = parseFloat($('te-alloc-hrs').value);
    if (!isNaN(alloc) && alloc >= 0) task.AllocatedHours = alloc;
    const spent = parseFloat($('te-spent-hrs').value);
    if (!isNaN(spent) && spent >= 0) task.SpentHours = spent;
    const prog = parseInt($('te-progress').value);
    if (!isNaN(prog)) task.Progress = Math.max(0, Math.min(100, prog));
    task.Predecessor = $('te-dep').value.trim();
    task.info = $('te-notes').value;

    // Move to phase if changed
    if (!info.isPhase) {
      const newPhaseIdx = parseInt($('te-phase').value);
      const targetPhase = G.data[newPhaseIdx];
      if (targetPhase && targetPhase !== info.parent) {
        // Remove from current phase
        const subs = info.parent.subtasks || [];
        const idx = subs.indexOf(task);
        if (idx > -1) subs.splice(idx, 1);
        // Add to target phase
        if (!targetPhase.subtasks) targetPhase.subtasks = [];
        targetPhase.subtasks.push(task);
      }
    }

    closeTaskEdit();
    fullRender();
    saveToBrowser();
  }

  function addCustomColumn() {
    const name = $('s-new-col-name').value.trim();
    if (!name) return;
    // Generate a camelCase field key from the name
    const field = name.replace(/[^a-zA-Z0-9 ]/g, '').split(' ').map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
    // Check for duplicate
    if (G.advanced.columns.some(c => c.field === field || c.name === name)) return;
    pushUndo();
    G.advanced.columns.push({ name, field, width: 100, show: true });
    $('s-new-col-name').value = '';
    // Re-render the columns list in settings
    openSettings();
    fullRender();
  }

  function openSettings() {
    const adv = G.advanced || {};
    // Columns
    const colsEl = $('settings-columns');
    colsEl.innerHTML = '';
    getColumns().forEach((col, i) => {
      const label = cEl('label', 'col-toggle');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = col.show !== false; cb.dataset.ci = i;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + col.name));
      colsEl.appendChild(label);
    });
    // Date format
    $('s-date-format').value = adv.dateFormat || 'dd MMM yyyy';
    // First day
    $('s-first-day').value = adv.firstDayOfWeek != null ? adv.firstDayOfWeek : 1;
    // Work days
    const wdEl = $('s-workdays');
    wdEl.innerHTML = '';
    const ww = adv.workWeek || ['Monday','Tuesday','Wednesday','Thursday','Friday'];
    ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].forEach(day => {
      const chip = cEl('span', 'wd-chip' + (ww.includes(day) ? ' active' : ''));
      chip.textContent = day.substring(0, 3);
      chip.dataset.day = day;
      chip.addEventListener('click', () => chip.classList.toggle('active'));
      wdEl.appendChild(chip);
    });
    // Work hours
    const wt = (adv.workTime && adv.workTime[0]) || { from: 9, to: 17 };
    $('s-work-from').value = wt.from;
    $('s-work-to').value = wt.to;

    $('settings-backdrop').classList.remove('hidden');
  }

  function applySettings() {
    pushUndo();
    const adv = G.advanced;
    // Columns
    $('settings-columns').querySelectorAll('input[type="checkbox"]').forEach(cb => {
      const ci = parseInt(cb.dataset.ci);
      getColumns()[ci].show = cb.checked;
    });
    adv.dateFormat = $('s-date-format').value;
    adv.firstDayOfWeek = parseInt($('s-first-day').value);
    // Work days
    adv.workWeek = [];
    $('s-workdays').querySelectorAll('.wd-chip.active').forEach(ch => adv.workWeek.push(ch.dataset.day));
    // Work hours
    adv.workTime = [{ from: parseInt($('s-work-from').value) || 9, to: parseInt($('s-work-to').value) || 17 }];

    $('settings-backdrop').classList.add('hidden');
    fullRender();
  }

  // ═══════════════════════════════════════
  // RESOURCE MANAGER MODAL
  // ═══════════════════════════════════════
  function openResMgr() {
    renderResMgrList();
    $('resmgr-backdrop').classList.remove('hidden');
    $('resmgr-new-name').value = '';
    $('resmgr-new-name').focus();
  }

  function renderResMgrList() {
    const list = $('resmgr-list');
    list.innerHTML = '';
    (G.resources || []).forEach((res, i) => {
      const item = cEl('div','res-mgr-item');
      const dot = cEl('div','res-dot'); dot.style.background = resColorMap[res.resourceId] || RES_COLORS[i % RES_COLORS.length];
      const inp = document.createElement('input');
      inp.value = res.resourceName;
      inp.addEventListener('change', () => { pushUndo(); const oldId = res.resourceId; res.resourceName = inp.value; res.resourceId = inp.value; updateResIdInTasks(oldId, inp.value); buildResColorMap(); fullRender(); });
      const del = cEl('button','res-mgr-del');
      del.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      del.addEventListener('click', () => { pushUndo(); removeResource(res.resourceId); renderResMgrList(); });
      item.appendChild(dot); item.appendChild(inp); item.appendChild(del);
      list.appendChild(item);
    });
  }

  function addResource() {
    const name = $('resmgr-new-name').value.trim();
    if (!name) return;
    if (G.resources.some(r => r.resourceId === name)) return;
    pushUndo();
    G.resources.push({ resourceId: name, resourceName: name });
    buildResColorMap();
    $('resmgr-new-name').value = '';
    renderResMgrList();
    fullRender();
  }

  function removeResource(rid) {
    G.resources = G.resources.filter(r => r.resourceId !== rid);
    // Remove from all tasks
    G.data.forEach(p => {
      p.resources = (p.resources||[]).filter(r => r.resourceId !== rid);
      (p.subtasks||[]).forEach(t => t.resources = (t.resources||[]).filter(r => r.resourceId !== rid));
    });
    buildResColorMap();
    fullRender();
  }

  function updateResIdInTasks(oldId, newId) {
    G.data.forEach(p => {
      (p.resources||[]).forEach(r => { if (r.resourceId === oldId) { r.resourceId = newId; r.resourceName = newId; }});
      (p.subtasks||[]).forEach(t => (t.resources||[]).forEach(r => { if (r.resourceId === oldId) { r.resourceId = newId; r.resourceName = newId; }}));
    });
  }

  // ═══════════════════════════════════════
  // ZOOM
  // ═══════════════════════════════════════
  function setupZoom() {
    $('tb-zoom-in').addEventListener('click', () => { dayW = Math.min(MAX_DAY_W, dayW + ZOOM_STEP); fullRender(); });
    $('tb-zoom-out').addEventListener('click', () => { dayW = Math.max(MIN_DAY_W, dayW - ZOOM_STEP); fullRender(); });
    $('tb-fit').addEventListener('click', () => { dayW = Math.max(MIN_DAY_W, Math.min(MAX_DAY_W, Math.floor((tlPanel.offsetWidth - 20) / totalDays))); fullRender(); });
    $('tb-today').addEventListener('click', scrollToToday);
    tlPanel.addEventListener('wheel', e => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        dayW = Math.max(MIN_DAY_W, Math.min(MAX_DAY_W, dayW + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)));
        fullRender();
      }
    }, { passive: false });
  }

  function updateZoomLabel() { $('zoom-label').textContent = Math.round(dayW / DEFAULT_DAY_W * 100) + '%'; }
  function scrollToToday() { const t = new Date(); t.setHours(0,0,0,0); const off = daysBetween(pStart, t); if (off >= 0 && off < totalDays) tlBody.scrollLeft = Math.max(0, off * dayW - tlPanel.offsetWidth / 2); }

  // ═══════════════════════════════════════
  // RESIZE HANDLE
  // ═══════════════════════════════════════
  function setupResizeHandle() {
    const rh = $('resize-handle');
    rh.addEventListener('mousedown', e => {
      e.preventDefault();
      const startX = e.clientX, startW = tableEl.offsetWidth;
      rh.classList.add('dragging');
      const onMove = e2 => { tableEl.style.width = Math.max(200, Math.min(1400, startW + e2.clientX - startX)) + 'px'; };
      const onUp = () => { rh.classList.remove('dragging'); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
    });
  }

  // ═══════════════════════════════════════
  // SCROLL SYNC
  // ═══════════════════════════════════════
  function setupScrollSync() {
    let s = false;
    tlBody.addEventListener('scroll', () => { if (s) return; s = true; tableBody.scrollTop = tlBody.scrollTop; tlHeader.scrollLeft = tlBody.scrollLeft; requestAnimationFrame(() => s = false); });
    tableBody.addEventListener('scroll', () => {
      if (s) return; s = true;
      tlBody.scrollTop = tableBody.scrollTop;
      tableHeader.scrollLeft = tableBody.scrollLeft; // sync table header with body horizontal scroll
      requestAnimationFrame(() => s = false);
    });
  }

  // ═══════════════════════════════════════
  // DRAG & DROP FILE
  // ═══════════════════════════════════════
  function setupDragDrop() {
    let dc = 0;
    function hasFiles(e) {
      // Only show overlay for external file drags, not internal row drags
      if (dragSrcId != null) return false;
      const types = e.dataTransfer && e.dataTransfer.types;
      return types && (types.indexOf('Files') !== -1 || types.indexOf('application/x-moz-file') !== -1);
    }
    document.addEventListener('dragenter', e => { e.preventDefault(); if (!hasFiles(e)) return; dc++; $('drop-overlay').classList.remove('hidden'); });
    document.addEventListener('dragleave', e => { e.preventDefault(); dc--; if (dc <= 0) { dc = 0; $('drop-overlay').classList.add('hidden'); }});
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => { e.preventDefault(); dc = 0; $('drop-overlay').classList.add('hidden'); const f = e.dataTransfer.files[0]; if (f && f.name.endsWith('.gantt')) readFile(f); });
  }

  // ═══════════════════════════════════════
  // KEYBOARD SHORTCUTS
  // ═══════════════════════════════════════
  function setupKeyboard() {
    document.addEventListener('keydown', e => {
      // Don't capture when editing
      if (editingCell || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 's' && e.shiftKey) { e.preventDefault(); saveAsFile(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 's' && !e.shiftKey) { e.preventDefault(); saveFile(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'o') { e.preventDefault(); $('file-input-main').click(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (selected.size) { e.preventDefault(); deleteSelected(); }}
      else if (e.key === 'Enter') { e.preventDefault(); addTask(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
    });
  }

  function moveSelection(dir) {
    if (!flat.length) return;
    const ids = flat.map(f => f.ref.TaskID);
    let idx = lastSelectedId ? ids.indexOf(lastSelectedId) : -1;
    idx += dir;
    if (idx < 0) idx = 0;
    if (idx >= ids.length) idx = ids.length - 1;
    selected.clear(); selected.add(ids[idx]); lastSelectedId = ids[idx];
    tableBody.querySelectorAll('.task-row').forEach(r => r.classList.toggle('selected', selected.has(parseInt(r.dataset.taskId))));
    // Scroll into view
    const row = tableBody.querySelector(`[data-task-id="${ids[idx]}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  // ═══════════════════════════════════════
  // EXPORT FUNCTIONS
  // ═══════════════════════════════════════
  function exportToExcel() {
    if (!G || !G.data) return;
    const rows = [];
    // Header
    rows.push(['ID', 'Task Name', 'Start Date', 'End Date', 'Duration (days)', 'Progress %', 'Resources', 'Allocated Hrs', 'Spent Hrs', 'Remaining Hrs', 'Dependency', 'Notes']);

    function walkTasks(tasks, depth) {
      tasks.forEach(t => {
        const indent = '  '.repeat(depth);
        const prefix = (t.subtasks && t.subtasks.length) ? '▸ ' : '';
        const res = (t.resources || []).map(r => typeof r === 'string' ? r : r.resourceName || '').join(', ');
        const alloc = t.AllocatedHours || 0;
        const spent = t.SpentHours || 0;
        const remaining = Math.max(0, alloc - spent);
        rows.push([
          t.TaskID,
          indent + prefix + (t.TaskName || ''),
          t.StartDate ? fmtDate(new Date(t.StartDate)) : '',
          t.EndDate ? fmtDate(new Date(t.EndDate)) : '',
          t.Duration || '',
          t.Progress || 0,
          res,
          alloc,
          spent,
          remaining,
          t.Predecessor || '',
          t.info || ''
        ]);
        if (t.subtasks && t.subtasks.length) walkTasks(t.subtasks, depth + 1);
      });
    }
    walkTasks(G.data, 0);

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Overview sheet
    const ws = XLSX.utils.aoa_to_sheet(rows);
    // Set column widths
    ws['!cols'] = [
      { wch: 5 },   // ID
      { wch: 40 },  // Task Name
      { wch: 14 },  // Start
      { wch: 14 },  // End
      { wch: 12 },  // Duration
      { wch: 10 },  // Progress
      { wch: 20 },  // Resources
      { wch: 12 },  // Allocated
      { wch: 10 },  // Spent
      { wch: 12 },  // Remaining
      { wch: 10 },  // Dependency
      { wch: 30 },  // Notes
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Tasks');

    // Summary sheet
    const allTasks = getAllTasks();
    const totalTasks = allTasks.length;
    const totalPhases = G.data.length;
    const totalAllocHrs = allTasks.reduce((s, t) => s + (t.AllocatedHours || 0), 0);
    const totalSpentHrs = allTasks.reduce((s, t) => s + (t.SpentHours || 0), 0);
    const avgProgress = totalTasks ? Math.round(allTasks.reduce((s, t) => s + (t.Progress || 0), 0) / totalTasks) : 0;

    const summaryRows = [
      ['Project Summary'],
      [''],
      ['Project Name', projectName || 'Untitled'],
      ['Total Phases', totalPhases],
      ['Total Tasks', totalTasks],
      ['Allocated Hours', totalAllocHrs],
      ['Spent Hours', totalSpentHrs],
      ['Remaining Hours', Math.max(0, totalAllocHrs - totalSpentHrs)],
      ['Average Progress', avgProgress + '%'],
      [''],
      ['Phase Breakdown'],
      ['Phase', 'Tasks', 'Start', 'End', 'Duration', 'Allocated Hrs', 'Spent Hrs', 'Avg Progress']
    ];
    G.data.forEach(p => {
      const subs = getAllTasks(p.subtasks);
      const ap = subs.length ? Math.round(subs.reduce((s, t) => s + (t.Progress || 0), 0) / subs.length) : 0;
      const pAlloc = subs.reduce((s, t) => s + (t.AllocatedHours || 0), 0);
      const pSpent = subs.reduce((s, t) => s + (t.SpentHours || 0), 0);
      summaryRows.push([
        p.TaskName,
        subs.length,
        fmtDate(new Date(p.StartDate)),
        fmtDate(new Date(p.EndDate)),
        p.Duration + ' days',
        pAlloc,
        pSpent,
        ap + '%'
      ]);
    });

    const ws2 = XLSX.utils.aoa_to_sheet(summaryRows);
    ws2['!cols'] = [{ wch: 25 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Summary');

    // Download
    const fileName = (projectName || 'project') + '.xlsx';
    XLSX.writeFile(wb, fileName);
    showSaveToast();
  }

  function exportToPDF() {
    // Generate a clean standalone HTML page for printing
    const allTasks = getAllTasks();
    const totalAlloc = allTasks.reduce((s,t) => s + (t.AllocatedHours || 0), 0);
    const totalSpent = allTasks.reduce((s,t) => s + (t.SpentHours || 0), 0);
    const totalRem = totalAlloc - totalSpent;

    let rows = '';
    function walkPDF(tasks, depth) {
      tasks.forEach(t => {
        const isPhase = t.subtasks && t.subtasks.length;
        const indent = '\u00A0\u00A0'.repeat(depth);
        const bg = isPhase ? '#f3f4f6' : '';
        const fw = isPhase ? '600' : '400';
        const res = (t.resources || []).map(r => typeof r === 'string' ? r : r.resourceName || '').join(', ');
        const alloc = isPhase ? getHours(t, 'AllocatedHours', true) : (t.AllocatedHours || 0);
        const spent = isPhase ? getHours(t, 'SpentHours', true) : (t.SpentHours || 0);
        const rem = alloc - spent;
        const remColor = rem > 0 ? '#ea580c' : (rem === 0 ? '#16a34a' : '#dc2626');
        rows += `<tr style="background:${bg};font-weight:${fw}">
          <td style="color:#9ca3af">${t.TaskID}</td>
          <td>${indent}${t.TaskName || ''}</td>
          <td>${t.StartDate ? fmtDate(new Date(t.StartDate)) : ''}</td>
          <td>${t.EndDate ? fmtDate(new Date(t.EndDate)) : ''}</td>
          <td>${t.Duration || ''} days</td>
          <td>${res}</td>
          <td>${alloc > 0 ? alloc + 'h' : '\u2014'}</td>
          <td>${spent > 0 ? spent + 'h' : '\u2014'}</td>
          <td style="color:${alloc > 0 ? remColor : '#9ca3af'};font-weight:500">${alloc > 0 ? rem + 'h' : '\u2014'}</td>
          <td>${t.Progress || 0}%</td>
        </tr>`;
        if (t.subtasks && t.subtasks.length) walkPDF(t.subtasks, depth + 1);
      });
    }
    walkPDF(G.data, 0);

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${projectName || 'Project'} - Export</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Inter',system-ui,sans-serif;font-size:11px;color:#1f2937;padding:16px}
  .header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #6366f1;padding-bottom:10px;margin-bottom:14px}
  .header h1{font-size:20px;color:#1f2937}
  .header .meta{font-size:11px;color:#6b7280}
  .stats{display:flex;gap:18px;margin-bottom:14px}
  .stat{text-align:center;padding:8px 14px;background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb}
  .stat-val{font-size:16px;font-weight:700;color:#6366f1}
  .stat-lbl{font-size:8px;color:#6b7280;text-transform:uppercase;letter-spacing:.3px;margin-top:2px}
  table{width:100%;border-collapse:collapse;font-size:10px}
  th{background:#f3f4f6;font-weight:600;text-transform:uppercase;font-size:8.5px;letter-spacing:.3px;color:#6b7280;padding:6px 8px;text-align:left;border-bottom:2px solid #d1d5db}
  td{padding:5px 8px;border-bottom:1px solid #e5e7eb;white-space:nowrap}
  tr:hover{background:#f9fafb}
  @page{size:landscape;margin:8mm}
  @media print{body{padding:0} .stat-val{color:#6366f1!important}}
</style></head><body>
<div class="header">
  <div><h1>${projectName || 'Project'}</h1><div class="meta">Exported on ${fmtDate(new Date())}</div></div>
  <div class="meta">${G.data.length} phases \u00B7 ${allTasks.length} tasks</div>
</div>
<div class="stats">
  <div class="stat"><div class="stat-val">${G.data.length}</div><div class="stat-lbl">Phases</div></div>
  <div class="stat"><div class="stat-val">${allTasks.length}</div><div class="stat-lbl">Tasks</div></div>
  <div class="stat"><div class="stat-val">${totalAlloc > 0 ? totalAlloc + 'h' : '\u2014'}</div><div class="stat-lbl">Allocated</div></div>
  <div class="stat"><div class="stat-val">${totalSpent > 0 ? totalSpent + 'h' : '0h'}</div><div class="stat-lbl">Spent</div></div>
  <div class="stat"><div class="stat-val" style="color:${totalRem >= 0 ? '#16a34a' : '#dc2626'}">${totalAlloc > 0 ? totalRem + 'h' : '\u2014'}</div><div class="stat-lbl">Remaining</div></div>
</div>
<table>
  <thead><tr><th>ID</th><th>Task Name</th><th>Start</th><th>End</th><th>Duration</th><th>Resources</th><th>Allocated</th><th>Spent</th><th>Remaining</th><th>Progress</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<script>window.onload=()=>{window.print();}<\/script>
</body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  }


  // ═══════════════════════════════════════
  function cEl(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function daysBetween(a, b) { return Math.floor((b - a) / 864e5); }
  function fmtDate(d) { return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function fmtShort(d) { return d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  function todayISO() { return toDateInputVal(new Date()); }
  function addDaysISO(iso, days) { const d = new Date(iso); d.setDate(d.getDate() + days); return toDateInputVal(d); }
  function toDateInputVal(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }

  // Get hours with rollup for phases
  function getHours(task, field, isPhase) {
    if (isPhase || (task.subtasks && task.subtasks.length)) {
      let total = 0;
      function sum(tasks) {
        tasks.forEach(t => {
          total += (typeof t[field] === 'number' ? t[field] : parseFloat(t[field]) || 0);
          if (t.subtasks && t.subtasks.length) sum(t.subtasks);
        });
      }
      if (task.subtasks) sum(task.subtasks);
      return total;
    }
    const v = task[field];
    return typeof v === 'number' ? v : (parseFloat(v) || 0);
  }

  function lighten(hex, amt) {
    hex = hex.replace('#','');
    let r = parseInt(hex.substring(0,2),16), g = parseInt(hex.substring(2,4),16), b = parseInt(hex.substring(4,6),16);
    r = Math.max(0, Math.min(255, r+amt)); g = Math.max(0, Math.min(255, g+amt)); b = Math.max(0, Math.min(255, b+amt));
    return '#'+[r,g,b].map(c=>c.toString(16).padStart(2,'0')).join('');
  }
  function darken(hex, amt) { return lighten(hex, -amt); }

  // ═══════════════════════════════════════
  // BOOT
  // ═══════════════════════════════════════
  init();
})();

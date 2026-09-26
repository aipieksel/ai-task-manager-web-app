import { escapeHtml, formatRelativeTime } from '../lib/utils.js';

const ICONS = {
  queue: '<path d="M3 4.5h10v7H3z"/><path d="M5.5 7h5M5.5 9h3"/>',
  tasks: '<path d="M4 3.5h8v9H4z"/><path d="m5.5 6 1 1 2-2M5.5 9.5h5"/>',
  questions: '<circle cx="8" cy="8" r="5.25"/><path d="M6.7 6.3a1.5 1.5 0 0 1 2.8.8c0 1.2-1.5 1.4-1.5 2.4M8 11.4h.01"/>',
  plan: '<path d="M4 2.8h6l2 2v8.4H4z"/><path d="M10 2.8v2h2M6 7h4M6 9.5h4"/>',
  verification: '<path d="M8 2.5 12.5 4v3.5c0 2.7-1.7 4.8-4.5 6-2.8-1.2-4.5-3.3-4.5-6V4z"/><path d="m5.8 8 1.4 1.4 3-3"/>',
  activity: '<path d="M3 11V7M6.3 11V4.5M9.7 11V6M13 11V3"/>',
  agents: '<circle cx="5" cy="5.2" r="2.1"/><circle cx="11" cy="5.2" r="2.1"/><path d="M2.5 13c.5-2.4 2-3.6 4.5-3.6s4 1.2 4.5 3.6"/><path d="M8.8 8.5c.7-.4 1.4-.6 2.2-.6 1.9 0 3.1.9 3.5 2.7"/>',
  lessons: '<path d="M4 3.5h7.5v9H4z"/><path d="M6 6h3.5M6 8.5h3.5M6 11h2"/>',
  observations: '<path d="M8 2.8a4.2 4.2 0 0 0-2.5 7.6v1.1h5v-1.1A4.2 4.2 0 0 0 8 2.8Z"/><path d="M6.5 13h3"/>',
  projects: '<path d="M2.8 5h4l1-1.5h5.4v8.8H2.8z"/>',
  settings: '<circle cx="8" cy="8" r="2"/><path d="M8 2.5v1.2M8 12.3v1.2M2.5 8h1.2M12.3 8h1.2M4.1 4.1l.9.9M11 11l.9.9M11.9 4.1l-.9.9M5 11l-.9.9"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  refresh: '<path d="M12.5 5.5V3h-2.5M3.6 6a4.7 4.7 0 0 1 8.3-1M3.5 10.5V13H6M12.4 10a4.7 4.7 0 0 1-8.3 1"/>',
  search: '<circle cx="7" cy="7" r="3.8"/><path d="m10 10 3 3"/>',
  arrow: '<path d="M3 8h10M9 4l4 4-4 4"/>',
  back: '<path d="m9.5 3.5-4.5 4.5 4.5 4.5M5 8h8"/>',
  chevron: '<path d="m6 4 4 4-4 4"/>',
  menu: '<circle cx="4" cy="8" r=".7" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r=".7" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r=".7" fill="currentColor" stroke="none"/>',
  close: '<path d="m4 4 8 8M12 4l-8 8"/>',
  copy: '<path d="M5 5h7v8H5z"/><path d="M3 10V3h7"/>',
  warning: '<path d="M8 2.5 14 13H2z"/><path d="M8 6v3M8 11.5h.01"/>',
  check: '<path d="m3.5 8 3 3 6-6"/>',
  filter: '<path d="M2.5 4h11M4.5 8h7M6.5 12h3"/>',
  download: '<path d="M8 2.8v7M5.5 7.5 8 10l2.5-2.5M3 12.5h10"/>',
  trash: '<path d="M4 5h8M6 5V3.5h4V5M5 5l.6 8h4.8l.6-8"/>',
};

export function icon(name, className = 'icon') {
  return `<svg class="${className}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.plan}</svg>`;
}

export function statusBadge(status = '') {
  const value = String(status || 'Unknown');
  const lower = value.toLowerCase();
  const className = /complete|healthy|verified|granted|answered|approved/.test(lower) ? 'badge-success'
    : /blocked|error|conflict|critical|denied/.test(lower) ? 'badge-danger'
      : /pending|question|stale|partial|warning|prompt|review|verification|feedback|replied/.test(lower) ? 'badge-warning'
        : /draft|needs plan|active|in progress/.test(lower) ? 'badge-accent'
          : /archive|archived/.test(lower) ? 'badge-muted' : '';
  return `<span class="badge ${className}">${escapeHtml(value)}</span>`;
}

export function emptyState({ title, description, action = '', iconName = 'projects' }) {
  return `<section class="empty-state">
    <div class="empty-state-icon">${icon(iconName)}</div>
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(description)}</p>
    ${action}
  </section>`;
}


export function settingsRow({ label, description, control = '', status = '' }) {
  const rowControl = control || (status ? statusBadge(status) : '');
  return `<div class="settings-row"><div class="settings-row-copy"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(description)}</span></div>${rowControl}</div>`;
}

export function settingsSection({ title, description, content = '' }) {
  return `<section class="settings-section"><div class="settings-section-head"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>${content}</section>`;
}

const NAV_SECTIONS = [
  { label: 'Operations', items: [
    ['/', 'queue', 'Queue', 'queue'],
    ['/questions', 'questions', 'Decisions', 'questions'],
    ['/task', 'plan', 'Plan workspace', null],
    ['/verification', 'verification', 'Verification', 'verification'],
    ['/activity', 'activity', 'Change feed', null],
    ['/agents', 'agents', 'Agents', null],
  ] },
  { label: 'Knowledge', items: [
    ['/lessons', 'lessons', 'Lessons', 'lessons'],
    ['/observations', 'observations', 'Observations', 'observations'],
  ] },
  { label: 'Administration', items: [
    ['/projects', 'projects', 'Projects', 'projects'],
    ['/settings', 'settings', 'Settings', null],
  ] },
];

function navSectionsHtml(sections, route, counts) {
  return sections.map((section) => `<div class="nav-section">
    <div class="nav-label">${section.label}</div>
    <nav class="nav-list" aria-label="${section.label}">
      ${section.items.map(([path, iconName, label, countKey]) => {
        const active = route.path === path || (path === '/task' && route.path === '/task');
        const count = Number.isFinite(Number(countKey))
          ? Number(countKey)
          : (countKey ? Number(counts[countKey] || 0) : null);
        return `<a class="nav-link ${active ? 'active' : ''}" href="#${path}" ${active ? 'aria-current="page"' : ''}>
          ${icon(iconName, 'nav-icon')}<span>${label}</span>${count !== null ? `<span class="nav-count">${count}</span>` : ''}
        </a>`;
      }).join('')}
    </nav>
  </div>`).join('');
}

export function renderShell({ route, state, counts, content }) {
  const activeProduct = { label: 'Agentic AI Projects Task Manager', subtitle: 'AI-assisted workflow ledger', mark: 'AI/', route: '/' };
  const selectedProject = state.selectedProjectId === 'all'
    ? null
    : state.projects.find((project) => project.id === state.selectedProjectId);
  const scopeTitle = selectedProject?.name || 'All projects';
  const scopeSubtitle = selectedProject
    ? (selectedProject.taskRootPath || selectedProject.status || 'Connected')
    : `${state.projects.length} connected task system${state.projects.length === 1 ? '' : 's'}`;
  const nav = navSectionsHtml(NAV_SECTIONS, route, counts);
  const scopeOptions = [`<button type="button" class="scope-menu-item ${state.selectedProjectId === 'all' ? 'active' : ''}" data-select-project="all"><span>All projects</span><small>Aggregate every connected system</small></button>`]
    .concat(state.projects.map((project) => `<button type="button" class="scope-menu-item ${state.selectedProjectId === project.id ? 'active' : ''}" data-select-project="${escapeHtml(project.id)}"><span>${escapeHtml(project.name)}</span><small>${escapeHtml(project.taskRootPath || project.status || 'Not scanned')}</small></button>`))
    .join('');
  const healthy = state.projects.filter((project) => project.status === 'healthy').length;
  const sidebarHeader = `<div class="sidebar-header">
          <div class="brand ${route.path === '/settings' ? 'brand-settings' : ''}"><div class="brand-mark" aria-label="${escapeHtml(activeProduct.label)}">${escapeHtml(activeProduct.mark)}</div><div class="brand-name"><strong>${escapeHtml(activeProduct.label)}</strong><span>${escapeHtml(activeProduct.subtitle)}</span></div></div>
        </div>`;
  const projectScopeNav = route.path !== '/settings'
    ? `<div class="nav-section"><div class="nav-label">Project scope</div><div class="scope-control">
        <button class="scope-switcher" type="button" aria-label="Change project scope" aria-expanded="false" data-scope-toggle>
          <span class="scope-avatar">${escapeHtml((scopeTitle[0] || 'A').toUpperCase())}</span>
          <span class="scope-copy"><strong>${escapeHtml(scopeTitle)}</strong><span>${escapeHtml(scopeSubtitle)}</span></span>${icon('chevron', 'icon icon-sm')}
        </button>
        <div class="scope-menu" data-scope-menu hidden>${scopeOptions}<a href="#/projects" class="scope-menu-footer">Manage projects</a></div>
      </div></div>`
    : '';
  const sidebarNav = route.path === '/settings'
    ? `<div class="nav-section"><nav class="nav-list" aria-label="Back"><a class="nav-link" href="#/">${icon('back', 'nav-icon')}<span>Back to task manager</span></a></nav></div>
       <div class="nav-section"><div class="nav-label">Settings</div><nav class="nav-list" aria-label="Settings">
          <a class="nav-link active" href="#/settings" aria-current="page">${icon('settings', 'nav-icon')}<span>General</span></a>
          <a class="nav-link" href="#/projects">${icon('projects', 'nav-icon')}<span>Projects</span><span class="nav-count">${Number(counts.projects || 0)}</span></a>
        </nav></div>
       <div class="nav-section"><div class="nav-label">Task workflow</div><nav class="nav-list" aria-label="Task workflow">
          <a class="nav-link" href="#/settings?section=questions">${icon('questions', 'nav-icon')}<span>Question answers</span></a>
          <a class="nav-link" href="#/settings?section=verification">${icon('verification', 'nav-icon')}<span>Verification</span></a>
          <a class="nav-link" href="#/settings?section=watching">${icon('activity', 'nav-icon')}<span>File watching</span></a>
        </nav></div>`
    : `${projectScopeNav}${nav}`;
  const sidebarFooter = `<div class="watcher"><span class="watcher-dot ${healthy ? '' : 'inactive'}"></span><span class="watcher-copy"><strong>${state.settings.autoScan ? 'Watching task folders' : 'Automatic scans disabled'}</strong><span>${healthy} healthy of ${state.projects.length}</span></span><span class="watcher-time">${state.projects.length ? formatRelativeTime(Math.max(...state.projects.map((project) => project.lastScanAt || 0))) : '—'}</span></div>`;
  return `<div class="app-shell">
    <aside class="sidebar-region" aria-label="Primary navigation">
      <div class="sidebar">
        ${sidebarHeader}
        <div class="sidebar-nav">${sidebarNav}</div>
        <div class="sidebar-footer">${sidebarFooter}</div>
      </div>
    </aside>
    <div class="main-region">
      <header class="mobile-topbar"><a class="mobile-brand" href="#${activeProduct.route}"><span class="brand-mark">${escapeHtml(activeProduct.mark)}</span><span>${escapeHtml(activeProduct.label)}</span></a><button class="icon-btn" type="button" data-open-drawer aria-expanded="false" aria-label="Open navigation menu">${icon('menu')}</button></header>
      <button class="drawer-scrim" type="button" aria-label="Close navigation"></button>
      <main class="console-main" id="main-content">${content}</main>
    </div>
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <div id="dialog-root"></div>`;
}

export function pageHeader({ kicker, title, description, actions = '' }) {
  return `<header class="page-header"><div class="page-heading"><span class="page-kicker">${escapeHtml(kicker)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><div class="header-actions">${actions}</div></header>`;
}

export function projectStatusText(project) {
  if (!project.lastScanAt) return 'Not scanned';
  if (project.status === 'setup-required') return 'Setup required';
  if (project.status === 'setup-incomplete') return 'Setup incomplete';
  if (project.status === 'conflict') return 'Setup conflict';
  return formatRelativeTime(project.lastScanAt);
}

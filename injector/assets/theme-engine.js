/*!
 * Freebuff Theme Studio - injected client engine
 *
 * Loaded into the Freebuff Desktop renderer (http://127.0.0.1:<port>/) by
 * FreebuffThemeInjector.exe. Mounts a shadow-DOM control panel that overrides
 * Freebuff's CSS custom properties (the 212 tokens that drive the whole UI).
 *
 * Overrides are applied as INLINE styles on <html>, which outrank every
 * stylesheet rule the app ships (including :root[data-theme=light]).
 *
 * Persistence: cookies are host-scoped (not port-scoped), and Freebuff picks a
 * fresh ephemeral port on every launch, so cookies are the only store that
 * survives a restart. We chunk across several cookies if the theme is large and
 * mirror to localStorage as a same-session fallback.
 */
;(function () {
  'use strict'

  var VERSION = '1.4.1'
  if (window.__FREEBUFF_THEME_STUDIO__) return
  window.__FREEBUFF_THEME_STUDIO__ = VERSION

  /* ------------------------------------------------------------------ *
   * Update channel
   *
   * Freebuff's page CSP has no style-src and no default-src, so a remote
   * stylesheet still loads - but connect-src blocks fetch() to GitHub. A
   * stylesheet is enough though: the file below only *declares* the latest
   * version as a custom property, and getComputedStyle() can read that even
   * when the CSSOM of a cross-origin sheet is off limits. So the check needs
   * neither CORS nor a proxy, and it degrades to silence if it ever fails.
   *
   * The feed is served by jsDelivr rather than raw.githubusercontent.com,
   * because raw serves every .css as text/plain with X-Content-Type-Options:
   * nosniff - and a browser refuses to apply a cross-origin stylesheet that is
   * not text/css. jsDelivr sends text/css, and it is the same GitHub file.
   * ------------------------------------------------------------------ */

  /*
   * The same file on jsDelivr's three edge networks. They are the same content
   * behind the same path, but they fail independently, so one dead CDN no
   * longer means the update check goes quiet for good.
   */
  var FEED_PATH = '/gh/RichardFlp/freebuff-ui@main/update.css'
  var FEED_HOSTS = ['https://cdn.jsdelivr.net', 'https://fastly.jsdelivr.net', 'https://gcore.jsdelivr.net']
  /*
   * A fourth edge that is not jsDelivr. The three jsDelivr networks have been
   * seen serving three different versions of this file at the same moment, and
   * a release that only reaches a stale edge is a release nobody is told about
   * - which is how "auto update does not work" starts. Taking the newest answer
   * from every host, including one with a day-long cache instead of a week-long
   * one, means one fresh host is enough.
   */
  var FEED_MIRRORS = ['https://cdn.statically.io/gh/RichardFlp/freebuff-ui@main/update.css']
  var FEED_URLS = FEED_HOSTS.map(function (h) { return h + FEED_PATH }).concat(FEED_MIRRORS)
  var UPDATE_FEED = FEED_HOSTS[0] + FEED_PATH
  var RELEASES_URL = 'https://github.com/RichardFlp/freebuff-ui/releases/tag/v'
  var UPDATE_PROBE = 'data-fbts-update-probe'
  var REMOTE_VERSION_VAR = '--fbts-remote-version'
  var SKIP_COOKIE = 'fbts_update_skip'
  var CHECK_COOKIE = 'fbts_update_check'
  /* The Delete button's request to be removed. It carries the fbts prefix on
   * purpose: the guard only opens a jar that holds something of ours, and its
   * clear pass deletes fbts% - so the request is found and wiped by the same
   * machinery as the theme. The value is the epoch-millisecond timestamp of the
   * click, which is what tells a live request apart from one left over by an
   * install that is already gone - and it is digits only, because a ':' would
   * be stored percent-encoded. */
  var UNINSTALL_COOKIE = 'fbts_uninstall'
  var CHECK_SEEN_COOKIE = 'fbts_update_seen'
  // Hourly, not six-hourly: the old interval plus a once-per-session check
  // meant a release could sit unnoticed for most of a day.
  var CHECK_INTERVAL = 60 * 60 * 1000
  var CHECK_POLL = 20 * 60 * 1000
  var CHECK_TIMEOUT = 8000

  var COOKIE_PREFIX = 'fbts_theme'
  var COOKIE_COUNT = 'fbts_theme_n'
  var LS_KEY = 'freebuff-theme-studio:v1'
  var RAW_STYLE_ID = 'freebuff-theme-studio-raw'
  var PAGE_STYLE_ID = 'freebuff-theme-studio-page'
  var COOKIE_DAYS = 3650

  /*
   * Cookie chunking, and why the sizes look the way they do.
   *
   * A browser refuses any cookie whose whole name+value+attributes exceed
   * 4096 bytes, and it does so silently. The old code chunked the raw JSON at
   * 3200 characters, which looked safe and was not: encodeURIComponent turns
   * every `"`, `{`, `}` and `:` into three bytes, so a JSON chunk of 3200
   * characters lands around 6000 bytes encoded and gets thrown away. The
   * counter cookie still said how many chunks to expect, the next load could
   * not find one of them, and the theme came back unchanged - which is exactly
   * the "saving does not work" report.
   *
   * So the payload is base64url-encoded before it is chunked. Base64url uses
   * only A-Z a-z 0-9 - and _, none of which encodeURIComponent touches, so the
   * encoded length equals the raw length and a 3400-character chunk is really
   * 3400 bytes. Base64 grows the payload by a third, which is a fine price for
   * knowing exactly how big it will be.
   */
  var COOKIE_CHUNK = 3400
  var COOKIE_MAX_THEME_CHUNKS = 3
  var COOKIE_MAX_RAW = 900

  /*
   * Why the theme budget is two chunks and nothing else is stored.
   *
   * Cookies are sent with every single request, and Freebuff's UI is served by
   * a Bun server on loopback (uWebSockets underneath) that answers HTTP 431 -
   * Request Header Fields Too Large - once the request header block passes
   * 16 KB. Measured against the bundled Bun 1.4.2: a 16,000-byte Cookie header
   * is fine, 24,000 gets a 431. A 431 on the document request means the app
   * never renders and the window stays empty and grey - and no uninstall or
   * repair of the injected files helps, because the offending cookies are still
   * in the profile. That is the reported "installed a custom picture, now I get
   * a grey window" bug.
   *
   * Three chunks is 10.2 KB, which holds a theme with every preset token and a
   * large layout map overridden, with room for the app's own cookie jar on top.
   * Pictures are not stored in cookies at all; see the note on pictures below.
   * A save goes to a fresh generation beside the old one, so the worst case is
   * one old series of at most 10.2 KB plus the new one - still inside the
   * budget, and the old series is deleted in the same save.
   */
  /* Cookie series written by 1.3.2 and earlier, which stored pictures in
   * cookies. They are read once and then removed for good. */
  var DEAD_SERIES = ['fbts_img', 'fbts_logo']

  /* ------------------------------------------------------------------ *
   * Token registry
   * ------------------------------------------------------------------ */

  function t(name, label, group, kind) {
    return { name: name, label: label || name.replace(/^--/, ''), group: group, kind: kind || 'color' }
  }

  var CURATED = [
    // Surfaces
    t('--bg', 'App background', 'Surfaces'),
    t('--workspace-surface', 'Workspace background', 'Surfaces'),
    t('--chrome', 'Window chrome', 'Surfaces'),
    t('--shell-base', 'Shell base', 'Surfaces'),
    t('--surface', 'Panel surface', 'Surfaces'),
    t('--surface-2', 'Panel surface 2', 'Surfaces'),
    t('--raised', 'Raised surface', 'Surfaces'),
    t('--popover', 'Popover / menu', 'Surfaces'),
    t('--input', 'Input field', 'Surfaces'),
    t('--selected', 'Selected row', 'Surfaces'),
    t('--bubble', 'Chat bubble', 'Surfaces'),
    t('--control-bg', 'Control background', 'Surfaces'),
    t('--sidebar-canvas', 'Sidebar background', 'Surfaces'),
    t('--sidebar-row-background', 'Sidebar row', 'Surfaces'),
    t('--sidebar-hover', 'Sidebar row hover', 'Surfaces'),
    t('--sidebar-selected', 'Sidebar row selected', 'Surfaces'),
    t('--tab-track', 'Tab bar track', 'Surfaces'),
    t('--tab-active-surface', 'Active tab', 'Surfaces'),
    t('--terminal-background', 'Terminal background', 'Surfaces'),

    // Text
    t('--text', 'Primary text', 'Text'),
    t('--muted', 'Muted text', 'Text'),
    t('--faint', 'Faint text', 'Text'),
    t('--placeholder', 'Placeholder text', 'Text'),
    t('--accent', 'Accent (text/controls)', 'Text'),
    t('--accent-dim', 'Accent dim', 'Text'),
    t('--sidebar-ink', 'Sidebar text', 'Text'),
    t('--sidebar-muted', 'Sidebar muted text', 'Text'),
    t('--tab-indicator', 'Tab indicator', 'Text'),
    t('--tab-selected-text', 'Active tab text', 'Text'),
    t('--primary-action-text', 'Primary button text', 'Text'),
    t('--brand-ink', 'Brand ink / links', 'Text'),

    // Brand
    t('--brand-1', 'Brand 1 (light)', 'Brand'),
    t('--brand-2', 'Brand 2 (primary)', 'Brand'),
    t('--brand-3', 'Brand 3 (tint)', 'Brand'),
    t('--brand', 'Brand (alias)', 'Brand'),
    t('--brand-dim', 'Brand dim', 'Brand'),
    t('--primary-action', 'Primary action', 'Brand'),
    t('--green', 'Green / success', 'Brand'),

    // Borders & surfaces edges
    t('--border', 'Border', 'Borders'),
    t('--matte-edge', 'Matte edge', 'Borders'),
    t('--control-border', 'Control border', 'Borders'),
    t('--control-border-hover', 'Control border hover', 'Borders'),
    t('--panel-divider', 'Panel divider', 'Borders'),
    t('--shell-header-divider', 'Shell header divider', 'Borders'),
    t('--sidebar-edge', 'Sidebar edge', 'Borders'),
    t('--workspace-edge', 'Workspace edge', 'Borders'),
    t('--shell-inset', 'Shell inset', 'Borders'),
    t('--scrim', 'Scrim / overlay', 'Borders'),

    // Status
    t('--ok', 'OK', 'Status'),
    t('--success-text', 'Success text', 'Status'),
    t('--warn', 'Warning', 'Status'),
    t('--warning-text', 'Warning text', 'Status'),
    t('--danger', 'Danger', 'Status'),
    t('--danger-text', 'Danger text', 'Status'),
    t('--info', 'Info', 'Status'),
    t('--premium', 'Premium / pro', 'Status'),
    t('--conflict', 'Conflict', 'Status'),
    t('--merged', 'Merged', 'Status'),

    // Syntax
    t('--syntax-comment', 'Comment', 'Syntax'),
    t('--syntax-keyword', 'Keyword', 'Syntax'),
    t('--syntax-string', 'String', 'Syntax'),
    t('--syntax-number', 'Number', 'Syntax'),
    t('--syntax-function', 'Function', 'Syntax'),
    t('--syntax-type', 'Type', 'Syntax'),
    t('--syntax-property', 'Property', 'Syntax'),
    t('--syntax-punctuation', 'Punctuation', 'Syntax'),

    // Effects
    t('--shadow', 'Shadow color', 'Effects'),
    t('--shadow-sm', 'Small shadow', 'Effects', 'text'),
    t('--shadow-md', 'Medium shadow', 'Effects', 'text'),
    t('--shadow-lg', 'Large shadow', 'Effects', 'text'),
    t('--workspace-shadow', 'Workspace shadow', 'Effects', 'text'),
    t('--focus-ring', 'Focus ring', 'Effects', 'text'),
    t('--logo-filter', 'Logo filter', 'Effects', 'text'),

    // Layout
    t('--radius-xs', 'Radius XS', 'Layout', 'size'),
    t('--radius-sm', 'Radius SM', 'Layout', 'size'),
    t('--radius-md', 'Radius MD', 'Layout', 'size'),
    t('--radius-lg', 'Radius LG', 'Layout', 'size'),
    t('--radius-xl', 'Radius XL', 'Layout', 'size'),
    t('--radius-control', 'Radius control', 'Layout', 'size'),
    t('--radius-chrome-control', 'Radius chrome control', 'Layout', 'size'),
    t('--radius-popup', 'Radius popup', 'Layout', 'size'),
    t('--radius-composer', 'Radius composer', 'Layout', 'size'),
    t('--radius-dialog', 'Radius dialog', 'Layout', 'size'),
    t('--radius-block', 'Radius block', 'Layout', 'size'),
    t('--radius-inline', 'Radius inline', 'Layout', 'size'),

    // Typography
    t('--font-sans', 'UI font', 'Typography', 'text'),
    t('--font-mono', 'Mono font', 'Typography', 'text'),
    t('--font-size-caption', 'Size caption', 'Typography', 'size'),
    t('--font-size-label', 'Size label', 'Typography', 'size'),
    t('--font-size-ui', 'Size UI', 'Typography', 'size'),
    t('--font-size-body', 'Size body', 'Typography', 'size'),
    t('--font-size-message', 'Size message', 'Typography', 'size'),
    t('--font-size-title', 'Size title', 'Typography', 'size'),
    t('--font-size-heading', 'Size heading', 'Typography', 'size'),
    t('--font-size-display', 'Size display', 'Typography', 'size'),

    // Sizing
    t('--chat-content-max-width', 'Chat max width', 'Sizing', 'size'),
    t('--explorer-width', 'Explorer width', 'Sizing', 'size'),
    t('--catalog-width', 'Catalog width', 'Sizing', 'size'),
    t('--tabbar-height', 'Tab bar height', 'Sizing', 'size'),
    t('--control-height-md', 'Control height', 'Sizing', 'size'),
    t('--sidebar-row-gap', 'Sidebar row gap', 'Sizing', 'size'),
  ]

  var GROUP_ORDER = [
    'Surfaces',
    'Text',
    'Brand',
    'Borders',
    'Status',
    'Syntax',
    'Effects',
    'Layout',
    'Typography',
    'Sizing',
  ]

  // Every custom property Freebuff ships (scraped from its stylesheet).
  // Exposed in the Advanced tab so nothing is off-limits.
  var ALL_TOKENS = [
    '--accent', '--accent-dim', '--app-corner-inset', '--bg', '--block-header-bg', '--block-shadow',
    '--border', '--brand', '--brand-1', '--brand-2', '--brand-3', '--brand-dim', '--brand-ink',
    '--browser-menu-top', '--bubble', '--catalog-pane', '--catalog-width', '--chat-content-max-width',
    '--chat-gutter', '--chrome', '--clip-radius', '--conflict', '--control-bg', '--control-bg-hover',
    '--control-bg-pressed', '--control-border', '--control-border-hover', '--control-height-lg',
    '--control-height-md', '--control-height-sm', '--control-highlight', '--control-shadow', '--danger',
    '--danger-text', '--diffs-bg', '--diffs-font-family', '--diffs-font-size', '--diffs-gap-block',
    '--diffs-gap-inline', '--diffs-line-height', '--explorer-reserve', '--explorer-visible-width',
    '--explorer-width', '--fade-bottom', '--fade-left', '--fade-right', '--fade-surface', '--fade-top',
    '--faint', '--field-focus', '--focus-halo', '--focus-ring', '--font-mono', '--font-sans',
    '--font-size-body', '--font-size-caption', '--font-size-display', '--font-size-heading',
    '--font-size-label', '--font-size-message', '--font-size-sb-action', '--font-size-sb-headline',
    '--font-size-sb-initial', '--font-size-sb-label', '--font-size-sb-subhead',
    '--font-size-showcase-close', '--font-size-showcase-close-xs', '--font-size-showcase-cta',
    '--font-size-showcase-cta-sm', '--font-size-showcase-label', '--font-size-showcase-sub',
    '--font-size-showcase-sub-md', '--font-size-showcase-sub-sm', '--font-size-showcase-title',
    '--font-size-showcase-title-md', '--font-size-showcase-title-sm', '--font-size-showcase-title-xs',
    '--font-size-title', '--font-size-ui', '--font-weight-bold', '--font-weight-light',
    '--font-weight-medium', '--font-weight-regular', '--font-weight-semibold', '--green', '--hold-tint',
    '--info', '--input', '--logo-filter', '--matte-edge', '--merged', '--message-fill', '--message-ink',
    '--muted', '--native-controls-width', '--new-thread-border', '--new-thread-control', '--ok',
    '--panel-divider', '--placeholder', '--popover', '--premium', '--primary-action',
    '--primary-action-text', '--project-motion-duration', '--project-motion-ease', '--radius',
    '--radius-block', '--radius-chrome-control', '--radius-composer', '--radius-control', '--radius-dialog',
    '--radius-inline', '--radius-lg', '--radius-md', '--radius-popup', '--radius-round', '--radius-sm',
    '--radius-xl', '--radius-xs', '--rail-reserve', '--raised', '--resume-tint', '--sb-cta-fill',
    '--sb-cta-text', '--sb-headline', '--sb-ink', '--sb-surface', '--scrim', '--selected',
    '--settings-card-radius', '--settings-control-radius', '--settings-corner', '--settings-danger',
    '--settings-danger-hover', '--settings-disabled', '--settings-disabled-ink', '--settings-neutral',
    '--settings-neutral-hover', '--settings-neutral-ink', '--settings-popup-radius',
    '--settings-sidebar-width', '--settings-switch-track', '--settings-tab-indicator', '--settings-tab-ink',
    '--settings-tab-track', '--shadow', '--shadow-lg', '--shadow-md', '--shadow-sm', '--shell-base',
    '--shell-header-divider', '--shell-inset', '--shell-rail-width', '--sidebar-canvas', '--sidebar-edge',
    '--sidebar-hover', '--sidebar-ink', '--sidebar-muted', '--sidebar-row-background',
    '--sidebar-row-font-size', '--sidebar-row-font-weight', '--sidebar-row-gap', '--sidebar-row-radius',
    '--sidebar-selected', '--space-0', '--space-1', '--space-2', '--space-3', '--space-4', '--space-5',
    '--space-6', '--space-7', '--space-8', '--splash-fade', '--success-text', '--surface', '--surface-2',
    '--syntax-comment', '--syntax-function', '--syntax-keyword', '--syntax-number', '--syntax-property',
    '--syntax-punctuation', '--syntax-string', '--syntax-type', '--tab-active-surface', '--tab-gap',
    '--tab-height', '--tab-indicator', '--tab-new-space', '--tab-selected-text', '--tab-track',
    '--tabbar-height', '--tabbar-inset', '--tail-clearance', '--terminal-background', '--text',
    '--thinking-reveal', '--tint', '--title-fade', '--transcript-fade-bottom', '--transcript-fade-top',
    '--transcript-pad-top', '--update-line-height', '--user-line-height', '--warn', '--warning-text',
    '--workspace-corner', '--workspace-edge', '--workspace-shadow', '--workspace-surface',
  ]

  /* ------------------------------------------------------------------ *
   * Presets
   * ------------------------------------------------------------------ */

  // Compact palette -> full token map. Keeps each preset readable.
  function palette(p) {
    var out = {
      '--bg': p.bg,
      '--workspace-surface': p.bg,
      '--shell-base': p.shell || p.bg,
      '--chrome': p.shell || p.bg,
      '--surface': p.surface,
      '--surface-2': p.surface2,
      '--raised': p.raised || p.surface2,
      '--popover': p.raised || p.surface2,
      '--input': p.surface2,
      '--bubble': p.surface2,
      '--control-bg': p.surface2,
      '--border': p.border,
      '--matte-edge': p.edge,
      '--control-border': p.edge,
      '--panel-divider': p.border,
      '--shell-header-divider': p.border,
      '--sidebar-edge': p.border,
      '--workspace-edge': p.border,
      '--text': p.text,
      '--muted': p.muted,
      '--faint': p.faint,
      '--placeholder': p.faint,
      '--accent': p.accent,
      '--accent-dim': p.accentDim,
      '--sidebar-ink': p.text,
      '--sidebar-muted': p.muted,
      '--brand-1': p.brand1 || p.brand,
      '--brand-2': p.brand2 || p.brand,
      '--brand-3': p.brand3 || p.brand,
      '--brand': p.brand,
      '--brand-dim': p.brandDim,
      '--brand-ink': p.brandInk || p.brand,
      '--primary-action': p.primary || p.brand,
      '--primary-action-text': p.primaryText || p.bg,
      '--green': p.ok,
      '--ok': p.ok,
      '--success-text': p.ok,
      '--warn': p.warn,
      '--warning-text': p.warnText || p.warn,
      '--danger': p.danger,
      '--danger-text': p.dangerText || p.danger,
      '--info': p.info,
      '--premium': p.premium || p.warn,
      '--conflict': p.warn,
      '--merged': p.merged || p.info,
      '--selected': p.selected || p.raised || p.surface2,
      '--tab-track': p.shell || p.bg,
      '--tab-active-surface': p.surface,
      '--tab-indicator': p.text,
      '--tab-selected-text': p.bg,
      '--sidebar-canvas': p.shell || p.bg,
      '--sidebar-row-background': p.surface,
      '--sidebar-hover': p.surface2,
      '--sidebar-selected': p.raised || p.surface2,
      '--terminal-background': p.terminal || p.bg,
      '--scrim': p.scrim,
      '--logo-filter': p.logoFilter || 'none',
      '--shadow': p.scrim,
      '--syntax-comment': p.syn.comment,
      '--syntax-keyword': p.syn.keyword,
      '--syntax-string': p.syn.string,
      '--syntax-number': p.syn.number,
      '--syntax-function': p.syn.fn,
      '--syntax-type': p.syn.type,
      '--syntax-property': p.syn.prop,
      '--syntax-punctuation': p.syn.punct,
    }
    for (var k in out) if (out[k] === undefined || out[k] === null) delete out[k]
    return out
  }

  // The palette Freebuff ships with, straight from its own :root block. It is
  // only used to draw the Default thumbnail.
  var STOCK_COLORS = {
    '--bg': '#0a0a0a',
    '--surface': '#171717',
    '--surface-2': '#1c1c1c',
    '--chrome': '#0f0f0f',
    '--text': '#ebebeb',
    '--muted': '#9e9e9e',
    '--brand': '#b5cea5',
  }

  var PRESETS = [
    // `scheme: null` means "whatever appearance the app itself is set to".
    { id: 'default', label: 'Freebuff Default', scheme: null, colors: null },

    {
      id: 'midnight', label: 'Midnight Blue', scheme: 'dark',
      colors: palette({
        bg: '#0b1220', shell: '#0e1626', surface: '#131c2e', surface2: '#1a2438', raised: '#212d45',
        border: '#243149', edge: 'rgba(120,170,255,0.10)', text: '#e2e8f4', muted: '#94a3bd',
        faint: '#6b7b96', accent: '#8ab4ff', accentDim: '#5c7ba8', brand: '#5b8cff', brandDim: '#4a75d8',
        primaryText: '#08101f', ok: '#4ade80', warn: '#fbbf24', danger: '#f87171', info: '#60a5fa',
        merged: '#c084fc', scrim: 'rgba(0,0,0,0.72)',
        syn: { comment: '#5a6b85', keyword: '#8ab4ff', string: '#7dd3a0', number: '#f0a868', fn: '#7cc7ff', type: '#c9a6f2', prop: '#8fd6cf', punct: '#94a3bd' },
      }),
    },
    {
      id: 'nord', label: 'Nord', scheme: 'dark',
      colors: palette({
        bg: '#2e3440', shell: '#2b303b', surface: '#3b4252', surface2: '#434c5e', raised: '#4c566a',
        border: '#4c566a', edge: 'rgba(216,222,233,0.10)', text: '#eceff4', muted: '#d8dee9',
        faint: '#aebacf', accent: '#88c0d0', accentDim: '#81a1c1', brand: '#88c0d0', brandDim: '#8fbcbb',
        primaryText: '#2e3440', ok: '#a3be8c', warn: '#ebcb8b', danger: '#bf616a', info: '#81a1c1',
        merged: '#b48ead', scrim: 'rgba(0,0,0,0.7)',
        syn: { comment: '#616e88', keyword: '#81a1c1', string: '#a3be8c', number: '#b48ead', fn: '#88c0d0', type: '#8fbcbb', prop: '#d8dee9', punct: '#eceff4' },
      }),
    },
    {
      id: 'dracula', label: 'Dracula', scheme: 'dark',
      colors: palette({
        bg: '#21222c', shell: '#1e1f29', surface: '#282a36', surface2: '#343746', raised: '#44475a',
        border: '#44475a', edge: 'rgba(255,255,255,0.10)', text: '#f8f8f2', muted: '#bfc2cf',
        faint: '#8b8fa8', accent: '#bd93f9', accentDim: '#9d78d6', brand: '#bd93f9', brandDim: '#a679e0',
        primaryText: '#1e1f29', ok: '#50fa7b', warn: '#f1fa8c', danger: '#ff5555', info: '#8be9fd',
        merged: '#ff79c6', scrim: 'rgba(0,0,0,0.72)',
        syn: { comment: '#6272a4', keyword: '#ff79c6', string: '#f1fa8c', number: '#bd93f9', fn: '#50fa7b', type: '#8be9fd', prop: '#f8f8f2', punct: '#ff79c6' },
      }),
    },
    {
      id: 'tokyo-night', label: 'Tokyo Night', scheme: 'dark',
      colors: palette({
        bg: '#1a1b26', shell: '#16161e', surface: '#1f2335', surface2: '#292e42', raised: '#343b58',
        border: '#2f334d', edge: 'rgba(122,162,247,0.10)', text: '#c0caf5', muted: '#9aa5ce',
        faint: '#565f89', accent: '#7aa2f7', accentDim: '#3d59a1', brand: '#7aa2f7', brandDim: '#bb9af7',
        primaryText: '#16161e', ok: '#9ece6a', warn: '#e0af68', danger: '#f7768e', info: '#7dcfff',
        merged: '#bb9af7', scrim: 'rgba(0,0,0,0.75)',
        syn: { comment: '#565f89', keyword: '#bb9af7', string: '#9ece6a', number: '#ff9e64', fn: '#7aa2f7', type: '#2ac3de', prop: '#73daca', punct: '#89ddff' },
      }),
    },
    {
      id: 'gruvbox', label: 'Gruvbox Dark', scheme: 'dark',
      colors: palette({
        bg: '#1d2021', shell: '#181a1b', surface: '#282828', surface2: '#32302f', raised: '#3c3836',
        border: '#504945', edge: 'rgba(235,219,178,0.10)', text: '#ebdbb2', muted: '#bdae93',
        faint: '#928374', accent: '#fabd2f', accentDim: '#d79921', brand: '#fabd2f', brandDim: '#d65d0e',
        primaryText: '#1d2021', ok: '#b8bb26', warn: '#fabd2f', danger: '#fb4934', info: '#83a598',
        merged: '#d3869b', scrim: 'rgba(0,0,0,0.72)',
        syn: { comment: '#928374', keyword: '#fb4934', string: '#b8bb26', number: '#d3869b', fn: '#8ec07c', type: '#fabd2f', prop: '#83a598', punct: '#ebdbb2' },
      }),
    },
    {
      id: 'one-dark', label: 'One Dark', scheme: 'dark',
      colors: palette({
        bg: '#1e2227', shell: '#1a1d21', surface: '#21252b', surface2: '#282c34', raised: '#333842',
        border: '#3a4049', edge: 'rgba(171,178,191,0.10)', text: '#abb2bf', muted: '#8b929e',
        faint: '#6b727d', accent: '#61afef', accentDim: '#528bff', brand: '#61afef', brandDim: '#4d78cc',
        primaryText: '#1e2227', ok: '#98c379', warn: '#e5c07b', danger: '#e06c75', info: '#56b6c2',
        merged: '#c678dd', scrim: 'rgba(0,0,0,0.72)',
        syn: { comment: '#5c6370', keyword: '#c678dd', string: '#98c379', number: '#d19a66', fn: '#61afef', type: '#e5c07b', prop: '#e06c75', punct: '#abb2bf' },
      }),
    },
    {
      id: 'catppuccin-mocha', label: 'Catppuccin Mocha', scheme: 'dark',
      colors: palette({
        bg: '#11111b', shell: '#181825', surface: '#1e1e2e', surface2: '#313244', raised: '#45475a',
        border: '#45475a', edge: 'rgba(205,214,244,0.10)', text: '#cdd6f4', muted: '#a6adc8',
        faint: '#7f849c', accent: '#89b4fa', accentDim: '#74a0e0', brand: '#cba6f7', brandDim: '#89b4fa',
        primaryText: '#11111b', ok: '#a6e3a1', warn: '#f9e2af', danger: '#f38ba8', info: '#89dceb',
        merged: '#f5c2e7', scrim: 'rgba(0,0,0,0.75)',
        syn: { comment: '#6c7086', keyword: '#cba6f7', string: '#a6e3a1', number: '#fab387', fn: '#89b4fa', type: '#f9e2af', prop: '#89dceb', punct: '#cdd6f4' },
      }),
    },
    {
      id: 'rose-pine', label: 'Rose Pine', scheme: 'dark',
      colors: palette({
        bg: '#191724', shell: '#1f1d2e', surface: '#1f1d2e', surface2: '#26233a', raised: '#403d52',
        border: '#403d52', edge: 'rgba(224,222,244,0.10)', text: '#e0def4', muted: '#a9a5c0',
        faint: '#6e6a86', accent: '#c4a7e7', accentDim: '#9ccfd8', brand: '#ebbcba', brandDim: '#c4a7e7',
        primaryText: '#191724', ok: '#31748f', warn: '#f6c177', danger: '#eb6f92', info: '#9ccfd8',
        merged: '#c4a7e7', scrim: 'rgba(0,0,0,0.72)',
        syn: { comment: '#6e6a86', keyword: '#c4a7e7', string: '#f6c177', number: '#ebbcba', fn: '#9ccfd8', type: '#31748f', prop: '#eb6f92', punct: '#e0def4' },
      }),
    },
    {
      id: 'cyberpunk', label: 'Cyberpunk Neon', scheme: 'dark',
      colors: palette({
        bg: '#0a0a12', shell: '#08080f', surface: '#12121f', surface2: '#1b1b2e', raised: '#26264a',
        border: '#3a1f5c', edge: 'rgba(0,255,240,0.14)', text: '#e6f7ff', muted: '#9fb8d0',
        faint: '#6b7f96', accent: '#00fff0', accentDim: '#00b3a8', brand: '#ff2e97', brandDim: '#00fff0',
        primaryText: '#08080f', ok: '#00ff9d', warn: '#ffd400', danger: '#ff3860', info: '#00d9ff',
        merged: '#c77dff', scrim: 'rgba(0,0,0,0.8)',
        syn: { comment: '#5b6b7f', keyword: '#ff2e97', string: '#00ff9d', number: '#ffd400', fn: '#00fff0', type: '#c77dff', prop: '#00d9ff', punct: '#9fb8d0' },
      }),
    },
    {
      id: 'matrix', label: 'Matrix Terminal', scheme: 'dark',
      colors: palette({
        bg: '#000a00', shell: '#000600', surface: '#04140a', surface2: '#08210f', raised: '#0d3016',
        border: '#1a4d24', edge: 'rgba(0,255,65,0.16)', text: '#b9ffb9', muted: '#5fbf6a',
        faint: '#3c8c46', accent: '#00ff41', accentDim: '#00b32e', brand: '#00ff41', brandDim: '#00c734',
        primaryText: '#000a00', ok: '#00ff41', warn: '#b6ff00', danger: '#ff5f5f', info: '#00ffa3',
        merged: '#7dff8a', scrim: 'rgba(0,20,0,0.8)',
        syn: { comment: '#2f7a38', keyword: '#00ff41', string: '#a6ff4d', number: '#7dff8a', fn: '#00ff9c', type: '#b6ff00', prop: '#00d97e', punct: '#5fbf6a' },
      }),
    },
    {
      id: 'amber-crt', label: 'Amber CRT', scheme: 'dark',
      colors: palette({
        bg: '#120b03', shell: '#0d0802', surface: '#1c1206', surface2: '#26190a', raised: '#332211',
        border: '#43301a', edge: 'rgba(255,176,0,0.16)', text: '#ffd9a0', muted: '#c79449',
        faint: '#8c6a33', accent: '#ffb000', accentDim: '#c98a00', brand: '#ffb000', brandDim: '#e09a00',
        primaryText: '#120b03', ok: '#ffd166', warn: '#ff8c00', danger: '#ff6b35', info: '#ffcf70',
        merged: '#ffa94d', scrim: 'rgba(20,10,0,0.8)',
        syn: { comment: '#8c6a33', keyword: '#ffb000', string: '#ffd166', number: '#ff8c00', fn: '#ffc04d', type: '#ffdf9e', prop: '#e0a33a', punct: '#c79449' },
      }),
    },
    {
      id: 'solarized-light', label: 'Solarized Light', scheme: 'light',
      colors: palette({
        bg: '#fdf6e3', shell: '#eee8d5', surface: '#fdf6e3', surface2: '#eee8d5', raised: '#e3ddc9',
        border: '#ded8c4', edge: 'rgba(88,110,117,0.14)', text: '#073642', muted: '#586e75',
        faint: '#93a1a1', accent: '#268bd2', accentDim: '#586e75', brand: '#268bd2', brandDim: '#2aa198',
        primaryText: '#fdf6e3', ok: '#859900', warn: '#b58900', danger: '#dc322f', info: '#2aa198',
        merged: '#d33682', scrim: 'rgba(0,43,54,0.35)', logoFilter: 'brightness(0) invert(0.15)',
        syn: { comment: '#93a1a1', keyword: '#859900', string: '#2aa198', number: '#d33682', fn: '#268bd2', type: '#b58900', prop: '#268bd2', punct: '#586e75' },
      }),
    },
    {
      id: 'catppuccin-latte', label: 'Catppuccin Latte', scheme: 'light',
      colors: palette({
        bg: '#e6e9ef', shell: '#dce0e8', surface: '#eff1f5', surface2: '#e6e9ef', raised: '#dce0e8',
        border: '#d3d7e0', edge: 'rgba(76,79,105,0.12)', text: '#4c4f69', muted: '#6c6f85',
        faint: '#8c8fa1', accent: '#1e66f5', accentDim: '#7287fd', brand: '#8839ef', brandDim: '#1e66f5',
        primaryText: '#eff1f5', ok: '#40a02b', warn: '#df8e1d', danger: '#d20f39', info: '#04a5e5',
        merged: '#ea76cb', scrim: 'rgba(76,79,105,0.3)', logoFilter: 'brightness(0) invert(0.2)',
        syn: { comment: '#9ca0b0', keyword: '#8839ef', string: '#40a02b', number: '#fe640b', fn: '#1e66f5', type: '#df8e1d', prop: '#04a5e5', punct: '#6c6f85' },
      }),
    },
    {
      id: 'high-contrast', label: 'High Contrast', scheme: 'dark',
      colors: palette({
        bg: '#000000', shell: '#000000', surface: '#0a0a0a', surface2: '#141414', raised: '#1f1f1f',
        border: '#6b6b6b', edge: 'rgba(255,255,255,0.5)', text: '#ffffff', muted: '#e0e0e0',
        faint: '#bdbdbd', accent: '#ffffff', accentDim: '#c9c9c9', brand: '#ffe600', brandDim: '#ffd000',
        primaryText: '#000000', ok: '#3cff7a', warn: '#ffd000', danger: '#ff4d4d', info: '#6ec8ff',
        merged: '#e58cff', scrim: 'rgba(0,0,0,0.9)', logoFilter: 'brightness(0) invert(1)',
        syn: { comment: '#9e9e9e', keyword: '#ff9cf0', string: '#7dff9e', number: '#ffcc66', fn: '#8ecbff', type: '#ffe066', prop: '#7fe8dd', punct: '#ffffff' },
      }),
    },
    {
      id: 'vaporwave', label: 'Vaporwave', scheme: 'dark',
      colors: palette({
        bg: '#1a1033', shell: '#140b28', surface: '#241547', surface2: '#2f1b5c', raised: '#3d2475',
        border: '#4b2c8f', edge: 'rgba(255,113,206,0.16)', text: '#f5e6ff', muted: '#c0a3e0',
        faint: '#8f74b8', accent: '#ff71ce', accentDim: '#b967ff', brand: '#01cdfe', brandDim: '#ff71ce',
        primaryText: '#1a1033', ok: '#05ffa1', warn: '#fffb96', danger: '#ff3d6e', info: '#01cdfe',
        merged: '#b967ff', scrim: 'rgba(10,4,24,0.78)',
        syn: { comment: '#7a6ba8', keyword: '#ff71ce', string: '#05ffa1', number: '#fffb96', fn: '#01cdfe', type: '#b967ff', prop: '#84ffe1', punct: '#c0a3e0' },
      }),
    },
  ]

  var PRESET_BY_ID = {}
  PRESETS.forEach(function (p) {
    PRESET_BY_ID[p.id] = p
  })

  /* ------------------------------------------------------------------ *
   * Color helpers
   * ------------------------------------------------------------------ */

  function clamp255(n) {
    return Math.max(0, Math.min(255, Math.round(n)))
  }

  function parseColor(input) {
    if (!input) return null
    var s = String(input).trim().toLowerCase()
    var m = /^#([0-9a-f]{3,8})$/.exec(s)
    if (m) {
      var h = m[1]
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
      if (h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]
      if (h.length !== 6 && h.length !== 8) return null
      return {
        hex: '#' + h.slice(0, 6),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      }
    }
    m = /^rgba?\(([^)]+)\)$/.exec(s)
    if (m) {
      var parts = m[1].split(/[\s,/]+/).filter(Boolean)
      if (parts.length < 3 || parts.length > 4) return null
      function channel(part) {
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(part)) return NaN
        var n = parseFloat(part)
        return /%$/.test(part) ? n * 2.55 : n
      }
      var r = channel(parts[0])
      var g = channel(parts[1])
      var b = channel(parts[2])
      var a = 1
      if (parts.length === 4) {
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(parts[3])) return null
        a = parseFloat(parts[3])
        if (/%$/.test(parts[3])) a /= 100
      }
      if (!isFinite(r) || !isFinite(g) || !isFinite(b) || !isFinite(a)) return null
      return { hex: rgbToHex(r, g, b), a: bound(a, 0, 1) }
    }
    return null
  }

  function rgbToHex(r, g, b) {
    return (
      '#' +
      [r, g, b]
        .map(function (v) {
          return clamp255(v).toString(16).padStart(2, '0')
        })
        .join('')
    )
  }

  function toCss(color) {
    if (!color) return ''
    if (typeof color === 'string') return color
    var alpha = color.a == null ? 1 : bound(Number(color.a), 0, 1)
    if (!isFinite(alpha) || alpha >= 1) return color.hex
    var r = parseInt(color.hex.slice(1, 3), 16)
    var g = parseInt(color.hex.slice(3, 5), 16)
    var b = parseInt(color.hex.slice(5, 7), 16)
    return 'rgb(' + r + ' ' + g + ' ' + b + ' / ' + Math.round(alpha * 100) + '%)'
  }

  /* ------------------------------------------------------------------ *
   * Palette adjustments
   *
   * The dials in the Presets tab retune whatever palette is in use: hue turn,
   * saturation, brightness, contrast, and a separate lift for text tokens.
   * They run on the finished colour map, so they work the same on a preset, on
   * hand-picked overrides, or on both at once.
   * ------------------------------------------------------------------ */

  var DEFAULT_ADJUST = { hue: 0, sat: 100, bright: 100, contrast: 100, text: 100 }

  var ADJUST_DEFS = [
    { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, unit: '\u00b0' },
    { key: 'sat', label: 'Saturation', min: 0, max: 200, step: 1, unit: '%' },
    { key: 'bright', label: 'Brightness', min: 50, max: 150, step: 1, unit: '%' },
    { key: 'contrast', label: 'Contrast', min: 50, max: 150, step: 1, unit: '%' },
    { key: 'text', label: 'Text', min: 50, max: 150, step: 1, unit: '%' },
  ]

  var TEXT_TOKENS = [
    '--text', '--muted', '--faint', '--placeholder', '--sidebar-ink', '--sidebar-muted',
    '--tab-indicator', '--tab-selected-text', '--primary-action-text', '--brand-ink',
  ]

  function isTextToken(name) {
    return TEXT_TOKENS.indexOf(name) !== -1 || /-text$/.test(name) || /ink$/.test(name)
  }

  function bound(n, lo, hi) {
    return n < lo ? lo : n > hi ? hi : n
  }

  function hexToHsl(hex) {
    var r = parseInt(hex.slice(1, 3), 16) / 255
    var g = parseInt(hex.slice(3, 5), 16) / 255
    var b = parseInt(hex.slice(5, 7), 16) / 255
    var max = Math.max(r, g, b)
    var min = Math.min(r, g, b)
    var l = (max + min) / 2
    var h = 0
    var s = 0
    if (max !== min) {
      var d = max - min
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
      else if (max === g) h = ((b - r) / d + 2) * 60
      else h = ((r - g) / d + 4) * 60
    }
    return { h: h, s: s * 100, l: l * 100 }
  }

  /*
   * The in-page colour picker works in HSV, because that is what a saturation
   * square and a hue strip need. The Colour Spots and the Colors tab both go
   * through it, so picking a colour never depends on a native dialog.
   */
  function rgbToHsv(r, g, b) {
    r /= 255
    g /= 255
    b /= 255
    var max = Math.max(r, g, b)
    var min = Math.min(r, g, b)
    var d = max - min
    var h = 0
    if (d) {
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
      else if (max === g) h = ((b - r) / d + 2) * 60
      else h = ((r - g) / d + 4) * 60
    }
    return { h: h, s: max ? (d / max) * 100 : 0, v: max * 100 }
  }

  function hsvToHex(h, s, v) {
    s /= 100
    v /= 100
    var c = v * s
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1))
    var m = v - c
    var rgb
    if (h < 60) rgb = [c, x, 0]
    else if (h < 120) rgb = [x, c, 0]
    else if (h < 180) rgb = [0, c, x]
    else if (h < 240) rgb = [0, x, c]
    else if (h < 300) rgb = [x, 0, c]
    else rgb = [c, 0, x]
    return rgbToHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255)
  }

  function hsvaCss(hsv, a) {
    return toCss({ hex: hsvToHex(hsv.h, hsv.s, hsv.v), a: a })
  }

  function hslToHex(hsl) {
    var h = ((hsl.h % 360) + 360) % 360 / 360
    var s = bound(hsl.s, 0, 100) / 100
    var l = bound(hsl.l, 0, 100) / 100
    function f(n) {
      var k = (n + h * 12) % 12
      var a = s * Math.min(l, 1 - l)
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    }
    return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255)
  }

  function adjustmentsActive() {
    return !adjustIsDefault(state.adjust)
  }

  /** Retune one colour value. Anything unparseable (var(), color-mix(), px) is left alone. */
  function adjustColor(value, token) {
    var c = parseColor(value)
    if (!c) return value
    var hsl = hexToHsl(c.hex)
    var a = state.adjust
    if (a.hue) hsl.h = (hsl.h + a.hue) % 360
    if (a.sat !== 100) hsl.s = hsl.s * (a.sat / 100)
    if (a.bright !== 100) hsl.l = hsl.l * (a.bright / 100)
    if (a.contrast !== 100) hsl.l = (hsl.l - 50) * (a.contrast / 100) + 50
    if (a.text !== 100 && isTextToken(token)) hsl.l = hsl.l * (a.text / 100)
    return toCss({ hex: hslToHex(hsl), a: c.a })
  }

  /** Resolve a token to a concrete rgb()/rgba() by letting the browser compute it. */
  var probeEl = null
  function resolveTokenColor(token) {
    if (!probeEl) {
      probeEl = document.createElement('span')
      probeEl.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0;height:0'
      ;(document.body || document.documentElement).appendChild(probeEl)
    }
    probeEl.style.color = ''
    probeEl.style.color = 'var(' + token + ')'
    var computed = getComputedStyle(probeEl).color || ''
    var parsed = parseColor(computed)
    if (parsed) return parsed
    return parseColor(getComputedStyle(document.documentElement).getPropertyValue(token))
  }

  /* ------------------------------------------------------------------ *
   * State + persistence
   * ------------------------------------------------------------------ */

  /*
   * Pictures, and the size they are allowed to be.
   *
   * A picture is a data URL, and that string ends up twice over: once in the
   * page stylesheet as a background-image for the renderer to decode, and once
   * in localStorage. A 2 MB photo is a 2.7 MB data URL, which is more than any
   * renderer should be asked to paint, and it makes a .fbtheme file that is
   * awkward to send to anyone. So every picture is re-encoded to a budget on
   * the way in - 2560 px on the long side and about 150 KB for a background,
   * 640 px and 40 KB for a logo - and re-encoded only when it is over budget,
   * so a small PNG keeps its pixels and transparency.
   */
  var IMAGE_KINDS = {
    background: { maxSide: 2560, maxBytes: 150 * 1024, minSide: 640, lossy: true },
    logo: { maxSide: 640, maxBytes: 40 * 1024, minSide: 160, lossy: false },
  }
  /* A picture above this is never painted, whatever the state says. Only a
   * version before the budgets could have stored one, and a data URL that big
   * is a decode the renderer does not need to do. */
  var PAINT_MAX_BYTES = 1200 * 1024

  /*
   * A background picture. `image` is a data URL so it travels inside the theme
   * file and needs no hosting; the rest is how it is painted.
   */
  var DEFAULT_BACKGROUND = { image: '', fit: 'cover', position: 'center', opacity: 1, dim: 0, whole: false }
  /* A replacement mark for Freebuff's own, as an SVG, PNG or JPEG data URL. */
  var DEFAULT_LOGO = { image: '', size: 1, opacity: 1, filter: '' }
  /* The minimise / maximise / close buttons. '' means "leave it to the theme". */
  var DEFAULT_WINDOW = { ink: '', hoverBg: '', hoverInk: '', closeBg: '', closeInk: '' }

  /*
   * Editor behaviour, kept with the theme so it travels with a .fbtheme file
   * and is restored with it.
   *
   *   followThemeAppearance - a theme may switch Freebuff's own light/dark
   *     appearance to match its palette. On by default, because a dark theme
   *     on an app left in light mode was exactly the half-applied look this
   *     was added to fix. Off leaves the app's own setting alone.
   *   autoUpdate - the quiet hourly check for a newer release. The button on
   *     the Settings tab always works whatever this says.
   */
  var DEFAULT_SETTINGS = { followThemeAppearance: true, autoUpdate: true }

  var DEFAULT_STATE = {
    v: 1,
    name: 'Custom',
    preset: 'default',
    colors: {},
    layout: {},
    gradients: {},
    background: clone(DEFAULT_BACKGROUND),
    logo: clone(DEFAULT_LOGO),
    window: clone(DEFAULT_WINDOW),
    raw: '',
    scheme: '',
    adjust: clone(DEFAULT_ADJUST),
    settings: clone(DEFAULT_SETTINGS),
  }

  function clone(o) {
    return JSON.parse(JSON.stringify(o))
  }

  /**
   * Only accept an inline image data URL.
   *
   * A remote URL would be a fetch the page cannot make (connect-src blocks it),
   * and a data:text/html URL would be an injection. SVG is allowed because it is
   * the format people will actually want for a logo, but a script inside one is
   * not.
   */
  function decodeSvgDataUrl(s) {
    var comma = s.indexOf(',')
    if (comma < 0) return ''
    var header = s.slice(0, comma)
    var body = s.slice(comma + 1)
    try {
      if (/;base64$/i.test(header)) {
        var binary = atob(body.replace(/\s+/g, ''))
        var bytes = new Uint8Array(binary.length)
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      }
      return decodeURIComponent(body)
    } catch (e) {
      return ''
    }
  }

  function safeSvgText(svg) {
    if (!svg || /<!DOCTYPE|<!ENTITY/i.test(svg)) return false
    var doc
    try {
      doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    } catch (e) {
      return false
    }
    if (!doc || doc.querySelector('parsererror') || !doc.documentElement || doc.documentElement.localName !== 'svg') return false
    var active = /^(script|foreignobject|iframe|object|embed|animate|animatemotion|animatetransform|set)$/i
    var nodes = doc.querySelectorAll('*')
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i]
      if (active.test(node.localName || node.nodeName)) return false
      for (var j = 0; j < node.attributes.length; j++) {
        var attr = node.attributes[j]
        var name = String(attr.name || '').toLowerCase()
        var value = String(attr.value || '')
        if (/^on[a-z]/i.test(name)) return false
        if ((name === 'href' || name === 'xlink:href') && value && value.charAt(0) !== '#') return false
        if (/javascript:|expression\s*\(|@import|url\s*\((?!\s*['\"]?#)/i.test(value)) return false
      }
      if (node.localName === 'style' && /javascript:|expression\s*\(|@import|url\s*\((?!\s*['\"]?#)/i.test(node.textContent || '')) return false
    }
    return true
  }

  function cleanDataUrl(v) {
    var s = typeof v === 'string' ? v.trim() : ''
    if (!s || s.length > 12 * 1024 * 1024) return ''
    var m = /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)(?:;charset=[a-z0-9._-]+)?(?:;base64)?,/i.exec(s)
    if (!m) return ''
    if (/^data:image\/svg\+xml/i.test(s)) {
      var svg = decodeSvgDataUrl(s)
      if (!safeSvgText(svg)) return ''
    }
    return s
  }

  function dataUrlBytes(s) {
    return typeof s === 'string' ? s.length : 0
  }

  function imageOverBudget(url, kind) {
    if (!url) return false
    var limit = IMAGE_KINDS[kind] || IMAGE_KINDS.background
    return dataUrlBytes(url) > limit.maxBytes
  }

  /*
   * Fitting a picture to its budget.
   *
   * Only pictures that are over budget are touched at all: a small PNG keeps
   * its pixels and its transparency, and an animated GIF stays animated. What
   * is over budget is scaled down and re-encoded until it fits, keeping the
   * aspect ratio, and never below minSide so a wallpaper does not turn into a
   * thumbnail. WebP is used when the browser can encode it (it can, in every
   * Electron this runs in) and JPEG otherwise; the logo stays PNG so a
   * transparent mark is not filled in with black.
   */
  var webpOk = null

  function canEncodeWebp() {
    if (webpOk === null) {
      try {
        var probe = document.createElement('canvas')
        probe.width = probe.height = 1
        webpOk = probe.toDataURL('image/webp').indexOf('data:image/webp') === 0
      } catch (e) {
        webpOk = false
      }
    }
    return webpOk
  }

  function fitImage(src, kind, cb) {
    var limit = IMAGE_KINDS[kind] || IMAGE_KINDS.background
    var settled = false
    function done(v) {
      if (settled) return
      settled = true
      cb(v)
    }
    if (!src) return done('')
    var img = new Image()
    img.onerror = function () { done(null) }
    img.onload = function () {
      try {
        var w = img.naturalWidth || img.width || 0
        var h = img.naturalHeight || img.height || 0
        if (!w || !h) return done(cleanDataUrl(src))
        var mime = limit.lossy && canEncodeWebp() ? 'image/webp' : 'image/png'
        var scale = Math.min(1, limit.maxSide / Math.max(w, h))
        var best = null
        for (var round = 0; round < 9; round++) {
          var sw = Math.max(1, Math.round(w * scale))
          var sh = Math.max(1, Math.round(h * scale))
          var canvas = document.createElement('canvas')
          canvas.width = sw
          canvas.height = sh
          var ctx = canvas.getContext('2d')
          if (!ctx) break
          ctx.drawImage(img, 0, 0, sw, sh)
          var qualities = mime === 'image/webp' ? [0.85, 0.72, 0.6] : [null]
          for (var q = 0; q < qualities.length; q++) {
            var candidate = qualities[q] === null ? canvas.toDataURL(mime) : canvas.toDataURL(mime, qualities[q])
            if (!candidate || candidate.indexOf('data:image/') !== 0) continue
            if (!best || dataUrlBytes(candidate) < dataUrlBytes(best)) best = candidate
            if (dataUrlBytes(candidate) <= limit.maxBytes) return done(candidate)
          }
          if (Math.max(sw, sh) <= limit.minSide) break
          scale *= 0.7
        }
        // Never pass an image over the stated budget into persistent state.
        done(best && dataUrlBytes(best) <= limit.maxBytes ? best : null)
      } catch (e) {
        done(null)
      }
    }
    img.src = src
  }

  /** Re-encode the pictures inside a theme down to their budget, in place. */
  function shrinkThemeImages(s, cb) {
    var jobs = []
    if (s.background && imageOverBudget(s.background.image, 'background')) jobs.push(['background', s.background])
    if (s.logo && imageOverBudget(s.logo.image, 'logo')) jobs.push(['logo', s.logo])
    if (!jobs.length) return cb(false)
    var left = jobs.length
    var changed = false
    jobs.forEach(function (job) {
      fitImage(job[1].image, job[0], function (fitted) {
        if (fitted && fitted !== job[1].image) {
          job[1].image = fitted
          changed = true
        } else if (!fitted) {
          job[1].image = ''
          changed = true
        }
        if (--left === 0) cb(changed)
      })
    })
  }

  /**
   * A picture a version before the budgets stored is dropped rather than drawn:
   * nothing needs a multi-megabyte data URL in the page, and the state is saved
   * back without it so the next launch starts clean.
   */
  function dropOversizedImages(s) {
    var dropped = []
    if (s.background && dataUrlBytes(s.background.image) > PAINT_MAX_BYTES) {
      s.background.image = ''
      dropped.push('background picture')
    }
    if (s.logo && dataUrlBytes(s.logo.image) > PAINT_MAX_BYTES) {
      s.logo.image = ''
      dropped.push('logo')
    }
    return dropped
  }

  /*
   * Legacy themes.
   *
   * Everything a theme file carries is written into a stylesheet, and the
   * layout map of a theme made by an older version was never checked at all -
   * a stray `}`, `;` or `/*` in one value was enough to end the declaration
   * and leak the rest of the map onto unrelated selectors, which is what made
   * old themes render as a scrambled panel with doubled chrome. Values are now
   * validated before they are used, and anything that cannot be a plain CSS
   * value is dropped instead.
   */
  var TOKEN_NAME_RE = /^--[a-z0-9][a-z0-9-]*$/i

  function balanced(s, open, close) {
    var depth = 0
    for (var i = 0; i < s.length; i++) {
      if (s[i] === open) depth++
      else if (s[i] === close) {
        depth--
        if (depth < 0) return false
      }
    }
    return depth === 0
  }

  /** Quotes come in pairs, so an even count is a closed one. Counting beats
   *  depth here: an opening quote and a closing one are the same character. */
  function quotesClosed(s, q) {
    var n = 0
    for (var i = 0; i < s.length; i++) if (s[i] === q) n++
    return n % 2 === 0
  }

  function sanitizeLayoutValue(name, value) {
    if (!TOKEN_NAME_RE.test(String(name || ''))) return ''
    var s = value == null ? '' : String(value)
    s = s.replace(/[\r\n\t]+/g, ' ').trim()
    if (!s || s.length > 240) return ''
    if (/[;{}<>]/.test(s)) return ''
    if (s.indexOf('!') >= 0) return ''
    if (s.indexOf('\\') >= 0) return ''
    if (/\/\*/.test(s)) return ''
    if (/url\s*\(|expression\s*\(|@import|javascript:|var\s*\(\s*--fbts/i.test(s)) return ''
    if (!balanced(s, '(', ')')) return ''
    if (!quotesClosed(s, '"')) return ''
    if (!quotesClosed(s, "'")) return ''
    return s
  }

  /** Keep only the layout entries that are safe to write into CSS. */
  function filterLayout(raw) {
    var out = {}
    if (!raw || typeof raw !== 'object') return out
    for (var k in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, k)) continue
      var v = sanitizeLayoutValue(k, raw[k])
      if (v !== '') out[k] = v
    }
    return out
  }

  /** Colours are kept as {hex, a}: a theme file cannot smuggle CSS in a colour. */
  function normalizeColors(raw) {
    var out = {}
    if (!raw || typeof raw !== 'object') return out
    for (var k in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, k) || !TOKEN_NAME_RE.test(k)) continue
      var entry = raw[k]
      var c = parseColor(entry && entry.hex ? entry.hex : entry)
      if (!c) continue
      out[k] = { hex: c.hex, a: num(entry && entry.a, 0, 1, c.a) }
    }
    return out
  }

  /** Only a plain CSS filter, which is what the logo box takes. */
  function sanitizeFilter(v) {
    var s = typeof v === 'string' ? v.trim() : ''
    if (!s || s.length > 120) return ''
    if (!/^[a-z0-9 .%,#()-]+$/i.test(s)) return ''
    if (!balanced(s, '(', ')')) return ''
    return s
  }

  /** A final gate for anything interpolated into the page stylesheet. */
  function safeCss(v) {
    var s = typeof v === 'string' ? v.trim() : ''
    if (!s || s.length > 400) return ''
    if (/[;{}<>]/.test(s) || s.indexOf('\\') >= 0 || /\/\*/.test(s)) return ''
    return s
  }

  function num(v, lo, hi, fallback) {
    if (v == null || v === '') return fallback
    var n = Number(v)
    if (!isFinite(n)) return fallback
    return Math.min(hi, Math.max(lo, n))
  }

  function oneOf(v, list, fallback) {
    return list.indexOf(v) >= 0 ? v : fallback
  }

  function normalizeGradients(raw) {
    var out = {}
    if (!raw || typeof raw !== 'object') return out
    for (var k in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, k) || !TOKEN_NAME_RE.test(k)) continue
      var g = raw[k]
      if (!g || typeof g !== 'object') continue
      var fromColor = parseColor(g.from && g.from.hex)
      var toColor = parseColor(g.to && g.to.hex)
      var from = fromColor ? { hex: fromColor.hex, a: num(g.from.a, 0, 1, fromColor.a) } : null
      var to = toColor ? { hex: toColor.hex, a: num(g.to.a, 0, 1, toColor.a) } : null
      if (!from || !to) continue
      out[k] = {
        type: oneOf(g.type, ['linear', 'radial'], 'linear'),
        angle: num(g.angle, 0, 360, 160),
        from: from,
        to: to,
      }
    }
    return out
  }

  function normalizeState(raw) {
    var s = clone(DEFAULT_STATE)
    if (raw && typeof raw === 'object') {
      if (raw.name) s.name = String(raw.name).trim().slice(0, 80) || 'Custom'
      if (raw.preset && PRESET_BY_ID[String(raw.preset)]) s.preset = String(raw.preset)
      if (raw.colors && typeof raw.colors === 'object') s.colors = normalizeColors(raw.colors)
      if (raw.layout && typeof raw.layout === 'object') s.layout = filterLayout(raw.layout)
      s.gradients = normalizeGradients(raw.gradients)
      if (raw.background && typeof raw.background === 'object') {
        var b = raw.background
        s.background = {
          image: cleanDataUrl(b.image),
          fit: oneOf(b.fit, ['cover', 'contain', 'tile', 'stretch'], 'cover'),
          position: oneOf(b.position, ['center', 'top', 'bottom', 'left', 'right'], 'center'),
          opacity: num(b.opacity, 0, 1, 1),
          dim: num(b.dim, 0, 0.9, 0),
          whole: b.whole === true,
        }
      }
      if (raw.logo && typeof raw.logo === 'object') {
        s.logo = {
          image: cleanDataUrl(raw.logo.image),
          size: num(raw.logo.size, 0.25, 3, 1),
          opacity: num(raw.logo.opacity, 0, 1, 1),
          filter: sanitizeFilter(raw.logo.filter),
        }
      }
      if (raw.window && typeof raw.window === 'object') {
        var w = {}
        for (var wk in DEFAULT_WINDOW) {
          var wv = raw.window[wk]
          var wc = wv ? parseColor(wv) : null
          w[wk] = wc ? toCss(wc) : ''
        }
        s.window = w
      }
      if (typeof raw.raw === 'string') s.raw = raw.raw.slice(0, 256 * 1024)
      else if (raw.raw != null) s.raw = ''
      if (raw.scheme === 'light' || raw.scheme === 'dark') s.scheme = raw.scheme
      if (raw.settings && typeof raw.settings === 'object') {
        for (var sk in DEFAULT_SETTINGS) {
          if (Object.prototype.hasOwnProperty.call(raw.settings, sk) && typeof raw.settings[sk] === 'boolean') {
            s.settings[sk] = raw.settings[sk]
          }
        }
      }
      s.adjust = normalizeAdjust(raw.adjust)
    }
    return s
  }

  /** Only real numbers, clamped to the dial range, so nothing can poison the palette. */
  function normalizeAdjust(raw) {
    var out = clone(DEFAULT_ADJUST)
    if (raw && typeof raw === 'object') {
      ADJUST_DEFS.forEach(function (d) {
        if (!Object.prototype.hasOwnProperty.call(raw, d.key) || raw[d.key] == null || raw[d.key] === '') return
        var v = Number(raw[d.key])
        if (isFinite(v)) out[d.key] = bound(v, d.min, d.max)
      })
    }
    return out
  }

  function adjustIsDefault(a) {
    if (!a) return true
    for (var i = 0; i < ADJUST_DEFS.length; i++) {
      if (Number(a[ADJUST_DEFS[i].key]) !== DEFAULT_ADJUST[ADJUST_DEFS[i].key]) return false
    }
    return true
  }

  /* ------------------------------------------------------------------ *
   * Sharing
   *
   * Two ways out, because neither alone is convenient: a .fbtheme file for
   * keeping or sending as an attachment, and a one-line share code that can
   * be pasted into a chat that would mangle multi-line JSON. Both are read
   * back by the same parser, which also still accepts the bare theme objects
   * that older versions wrote out.
   * ------------------------------------------------------------------ */

  var SHARE_PREFIX = 'FBT1.'
  var THEME_FORMAT = 'fbtheme'

  function toBase64Url(str) {
    var bytes = new TextEncoder().encode(str)
    var bin = ''
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }

  function fromBase64Url(s) {
    var b = String(s).replace(/-/g, '+').replace(/_/g, '/')
    while (b.length % 4) b += '='
    var bin = atob(b)
    var bytes = new Uint8Array(bin.length)
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  }

  /** The body of a .fbtheme file: a small envelope around the theme. */
  function themeDocument(s) {
    return {
      format: THEME_FORMAT,
      formatVersion: 1,
      app: 'Freebuff Theme Studio v' + VERSION,
      created: new Date().toISOString(),
      theme: s,
    }
  }

  /** A .fbtheme document carries the theme itself under `theme`. */
  function unwrapTheme(obj) {
    if (obj && typeof obj === 'object' && obj.theme && typeof obj.theme === 'object' && !obj.colors && !obj.layout) {
      return obj.theme
    }
    return obj
  }

  /**
   * Reads a theme out of anything a user might paste or open: a share code, a
   * .fbtheme document, or a bare theme object.
   */
  function parseThemeText(text) {
    var raw = String(text == null ? '' : text).trim()
    if (!raw) throw new Error('nothing to read')
    if (raw.length > 12 * 1024 * 1024) throw new Error('theme is too large')
    if (raw.indexOf(SHARE_PREFIX) === 0) {
      raw = fromBase64Url(raw.slice(SHARE_PREFIX.length).replace(/\s+/g, ''))
    }
    if (raw.length > 8 * 1024 * 1024) throw new Error('theme is too large')
    var obj = unwrapTheme(JSON.parse(raw))
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not a theme')
    return normalizeState(obj)
  }

  /** Short one-line code. A preset-only theme comes out tiny. */
  function shareCode(s) {
    var out = {
      v: 1,
      name: s.name || 'Custom',
      preset: s.preset || 'default',
      colors: s.colors || {},
      layout: s.layout || {},
    }
    if (s.raw) out.raw = s.raw
    if (s.scheme) out.scheme = s.scheme
    if (!adjustIsDefault(s.adjust)) out.adjust = normalizeAdjust(s.adjust)
    if (s.gradients && Object.keys(s.gradients).length) out.gradients = s.gradients
    if (s.logo && s.logo.image) out.logo = s.logo
    if (s.background && s.background.image) out.background = s.background
    if (s.window && windowIsSet(s.window)) out.window = s.window
    // Only the non-default editor settings travel: a theme that says nothing
    // about them should leave the reader's own choices alone.
    if (s.settings) {
      var changed = {}
      for (var sk in DEFAULT_SETTINGS) {
        if (s.settings[sk] !== DEFAULT_SETTINGS[sk]) changed[sk] = s.settings[sk]
      }
      if (Object.keys(changed).length) out.settings = changed
    }
    return SHARE_PREFIX + toBase64Url(JSON.stringify(out))
  }

  function windowIsSet(w) {
    for (var k in DEFAULT_WINDOW) if (w[k]) return true
    return false
  }

  function themeFileName(name) {
    var slug = String(name || 'theme')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    return (slug || 'theme') + '.' + THEME_FORMAT
  }

  function readCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'))
    if (!m) return null
    try {
      return decodeURIComponent(m[1])
    } catch (e) {
      return m[1]
    }
  }

  function writeCookie(name, value, days) {
    var exp = new Date(Date.now() + days * 86400000).toUTCString()
    document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + exp + '; path=/; SameSite=Lax'
    cookiesUsable = readCookie(name) === String(value)
    return cookiesUsable
  }

  function eraseCookie(name) {
    document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax'
  }

  /**
   * The count cookie, which is the only thing a reader trusts.
   *
   * It holds "<generation>:<count>". A plain number is a series written by
   * 1.3.2 or earlier, which had no generation and so is generation 0.
   */
  function parseSeriesCount(countName) {
    var raw = readCookie(countName) || ''
    var m = /^(\d+):(\d+)$/.exec(raw)
    if (m) {
      var gen = Number(m[1])
      var count = Number(m[2])
      return {
        gen: Number.isSafeInteger(gen) ? gen : 0,
        count: Number.isSafeInteger(count) && count >= 0 && count <= 24 ? count : 0,
      }
    }
    if (!/^\\d+$/.test(raw)) return { gen: 0, count: 0 }
    var n = Number(raw)
    return { gen: 0, count: Number.isSafeInteger(n) && n > 0 && n <= 24 ? n : 0 }
  }

  function chunkName(prefix, gen, i) {
    return prefix + '_' + (gen ? gen + '_' + i : i)
  }

  /**
   * Write a base64url payload across the named cookie series. Returns false
   * when it does not fit, so the caller can say so instead of pretending.
   *
   * The chunks of a new save go to a fresh generation and the count cookie is
   * switched to it in one write, so the previous save stays complete and
   * readable until the new one is. An earlier version published the count as 0
   * first and then rewrote the chunks in place: killing Freebuff in that window
   * - which is exactly what one report did - erased the theme, and the next
   * launch then saved the default over it.
   */
  function writeSeries(prefix, countName, b64, maxChunks) {
    var chunks = []
    for (var p = 0; p < b64.length; p += COOKIE_CHUNK) chunks.push(b64.slice(p, p + COOKIE_CHUNK))
    if (b64.length && chunks.length > maxChunks) return false
    if (!b64.length) {
      // An empty payload is a deliberate wipe, not a zero-chunk save that a
      // reader would then treat as corrupt.
      clearSeries(prefix, countName)
      return true
    }
    var prev = parseSeriesCount(countName)
    var gen = prev.gen >= Number.MAX_SAFE_INTEGER ? 1 : prev.gen + 1
    for (var idx = 0; idx < chunks.length; idx++) {
      if (!writeCookie(chunkName(prefix, gen, idx), chunks[idx], COOKIE_DAYS)) {
        for (var cleanup = 0; cleanup < maxChunks; cleanup++) eraseCookie(chunkName(prefix, gen, cleanup))
        return false
      }
    }
    // A killed earlier save may have left extra chunks for this generation.
    // Clear unused indices before publishing it, or stale chunks keep riding
    // every request even though the count no longer references them.
    for (var stale = chunks.length; stale < maxChunks; stale++) eraseCookie(chunkName(prefix, gen, stale))
    if (!writeCookie(countName, gen + ':' + chunks.length, COOKIE_DAYS)) {
      for (var cleanup = 0; cleanup < maxChunks; cleanup++) eraseCookie(chunkName(prefix, gen, cleanup))
      return false
    }
    // Only now is the previous generation dead weight. Prune abandoned writes
    // too, so interrupted generations cannot grow the request header forever.
    var active = {}
    for (var keep = 0; keep < chunks.length; keep++) active[chunkName(prefix, gen, keep)] = true
    var prefixWithSeparator = prefix + '_'
    document.cookie.split(';').forEach(function (entry) {
      var name = entry.trim().split('=')[0]
      if (name.indexOf(prefixWithSeparator) !== 0) return
      var parts = name.slice(prefixWithSeparator.length).split('_')
      var isChunk = parts.length === 1 ? /^\d+$/.test(parts[0]) :
        parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])
      if (isChunk && !active[name]) eraseCookie(name)
    })
    eraseCookie(prefix)
    return true
  }

  function readSeries(prefix, countName) {
    var s = parseSeriesCount(countName)
    if (!(s.count > 0)) return null
    var parts = []
    for (var i = 0; i < s.count; i++) {
      var c = readCookie(chunkName(prefix, s.gen, i))
      if (c === null) return null
      parts.push(c)
    }
    return parts.join('')
  }

  function seriesPresent(countName) {
    return readCookie(countName) !== null
  }

  function saveToCookies(payload) {
    try {
      return writeSeries(COOKIE_PREFIX, COOKIE_COUNT, toBase64Url(payload), COOKIE_MAX_THEME_CHUNKS)
    } catch (e) {
      return false
    }
  }

  function clearSeries(prefix, countName) {
    // The counter may be missing or damaged. Enumerate the actual cookie jar
    // too, otherwise orphaned chunks can keep contributing to every header.
    var withSeparator = prefix + '_'
    document.cookie.split(';').forEach(function (entry) {
      var name = entry.trim().split('=')[0]
      if (name === prefix || name.indexOf(withSeparator) === 0) eraseCookie(name)
    })
    eraseCookie(prefix)
    eraseCookie(countName)
  }

  /** Reads a picture series an older version wrote, for the one-time drain. */
  function loadBlobFromCookies(prefix, countName) {
    try {
      var b64 = readSeries(prefix, countName)
      return b64 ? fromBase64Url(b64) : ''
    } catch (e) {
      return ''
    }
  }

  /**
   * Remove a picture series an earlier version wrote. This is not just
   * tidiness: those cookies are resent with every request, and a series big
   * enough to push the header block over 16 KB is what leaves the app on a
   * blank window. Whatever is in them is read once (so an existing picture is
   * not lost mid-session) and then thrown away.
   */
  function drainDeadSeries(s) {
    var found = []
    DEAD_SERIES.forEach(function (prefix) {
      var countName = prefix + '_n'
      var value = loadBlobFromCookies(prefix, countName)
      if (value) found.push({ prefix: prefix, value: value })
      clearSeries(prefix, countName)
    })
    if (!found.length) return s
    // The background series was the only one that ever shipped, so the first
    // picture found belongs to the background.
    for (var i = 0; i < found.length; i++) {
      var recovered = cleanDataUrl(found[i].value)
      if (found[i].prefix === 'fbts_img' && s.background && !s.background.image) s.background.image = recovered
      if (found[i].prefix === 'fbts_logo' && s.logo && !s.logo.image) s.logo.image = recovered
    }
    return s
  }

  function loadFromCookies() {
    var b64 = null
    try {
      b64 = readSeries(COOKIE_PREFIX, COOKIE_COUNT)
    } catch (e) {}
    if (b64 !== null) {
      try {
        return JSON.parse(fromBase64Url(b64))
      } catch (e) {}
    }
    // Themes written before this version are plain JSON in the same cookies.
    var legacy = null
    try {
      legacy = readSeriesRaw(COOKIE_PREFIX, COOKIE_COUNT)
    } catch (e) {}
    if (legacy) {
      try {
        return JSON.parse(legacy)
      } catch (e) {}
    }
    return null
  }

  /** The pre-base64 layout: raw JSON, one character per byte, same names. */
  function readSeriesRaw(prefix, countName) {
    if (!seriesPresent(countName)) {
      var single = readCookie(prefix)
      return single || null
    }
    return readSeries(prefix, countName)
  }

  /*
   * Pictures are session-only.
   *
   * A picture is hundreds of kilobytes; a theme is four. There is no cookie
   * budget for a picture that does not also threaten the app's own requests, so
   * pictures are kept exactly where they cannot hurt: in localStorage, for this
   * session, plus inside any .fbtheme file the user exports (and the injector
   * can bake one into the install with --theme, which is how a picture becomes
   * permanent). The panel says so where the picture is picked.
   *
   * "This session" is precise: localStorage is keyed by address *and port*, and
   * Freebuff takes a new port on every launch, so a picture survives a reload
   * and is gone after a restart.
   */
  function withSessionPictures(s) {
    try {
      return drainDeadSeries(s)
    } catch (e) {
      return s
    }
  }

  /** The same-session cache, or null. Never throws, never trusts its shape. */
  function readCachedState() {
    try {
      var ls = localStorage.getItem(LS_KEY)
      if (!ls) return null
      var parsed = JSON.parse(ls)
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch (e) {
      return null
    }
  }

  /**
   * Fold the session pictures out of the cache into a state that came from
   * cookies.
   *
   * The pictures are only ever in the cache - see withSessionPictures - so
   * without this a plain reload (Ctrl+R) would drop them even though the app
   * never restarted. Only pictures are taken from the cache: everything else
   * comes from the cookies, which are the newer copy of it.
   */
  function withCachedPictures(s, cached) {
    if (!cached) return s
    if (s.background && !s.background.image && cached.background) {
      s.background.image = safeCachedPicture(cached.background.image)
    }
    if (s.logo && !s.logo.image && cached.logo) {
      s.logo.image = safeCachedPicture(cached.logo.image)
    }
    return s
  }

  /** A cached picture is only used if it is really an image and not enormous. */
  function safeCachedPicture(v) {
    var url = cleanDataUrl(v)
    if (!url || dataUrlBytes(url) > PAINT_MAX_BYTES) return ''
    return url
  }

  function loadState() {
    var cached = readCachedState()
    var fromCookie = loadFromCookies()
    if (fromCookie) {
      return settleState(withCachedPictures(withSessionPictures(normalizeState(fromCookie)), cached))
    }
    // The count cookie is still there, so a theme was saved and could not be
    // read back. Say so rather than quietly starting from the default - and
    // note that nothing is written over it until the user changes something.
    if (seriesPresent(COOKIE_COUNT)) {
      notifySave('Your saved theme could not be read - nothing was overwritten')
      // The cookies still hold a theme; only a chunk is missing. Do not write
      // the cache or the default over it, or the unreadable theme is gone for
      // good. The flags stay off until the user changes something.
      if (cached) return settleState(withSessionPictures(normalizeState(cached)))
      if (window.__FREEBUFF_THEME_DEFAULT__) {
        return settleState(withCachedPictures(normalizeState(unwrapTheme(window.__FREEBUFF_THEME_DEFAULT__)), null))
      }
      return clone(DEFAULT_STATE)
    }
    if (cached) {
      var parsed = settleState(withSessionPictures(normalizeState(cached)))
      // migrate the same-session cache into cookies for the next launch
      saveStateNow(parsed, true)
      return parsed
    }
    // A theme baked in at install time by the injector (--theme). It may be a
    // bare theme or the same .fbtheme document users save.
    if (window.__FREEBUFF_THEME_DEFAULT__) {
      return settleState(withCachedPictures(normalizeState(unwrapTheme(window.__FREEBUFF_THEME_DEFAULT__)), cached))
    }
    return clone(DEFAULT_STATE)
  }

  /** Ready to paint: a picture a previous version stored unbounded is dropped
   *  rather than handed to the renderer, and whatever is left over is saved
   *  back so the next launch starts clean. */
  function settleState(s) {
    var dropped = dropOversizedImages(s)
    if (dropped.length) {
      notifySave('Dropped an oversized ' + dropped.join(' and ') + ' - it was too big to paint')
      try {
        saveStateNow(s, true)
      } catch (e) {}
    }
    return s
  }

  /*
   * Saving.
   *
   * This used to be a plain trailing debounce: every call pushed the deadline
   * back by 250ms. Dragging a dial or a colour picker fires continuously, so
   * the deadline never arrived while the user was actually moving the mouse,
   * and if the window closed mid-drag nothing had been written at all - which
   * is the second half of "saving does not work".
   *
   * Now it is a throttle with a trailing edge: the first change is written
   * after a short pause, and after SAVE_AT_MOST the state is written whether or
   * not the user is still moving. Every page-hidden event also flushes.
   */
  var saveTimer = null
  var saveFirstAt = 0
  var pending = null
  var SAVE_AFTER = 400
  var SAVE_AT_MOST = 1500
  var saveNotice = null
  var queuedNotice = ''

  /*
   * Nothing is written until something has actually been changed.
   *
   * This is the other half of "my theme is gone after a restart". If a load
   * comes up empty - a chunk that never reached disk, a series a hard kill
   * interrupted - the engine used to boot on the default theme and then save
   * that default at the first touch of any control, destroying the theme that
   * was still sitting in the cookies. Now an untouched boot state is never
   * written, so a theme that failed to load is still there to be recovered.
   */
  var stateDirty = false
  var pictureNoticeShown = false
  // Optimistically attempt the write; unrelated app cookies do not prove that
  // this extension's own cookie can be stored.
  var cookiesUsable = true
  /* Past the point of no return: the theme was cleared as part of the removal
   * request, and a later save would put what the user just deleted back into
   * the cookie jar. */
  var removalRequested = false
  var storageNoticeShown = false
  var rawNoticeShown = false

  /** Say something about a save that could not keep everything. Before the UI
   *  exists the message waits for it instead of being dropped. */
  function notifySave(msg) {
    if (!msg) return
    if (saveNotice) saveNotice(msg)
    else queuedNotice = msg
  }

  /**
   * What the cookie series holds: the theme, with the pictures left out.
   *
   * This is the fix for "my theme and my pictures are gone after a restart".
   * The payload used to carry the background data URL, so a theme with a
   * picture in it was megabytes of JSON against a budget of 24 chunks - around
   * 91 KB. writeSeries() refused it, and refused it *before* touching the old
   * cookies, so nothing was written at all: not the picture, and not one of the
   * colours either. One picture meant the whole theme reverted on restart.
   */
  function cookiePayload(s) {
    var copy = clone(s)
    if (copy.background) copy.background.image = ''
    if (copy.logo) copy.logo.image = ''
    return copy
  }

  function hasPicture(s) {
    return !!((s.background && s.background.image) || (s.logo && s.logo.image))
  }

  function saveStateNow(s, force) {
    if (removalRequested) return false
    if (!stateDirty && !force) return false
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    saveFirstAt = 0

    // localStorage is a same-session cache only - the app takes a fresh port on
    // every launch, so its origin (and this value) does not survive a restart.
    // It has a much larger budget than the cookies do, so the raw CSS box stays
    // in it: only the cookie copy has to fit the header budget.
    var cacheState = clone(s)
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(cacheState))
    } catch (e) {
      var withoutImages = clone(cacheState)
      withoutImages.raw = ''
      if (withoutImages.background) withoutImages.background.image = ''
      if (withoutImages.logo) withoutImages.logo.image = ''
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(withoutImages))
      } catch (e2) {
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(cookiePayload(withoutImages)))
        } catch (e3) {}
      }
    }

    var cookieState = cookiePayload(cacheState)
    var rawDropped = false
    if (cookieState.raw.length > COOKIE_MAX_RAW) {
      cookieState.raw = ''
      rawDropped = true
    }
    var ok = cookiesUsable && saveToCookies(JSON.stringify(cookieState))
    if (ok && rawDropped && !rawNoticeShown) {
      rawNoticeShown = true
      notifySave('Custom CSS kept for this session only - it is too long to store between launches')
    }
    if (!ok && !cookiesUsable) {
      // Electron can be configured to block cookies. Do not report a successful
      // durable save: keep the in-session copy and tell the user it will not
      // survive a full restart.
      if (!storageNoticeShown) {
        storageNoticeShown = true
        notifySave('Cookies are disabled - your theme may not survive a restart')
      }
      return false
    }
    if (!ok) {
      // One oversized field - the raw CSS box, usually - must not cost the
      // colours and the layout along with it.
      var bare = cookiePayload(cacheState)
      bare.raw = ''
      ok = saveToCookies(JSON.stringify(bare))
      if (ok) notifySave('Saved without the custom CSS - Freebuff cannot carry that much CSS between launches')
    }

    if (!ok) {
      notifySave('This theme is too big to remember - Freebuff cannot carry more')
    } else if (hasPicture(s) && !pictureNoticeShown) {
      // Once per session: the pictures are the one thing cookies cannot hold.
      pictureNoticeShown = true
      notifySave('Picture applied for this session - Export the theme to keep it for good.')
    }
    return ok
  }

  function saveState(s, immediate) {
    stateDirty = true
    pending = s
    if (immediate) return saveStateNow(s)
    if (saveTimer && Date.now() - saveFirstAt > SAVE_AT_MOST) return saveStateNow(s)
    if (saveTimer) clearTimeout(saveTimer)
    else saveFirstAt = Date.now()
    saveTimer = setTimeout(function () {
      saveStateNow(pending)
    }, SAVE_AFTER)
  }

  // A closed tab or a hidden window must not cost the last edit.
  function flushSave() {
    if (pending && saveTimer) saveStateNow(pending)
  }
  window.addEventListener('pagehide', flushSave)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushSave()
  })

  /* ------------------------------------------------------------------ *
   * Applying the theme
   * ------------------------------------------------------------------ */

  var state = loadState()
  var applied = { colors: {}, layout: {} }
  // The app's own data-theme value, captured before the theme ever touched it.
  var appDataTheme = null
  // What the theme wants the app's appearance attribute to say right now.
  var wantedDataTheme = null

  /**
   * Keep the app's own appearance attribute in step with the theme.
   * React rewrites it on a re-render (it is driven by the user's setting), so
   * it is re-asserted here rather than only at apply time.
   */
  function enforceAppThemeAttribute() {
    if (wantedDataTheme === null || !document.documentElement.dataset) return
    if (document.documentElement.dataset.theme !== wantedDataTheme) {
      document.documentElement.dataset.theme = wantedDataTheme
    }
  }

  function watchAppThemeAttribute() {
    if (typeof MutationObserver !== 'function') return
    try {
      new MutationObserver(enforceAppThemeAttribute).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      })
    } catch (e) {}
  }

  function setVar(name, value) {
    document.documentElement.style.setProperty(name, value)
  }

  function unsetVar(name) {
    document.documentElement.style.removeProperty(name)
  }

  /*
   * Gradients.
   *
   * A gradient is stored beside the colour it replaces, under the same token
   * name, and is written into that token. Freebuff paints its surfaces with
   * `background: var(--x)` and never with `background-color: var(--x)`, so a
   * gradient lands correctly almost everywhere. The handful of places that do
   * read one of these tokens as a *colour* would drop the declaration and
   * inherit instead, so those selectors are pinned back to the solid colour.
   */
  var GRADIENT_FALLBACK = {
    '--bg': '.isolated-check, .change-comment-count, .agent-option-ask-action.primary',
    '--surface': '.thread-mention-tip-actions .btn.primary, .question-option-box svg',
  }

  /** The colour a gradient replaced, kept so the fallbacks have something to use. */
  var solidCache = {}

  function gradientCss(g) {
    var from = toCss(g.from)
    var to = toCss(g.to)
    if (g.type === 'radial') return 'radial-gradient(circle at 50% 50%, ' + from + ', ' + to + ')'
    return 'linear-gradient(' + Math.round(g.angle) + 'deg, ' + from + ', ' + to + ')'
  }

  function currentValues() {
    // Order matters: preset is the base, explicit overrides win on top.
    var out = {}
    var preset = state.preset !== 'default' ? PRESET_BY_ID[state.preset] : null
    if (preset && preset.colors) for (var k0 in preset.colors) out[k0] = preset.colors[k0]
    for (var k in state.colors) out[k] = toCss(state.colors[k])
    // Layout values are validated on the way out as well as on the way in: a
    // theme file is not the only thing that can put a value here.
    for (var k2 in state.layout) {
      var lv = sanitizeLayoutValue(k2, state.layout[k2])
      if (lv !== '') out[k2] = lv
    }
    // The dials run last so they retune the finished palette, whatever built it.
    if (adjustmentsActive()) for (var k3 in out) out[k3] = adjustColor(out[k3], k3)
    // Gradients go on after the dials: a gradient string is not a colour, and
    // hue-rotating it would only mean re-parsing it back out again.
    solidCache = {}
    for (var gk in state.gradients) {
      if (typeof out[gk] === 'string') solidCache[gk] = out[gk]
      out[gk] = gradientCss(state.gradients[gk])
    }
    return out
  }

  /**
   * The opaque version of a colour value, so a translucent theme colour can be
   * painted over it instead of vanishing. Accepts a hex, an rgb()/rgba() string
   * or a gradient, and gives back a bare hex - or '' if there is nothing to use.
   */
  function opaqueHex(value) {
    var s = typeof value === 'string' ? value.trim() : ''
    if (!s) return ''
    var direct = parseColor(s)
    if (direct) return direct.hex
    // A gradient, or a colour-mix: take the first colour in it.
    var hexMatch = /#[0-9a-fA-F]{3,8}/.exec(s)
    if (hexMatch) {
      var parsedHex = parseColor(hexMatch[0])
      if (parsedHex) return parsedHex.hex
    }
    var rgbMatch = /rgba?\(([^)]+)\)/.exec(s)
    if (rgbMatch) {
      var parsedRgb = parseColor(rgbMatch[0])
      if (parsedRgb) return parsedRgb.hex
    }
    return ''
  }

  /** The opaque floor for a token: what the theme colour looks like at full strength. */
  function floorFor(token, values) {
    var v = values[token]
    if (typeof v === 'string') {
      var h = opaqueHex(v)
      if (h) return h
    }
    var resolved = resolveTokenColor(token)
    return resolved ? resolved.hex : ''
  }

  /**
   * The same token as a background-image layer: a real gradient goes through
   * untouched, and a plain colour is wrapped so it can be painted as a layer.
   * That wrapper is also what makes a translucent colour work - it composites
   * over the floor instead of replacing it.
   */
  function layerFor(token, values) {
    var v = values[token]
    if (typeof v === 'string' && v) {
      return /gradient\(/i.test(v) ? v : 'linear-gradient(' + v + ', ' + v + ')'
    }
    var c = resolveTokenColor(token)
    if (!c) return 'none'
    var css = toCss(c)
    return 'linear-gradient(' + css + ', ' + css + ')'
  }

  function applyState() {
    var next = currentValues()
    var name
    for (name in applied.colors) if (!(name in next)) unsetVar(name)
    for (name in applied.layout) if (!(name in next)) unsetVar(name)
    applied.colors = {}
    applied.layout = {}
    for (name in next) {
      setVar(name, next[name])
      if (next[name] && typeof next[name] === 'object') applied.colors[name] = true
      else applied.layout[name] = true
    }
    /*
     * The app's own appearance setting, not just ours.
     *
     * `color-scheme` alone was not enough: Freebuff picks its light palette with
     * `:root[data-theme=light]`, and those rules redeclare tokens on the
     * elements that use them, so a dark theme applied while the app was set to
     * light left the settings page, modals and the Theme Studio page itself on
     * the light palette. The theme's scheme is therefore mirrored onto the
     * app's own attribute, and the app's value is remembered so resetting the
     * theme hands it back untouched.
     */
    // The stock preset deliberately has no opinion, so an app set to light is
    // left light; only a real preset or an explicit choice picks a scheme.
    var followAppearance = !state.settings || state.settings.followThemeAppearance !== false
    var schemePreset = state.preset !== 'default' ? PRESET_BY_ID[state.preset] : null
    var scheme = followAppearance ? state.scheme || (schemePreset && schemePreset.scheme) || '' : ''
    var root = document.documentElement
    if (appDataTheme === null) appDataTheme = root.dataset ? root.dataset.theme || '' : ''
    if (scheme === 'light' || scheme === 'dark') {
      root.style.setProperty('color-scheme', scheme)
      wantedDataTheme = scheme
    } else {
      root.style.removeProperty('color-scheme')
      wantedDataTheme = appDataTheme || null
    }
    enforceAppThemeAttribute()
    /*
     * Floors for the editor's own boxes. NOT declared in the shadow stylesheet,
     * because a declaration on :host would shadow these inherited ones - the
     * same trap --workspace-corner fell into.
     */
    setVar('--fbts-floor', floorFor('--bg', next) || '#14151a')
    setVar('--fbts-floor2', floorFor('--chrome', next) || floorFor('--surface', next) || floorFor('--bg', next) || '#14151a')
    setVar('--fbts-bg-layer', layerFor('--bg', next))
    setVar('--fbts-panel2-layer', layerFor('--chrome', next))
    applyRaw()
    applyPageStyles(next)
  }

  function applyRaw() {
    var el = document.getElementById(RAW_STYLE_ID)
    if (!state.raw) {
      if (el) el.remove()
      return
    }
    if (!el) {
      el = document.createElement('style')
      el.id = RAW_STYLE_ID
      document.head.appendChild(el)
    }
    el.textContent = state.raw
  }

  /* ------------------------------------------------------------------ *
   * The page layer
   *
   * Inline styles on <html> cover everything that reads a token from :root.
   * Three things do not, and they are all reported bugs:
   *
   * 1. Freebuff redeclares a handful of tokens on `.desktop-shell`,
   *    `.app-workspace`, `.app`, `.project-sidebar` and `.terminal-panel`. A
   *    declaration on the element that *uses* a token beats one inherited from
   *    an ancestor, so setting `--workspace-corner` on <html> did nothing at
   *    all - which is why the Corner radius buttons only moved some corners.
   *    Those tokens are re-declared here with !important, on a selector list
   *    that covers every element the app does that to.
   * 2. The minimise / maximise / close buttons, the settings page radii and
   *    the logo have no token of their own to set.
   * 3. A background picture is a property, not a custom property.
   *
   * So this layer is a real stylesheet, rewritten whenever the theme changes.
   * ------------------------------------------------------------------ */

  /*
   * Every token the app declares on something other than :root, and where.
   *
   * This used to be one flat list written to one big selector list, which
   * meant every token was forced onto every shell element. A theme made by an
   * older version could then clobber a token the app *computes* per node - the
   * explorer and rail reserves, the native-controls width - and the sidebars,
   * rails and panels would draw over each other. Each token is now
   * re-declared only where the app itself declares it, and the computed ones
   * are left to the app.
   */
  var SHELL_RADII =
    ':root, .desktop-shell, .app-workspace, .app, .project-sidebar, .terminal-panel, .settings-page, .modal'
  var SHELL_TARGETS = {
    // Radii and insets are declared on the element that uses them, so the
    // whole shell has to be covered for one to take effect.
    '--workspace-corner': SHELL_RADII,
    '--shell-inset': SHELL_RADII,
    '--tabbar-height': SHELL_RADII,
    '--settings-card-radius': SHELL_RADII,
    '--settings-control-radius': SHELL_RADII,
    '--settings-popup-radius': SHELL_RADII,
    '--settings-corner': SHELL_RADII,
    '--clip-radius': SHELL_RADII,
    // The rest already belong to the element that paints them.
    '--sidebar-canvas': '.desktop-shell, .project-sidebar',
    '--sidebar-edge': '.desktop-shell, .project-sidebar',
    '--terminal-background': '.desktop-shell, .terminal-panel',
    '--shell-rail-width': '.desktop-shell, .app-workspace, .app',
    '--tab-new-space': '.desktop-shell, .app-workspace, .app',
    '--workspace-edge': '.app-workspace, .app',
    '--workspace-shadow': '.app-workspace, .app',
    '--panel-divider': '.desktop-shell, .app-workspace, .app, .project-sidebar, .terminal-panel',
    '--shell-header-divider': '.desktop-shell, .project-sidebar',
  }

  /*
   * Tokens the app declares on something other than :root.
   *
   * Freebuff ships a light and a dark palette, and the light one is selected by
   * `:root[data-theme=light]` (the app sets that attribute from the user's own
   * appearance setting). On top of that, the app redeclares a large number of
   * tokens on the element that *uses* them - `:is(.settings-page,.modal)`,
   * `.project-sidebar`, `.modal`, `.ad-showcase`, `.catalog`, and so on - and a
   * declaration on the element that uses a token beats one inherited from
   * <html>, however the inline style was set.
   *
   * So a theme could be applied perfectly on <html> and still leave whole
   * regions - the settings page, the Theme Studio page itself, modals, the
   * project sidebar - wearing the app's own light palette. That is the "old
   * theme looks half-applied / panels do not match" report, and no amount of
   * sanitising a stored theme would have fixed it.
   *
   * The list is therefore not hard-coded: when the engine boots it reads the
   * app's own stylesheets (same origin, so their rules are readable) and builds
   * a map of token -> the selectors that declare it outside :root. Every token
   * a theme actually overrides is then re-declared on those exact selectors
   * with !important, which outranks the app's own declaration because the app
   * never uses !important for a custom property (measured: 0 of 408).
   */
  var discoveredTargets = null

  function discoverTokenTargets() {
    if (discoveredTargets) return discoveredTargets
    var map = {}
    var found = 0

    function add(prop, selector) {
      var list = map[prop]
      if (!list) list = map[prop] = []
      if (list.indexOf(selector) === -1 && list.length < 24) {
        list.push(selector)
        found++
      }
    }

    function walk(rules, owner) {
      for (var i = 0; i < rules.length; i++) {
        var rule = rules[i]
        // @media / @supports / @layer: the inner rules carry the declarations.
        if (rule.cssRules && rule.cssRules.length) {
          walk(rule.cssRules, owner)
          continue
        }
        var selector = rule.selectorText
        var style = rule.style
        if (!selector || !style || !style.length) continue
        // A :root/html declaration is already beaten by the inline style.
        if (/^(?::root|html|:where\(:root\))\s*$/i.test(selector.trim())) continue
        for (var j = 0; j < style.length; j++) {
          var prop = style[j]
          if (typeof prop === 'string' && prop.slice(0, 2) === '--') add(prop.toLowerCase(), selector)
        }
      }
    }

    for (var s = 0; s < document.styleSheets.length; s++) {
      var sheet = document.styleSheets[s]
      var rules = null
      try {
        rules = sheet.cssRules
      } catch (e) {
        // A cross-origin sheet cannot be read; it is not one of ours.
        continue
      }
      if (!rules) continue
      // Never learn targets from the stylesheets this engine wrote itself.
      var owner = sheet.ownerNode
      if (owner && (owner.id === PAGE_STYLE_ID || owner.id === RAW_STYLE_ID)) continue
      try {
        walk(rules, owner)
      } catch (e) {}
    }

    // Only trust the map once the app's stylesheet is actually there. Before
    // that an empty map would be cached and every token would fall back to the
    // static list for the rest of the session.
    if (found > 0 || document.readyState === 'complete') discoveredTargets = map
    return map
  }

  var LOGO_IMG_SELECTOR = '.new-thread-logo, .splash-logo, .loading-screen-logo, .empty-space-logo'
  // An inline SVG has no image to swap: paint a background behind it and hide
  // its own shapes.
  var LOGO_BOX_SELECTOR = '.project-sidebar-wordmark'

  function cssEscapeUrl(url) {
    // Keep the complete data URL. Removing quotes (the old implementation)
    // silently corrupted ordinary inline SVGs; escaping them is both safer and
    // preserves the image bytes.
    var escaped = String(url).replace(/[\\"\n\r\f\0]/g, function (ch) {
      if (ch === '\\') return '\\\\'
      if (ch === '"') return '\\"'
      if (ch === '\n') return '\\a '
      if (ch === '\r') return '\\d '
      if (ch === '\f') return '\\c '
      return '\ufffd'
    })
    return 'url("' + escaped + '")'
  }

  function hexToRgbParts(hex) {
    var c = parseColor(hex)
    if (!c) return { r: 0, g: 0, b: 0 }
    return { r: parseInt(c.hex.slice(1, 3), 16), g: parseInt(c.hex.slice(3, 5), 16), b: parseInt(c.hex.slice(5, 7), 16) }
  }

  /** The style sheet body for the current theme. Pure, so it is easy to reason about. */
  function pageOverrideCss(values) {
    var lines = []
    var k

    var discovered = discoverTokenTargets()
    var byTarget = {}
    for (k in values) {
      var staticTarget = SHELL_TARGETS[k]
      var extra = discovered[k]
      var target = ''
      if (staticTarget) target = staticTarget
      if (extra && extra.length) {
        var extraText = extra.join(', ')
        // Merge without repeating selectors already in the static list.
        target = target ? target + ', ' + extraText : extraText
      }
      var value = safeCss(values[k])
      if (!target || !value) continue
      if (!byTarget[target]) byTarget[target] = []
      byTarget[target].push(k + ': ' + value + ' !important;')
    }
    for (var sel in byTarget) {
      lines.push(sel + ' {')
      byTarget[sel].forEach(function (decl) {
        lines.push('  ' + decl)
      })
      lines.push('}')
    }

    // A gradient dropped into a token that something also reads as a colour.
    for (var gt in GRADIENT_FALLBACK) {
      var solid = safeCss(solidCache[gt])
      if (values[gt] && solid) {
        lines.push(GRADIENT_FALLBACK[gt] + ' { color: ' + solid + ' !important; }')
      }
    }

    var w = state.window || {}
    var ink = safeCss(w.ink)
    var hoverBg = safeCss(w.hoverBg)
    var hoverInk = safeCss(w.hoverInk)
    var closeBg = safeCss(w.closeBg)
    var closeInk = safeCss(w.closeInk)
    if (ink) lines.push('.window-control { color: ' + ink + ' !important; }')
    if (hoverBg || hoverInk) {
      lines.push(
        '.window-control:hover { ' +
          (hoverBg ? 'background: ' + hoverBg + ' !important; ' : '') +
          (hoverInk ? 'color: ' + hoverInk + ' !important; ' : '') +
          '}',
      )
    }
    if (closeBg || closeInk) {
      lines.push(
        '.window-control-close:hover { ' +
          (closeBg ? 'background: ' + closeBg + ' !important; ' : '') +
          (closeInk ? 'color: ' + closeInk + ' !important; ' : '') +
          '}',
      )
    }

    var logo = state.logo || {}
    if (logo.image) {
      var src = cssEscapeUrl(logo.image)
      var scale = logo.size && logo.size !== 1 ? ' scale(' + logo.size + ') !important;' : ''
      var dim = logo.opacity != null && logo.opacity < 1 ? ' opacity: ' + logo.opacity + ' !important;' : ''
      var filt = ' filter: ' + (sanitizeFilter(logo.filter) || 'none') + ' !important;'
      lines.push(LOGO_IMG_SELECTOR + ' { content: ' + src + ' !important; object-fit: contain !important;' + scale + dim + filt + ' transform-origin: center !important; }')
      lines.push(LOGO_BOX_SELECTOR + ' { background-image: ' + src + ' !important; background-size: contain !important; background-repeat: no-repeat !important; background-position: center !important;' + filt + ' }')
      lines.push(LOGO_BOX_SELECTOR + ' > * { visibility: hidden !important; }')
    }

    var bg = state.background || {}
    if (bg.image) {
      var baseToken = bg.whole ? '--bg' : '--workspace-surface'
      var base = values[baseToken] || values['--bg'] || '#000000'
      var dimAmount = bg.dim || 0
      // Theme colours may be translucent or gradients. Use their opaque base
      // instead of silently treating rgba()/linear-gradient as black.
      var parts = hexToRgbParts(opaqueHex(base) || '#000000')
      // Dim pulls the veil towards black; opacity lets the surface show
      // through. Both end up in one rgba, because a background layer can only
      // be faded as a whole.
      var alpha = 1 - (bg.opacity == null ? 1 : bg.opacity) * (1 - dimAmount)
      var veil = 'rgba(' + Math.round(parts.r * (1 - dimAmount)) + ',' + Math.round(parts.g * (1 - dimAmount)) + ',' + Math.round(parts.b * (1 - dimAmount)) + ',' + Math.round(alpha * 1000) / 1000 + ')'
      var size = bg.fit === 'tile' ? 'auto' : bg.fit === 'stretch' ? '100% 100%' : bg.fit === 'contain' ? 'contain' : 'cover'
      var repeat = bg.fit === 'tile' ? 'repeat' : 'no-repeat'
      var pos = bg.position || 'center'
      var targets = bg.whole ? '.app, body' : '.workspace-frame, .settings-frame'
      lines.push(
        targets +
          ' { background-image: linear-gradient(' + veil + ', ' + veil + '), ' + cssEscapeUrl(bg.image) +
          ' !important; background-size: auto, ' + size + ' !important;' +
          ' background-repeat: no-repeat, ' + repeat + ' !important;' +
          ' background-position: center, ' + pos + ' !important; }',
      )
    }

    return lines.join('\n')
  }

  function applyPageStyles(values) {
    var css = pageOverrideCss(values)
    var el = document.getElementById(PAGE_STYLE_ID)
    if (!css) {
      if (el) el.remove()
      return
    }
    if (!el) {
      el = document.createElement('style')
      el.id = PAGE_STYLE_ID
      document.head.appendChild(el)
    }
    // Re-appended so it stays the last sheet in <head>: equal-specificity
    // !important rules are resolved by order, and the app's own !important
    // rules must not be able to beat the theme.
    document.head.appendChild(el)
    el.textContent = css
  }

  function resetAll() {
    state = clone(DEFAULT_STATE)
    // Recompute every layer, not just :root. This also removes window-button,
    // shell geometry and background-picture rules left by the page stylesheet.
    applyState()
    saveState(state, true)
  }

  function cssText() {
    var lines = [':root {']
    var values = currentValues()
    for (var k in values) lines.push('  ' + k + ': ' + values[k] + ';')
    lines.push('}')
    if (state.raw) lines.push('', state.raw)
    return lines.join('\n')
  }

  /*
   * Apply before the UI mounts so there is no flash of the default theme.
   *
   * Wrapped, because this runs against whatever the stored theme happens to
   * be. A theme that throws must not leave the host page half-painted or stop
   * the rest of this file from mounting the panel: the defaults are applied
   * instead, and the stored theme is left untouched so the user can reopen
   * Theme Studio and fix it.
   */
  try {
    applyState()
  } catch (err) {
    console.error('[freebuff-theme-studio] could not apply the saved theme', err)
    try {
      state = clone(DEFAULT_STATE)
      applyState()
    } catch (err2) {
      console.error('[freebuff-theme-studio] could not apply the default theme either', err2)
    }
    notifySave('Your saved theme could not be applied - the default is showing')
  }

  /* ------------------------------------------------------------------ *
   * UI
   * ------------------------------------------------------------------ */

  // Set by mount(): lets the sidebar button drive the page.
  var ui = null
  var railButton = null
  var pagePanel = null

  var RAIL_ICON =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.9-.8 1.9-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.8-1.6 1.7-1.6h1.1A5.3 5.3 0 0 0 21 9.9C21 6 16.97 3 12 3Z"/>' +
    '<circle cx="7.7" cy="12" r="1.05"/><circle cx="10" cy="7.9" r="1.05"/>' +
    '<circle cx="14.3" cy="7.9" r="1.05"/><circle cx="17" cy="11.6" r="1.05"/></svg>'

  /**
   * Freebuff's icon rail lives in `.shell-navigation-top` as `.shell-nav-button`
   * elements. Injecting one there means the shell styles it for us - we only
   * supply the icon and the handler.
   */
  /**
   * Take this panel's own icon out of Freebuff's rail, and leave it out.
   *
   * The removal is asked for from inside this page, and this page goes on
   * running until Freebuff is next loaded - so without this the rail still
   * shows the palette icon after "deleted", which reads as "not deleted". Any
   * node left in the DOM is swept up too, not just the one held here: the shell
   * can re-render the rail underneath us.
   */
  function removeRailButton() {
    var nodes = document.querySelectorAll('[data-fbts-rail]')
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i])
    }
    railButton = null
  }

  function installRailButton() {
    if (removalRequested) {
      removeRailButton()
      return false
    }
    if (railButton && railButton.isConnected) return true
    var rail =
      document.querySelector('.shell-navigation-top') ||
      document.querySelector('.shell-navigation')
    if (!rail) return false
    var btn = document.createElement('button')
    btn.className = 'shell-nav-button'
    btn.setAttribute('data-fbts-rail', '1')
    btn.setAttribute('aria-label', 'Theme Studio')
    btn.setAttribute('title', 'Theme Studio')
    btn.innerHTML = RAIL_ICON
    btn.addEventListener('click', function (e) {
      e.preventDefault()
      e.stopPropagation()
      if (ui) ui.toggle()
    })
    rail.appendChild(btn)
    railButton = btn
    return true
  }

  function watchRail() {
    var scheduled = false
    var recheck = function () {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(function () {
        scheduled = false
        installRailButton()
        // The shell may have re-laid itself out; keep the page on the frame.
        fitPage()
      })
    }
    try {
      new MutationObserver(recheck).observe(document.body, { childList: true, subtree: true })
    } catch (e) {}
    // Belt and braces: React can replace the rail wholesale on navigation.
    setInterval(installRailButton, 1500)
  }

  /*
   * Where the page belongs.
   *
   * Freebuff renders its content inside `.workspace-frame`, which the shell
   * insets by --shell-rail-width on the left and --shell-inset on the right and
   * bottom, below a --tabbar-height tab row. Those three custom properties are
   * declared on `.desktop-shell`, NOT on :root, and our shadow host is a child
   * of <body> - so `var(--shell-rail-width)` inside the shadow root silently
   * took its fallback (56px instead of 52px, 60px instead of 48px for the tab
   * bar) and the page never lined up with the app's own views.
   *
   * Measuring the frame instead of recomputing the arithmetic also tracks
   * compact mode, a collapsed sidebar, thread windows and future shell tweaks.
   */
  /** The biggest visible workspace box on the page (there is normally one). */
  function workspaceBox() {
    var best = null
    var nodes = document.querySelectorAll('.workspace-frame, .settings-frame')
    for (var i = 0; i < nodes.length; i++) {
      var r = nodes[i].getBoundingClientRect()
      if (r.width < 240 || r.height < 160) continue
      if (!best || r.width * r.height > best.width * best.height)
        best = { width: r.width, height: r.height, top: r.top, left: r.left, right: r.right, bottom: r.bottom }
    }
    return best
  }

  function measureWorkspace() {
    var frame = workspaceBox()
    if (frame) return frame
    var shell = document.querySelector('.desktop-shell') || document.documentElement
    var cs = getComputedStyle(shell)
    var num = function (name, fallback) {
      var v = parseFloat(cs.getPropertyValue(name))
      return isFinite(v) ? v : fallback
    }
    var box = shell.getBoundingClientRect()
    var bar = num('--tabbar-height', 48)
    var rail = num('--shell-rail-width', 52)
    var inset = num('--shell-inset', 8)
    return {
      top: box.top + bar,
      left: box.left + rail,
      right: box.right - inset,
      bottom: box.bottom - inset,
      corner: cs.getPropertyValue('--workspace-corner').trim(),
    }
  }

  function fitToWorkspace(node) {
    if (!node || !node.isConnected) return
    var box = measureWorkspace()
    var corner = box.corner
    if (!corner) {
      var shell = document.querySelector('.desktop-shell')
      if (shell) {
        try {
          corner = getComputedStyle(shell).getPropertyValue('--workspace-corner').trim()
        } catch (e) {}
      }
    }
    node.style.top = Math.round(box.top) + 'px'
    node.style.left = Math.round(box.left) + 'px'
    node.style.right = Math.max(0, Math.round(window.innerWidth - box.right)) + 'px'
    node.style.bottom = Math.max(0, Math.round(window.innerHeight - box.bottom)) + 'px'
    // Match the workspace frame's rounded corners, whatever the shell uses.
    node.style.borderRadius = corner || '18px'
  }

  function fitPage() {
    fitToWorkspace(pagePanel)
  }

  /** Clicking any other rail icon means the user left our page. */
  function closePageOnExternalNav() {
    document.addEventListener(
      'click',
      function (e) {
        var t = e.target
        var btn = t && t.closest ? t.closest('.shell-nav-button') : null
        if (!btn || btn === railButton) return
        if (ui) ui.toggle(false)
      },
      true,
    )
  }

  function el(tag, props, children) {
    var node = document.createElement(tag)
    if (props)
      for (var k in props) {
        if (k === 'class') node.className = props[k]
        else if (k === 'text') node.textContent = props[k]
        else if (k === 'html') node.innerHTML = props[k]
        else if (k.indexOf('on') === 0 && typeof props[k] === 'function') node.addEventListener(k.slice(2), props[k])
        else if (k === 'style') node.style.cssText = props[k]
        else if (props[k] != null) node.setAttribute(k, props[k])
      }
    ;(children || []).forEach(function (c) {
      if (c == null) return
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
    })
    return node
  }

  var STYLES = `
* { box-sizing: border-box; margin: 0; padding: 0; font-family: var(--fbts-font); }
:host {
  --fbts-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --fbts-mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  --fbts-bg: #121317;
  --fbts-panel: #17181d;
  --fbts-panel2: #1d1f25;
  --fbts-line: #2a2d35;
  --fbts-ink: #e7e9ee;
  --fbts-mute: #9aa1ad;
  --fbts-faint: #6d7480;
  --fbts-accent: #5b8cff;
  --fbts-accent2: #8affc1;
  --fbts-danger: #ff6b6b;
  --fbts-radius: 12px;
  /*
   * The page is built the way an audio plugin's settings page is: square-ish
   * boxes with a titled frame around each group, thin bevels instead of
   * shadows, and controls that look like hardware (dials, round colour spots,
   * folder tabs). Colours still come from the live app tokens, so the studio
   * keeps matching whatever theme is applied.
   */
  --fbts-radius-box: 5px;
  --fbts-bevel: inset 0 1px 0 rgba(255,255,255,.05), inset 0 -1px 0 rgba(0,0,0,.28);
  --fbts-sunken: inset 0 1px 3px rgba(0,0,0,.45);
  --fbts-head-bg: color-mix(in srgb, var(--fbts-ink) 8%, transparent);
  --fbts-fill: color-mix(in srgb, var(--fbts-ink) 4%, transparent);
}
.fbts-root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483600; }

.fbts-panel {
  position: fixed; right: 18px; bottom: 74px; width: 384px; max-width: calc(100vw - 36px);
  max-height: min(78vh, 780px); pointer-events: auto; display: none; flex-direction: column;
  background: var(--fbts-panel); border: 1px solid var(--fbts-line);
  border-radius: 16px; overflow: hidden; color: var(--fbts-ink);
  box-shadow: 0 30px 90px rgba(0,0,0,.68), 0 0 0 1px rgba(255,255,255,.03) inset;
}
.fbts-panel.open { display: flex; }

.fbts-titlebar {
  display: flex; align-items: center; gap: 11px; padding: 11px 13px 10px 15px;
  border-bottom: 1px solid var(--fbts-line); background: var(--fbts-panel2);
  box-shadow: var(--fbts-bevel);
}
.fbts-titlebar-icon { display: flex; flex: none; color: var(--fbts-accent); }
.fbts-titlebar-icon svg { width: 19px; height: 19px; }
.fbts-titlebar-text { min-width: 0; }
.fbts-title { font-size: 13.5px; font-weight: 700; letter-spacing: .01em; }
.fbts-head-row { display: flex; align-items: center; gap: 8px; }
.fbts-badge {
  display: inline-flex; align-items: center; height: 17px; padding: 0 7px; flex: none;
  border: 1px solid color-mix(in srgb, var(--fbts-ink) 20%, transparent); border-radius: 999px;
  color: var(--fbts-mute); font-size: 9px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
}
.fbts-sub { font-size: 10.5px; color: var(--fbts-faint); font-weight: 500; }
.fbts-sub-sep { opacity: .5; padding: 0 3px; }
.fbts-version { cursor: pointer; }
.fbts-version:hover { color: var(--fbts-mute); text-decoration: underline; }
.fbts-head .grow { flex: 1; }
.fbts-x { width: 26px; height: 26px; border-radius: var(--fbts-radius-box); border: 1px solid var(--fbts-line); background: transparent; color: var(--fbts-mute); cursor: pointer; font-size: 14px; line-height: 1; }
.fbts-x:hover { color: var(--fbts-ink); border-color: var(--fbts-accent); }

/* ---- folder tabs, the active one open into the page ---- */
.fbts-tabs { display: flex; align-items: flex-end; gap: 2px; padding: 0 10px; border-bottom: 1px solid var(--fbts-line); background: var(--fbts-panel2); overflow-x: auto; scrollbar-width: none; }
.fbts-tabs::-webkit-scrollbar { display: none; }
.fbts-tab {
  flex: none; padding: 8px 15px 7px; border: 1px solid transparent; border-bottom: none;
  border-radius: 7px 7px 0 0; font-size: 11.5px; font-weight: 600; color: var(--fbts-mute);
  cursor: pointer; white-space: nowrap; box-shadow: var(--fbts-bevel);
}
.fbts-tab:hover:not(.active) { color: var(--fbts-ink); background: color-mix(in srgb, var(--fbts-ink) 6%, transparent); }
.fbts-tab.active { color: var(--fbts-ink); background: var(--fbts-panel); border-color: var(--fbts-line); margin-bottom: -1px; padding-bottom: 8px; }

.fbts-body { overflow-y: auto; padding: 10px; flex: 1; }
.fbts-body::-webkit-scrollbar { width: 10px; }
.fbts-body::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--fbts-ink) 20%, transparent); border-radius: 6px; border: 3px solid transparent; background-clip: padding-box; }

/* ---- group box: the unit this page is built from ---- */
.fbts-group { border: 1px solid var(--fbts-line); border-radius: var(--fbts-radius-box); background: var(--fbts-fill); margin-bottom: 10px; overflow: hidden; }
.fbts-group-head {
  display: flex; align-items: center; gap: 8px; padding: 6px 9px; border-bottom: 1px solid var(--fbts-line);
  background: var(--fbts-head-bg); box-shadow: var(--fbts-bevel); color: var(--fbts-mute);
  font-size: 9.5px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; user-select: none;
}
.fbts-group-head .grow { flex: 1; }
.fbts-group-body { padding: 9px; }
.fbts-group.scroll > .fbts-group-body { max-height: min(46vh, 420px); overflow-y: auto; }
.fbts-group.scroll > .fbts-group-body::-webkit-scrollbar { width: 10px; }
.fbts-group.scroll > .fbts-group-body::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--fbts-ink) 22%, transparent); border-radius: 6px; border: 3px solid transparent; background-clip: padding-box; }

/* ---- preset cards: a live miniature of Freebuff wearing the preset ---- */
.fbts-presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); gap: 9px; }
.fbts-preset {
  border: 1px solid var(--fbts-line); border-radius: var(--fbts-radius-box);
  padding: 4px 4px 0; background: var(--fbts-fill); cursor: pointer; text-align: center;
}
.fbts-preset:hover { border-color: color-mix(in srgb, var(--fbts-accent) 65%, var(--fbts-line)); }
.fbts-preset.active { border-color: var(--fbts-accent); box-shadow: 0 0 0 1px var(--fbts-accent); }
.fbts-thumb {
  display: flex; width: 100%; aspect-ratio: 16 / 10; overflow: hidden;
  border: 1px solid rgba(0,0,0,.45); border-radius: 3px; background: var(--t-bg, var(--fbts-panel));
}
.fbts-thumb .t-rail { width: 9%; flex: none; display: flex; flex-direction: column; align-items: center; gap: 7%; padding: 9% 0; background: var(--t-chrome, var(--fbts-panel2)); }
.fbts-thumb .t-rail i { width: 46%; aspect-ratio: 1; border-radius: 30%; background: var(--t-muted, #888); opacity: .5; }
.fbts-thumb .t-rail i:first-child { background: var(--t-brand, #6cf); opacity: 1; }
.fbts-thumb .t-side { width: 27%; flex: none; display: flex; flex-direction: column; gap: 8%; padding: 9% 7%; background: var(--t-chrome, var(--fbts-panel2)); border-left: 1px solid rgba(0,0,0,.3); }
.fbts-thumb .t-side b { height: 4%; min-height: 1.5px; border-radius: 2px; background: var(--t-muted, #888); opacity: .45; }
.fbts-thumb .t-side b.w { background: var(--t-brand, #6cf); opacity: .85; }
.fbts-thumb .t-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6%; padding: 8%; background: var(--t-bg, var(--fbts-panel)); }
.fbts-thumb .t-line { height: 3.5%; min-height: 1.5px; border-radius: 2px; background: var(--t-text, #eee); opacity: .32; }
.fbts-thumb .t-line.short { width: 55%; }
.fbts-thumb .t-bubble { height: 30%; border-radius: 3px; border: 1px solid rgba(255,255,255,.07); background: var(--t-surface, var(--fbts-panel2)); }
.fbts-thumb .t-composer { height: 12%; margin-top: auto; border-radius: 999px; border: 1px solid var(--t-brand, #6cf); background: var(--t-surface, var(--fbts-panel2)); }
.fbts-preset-name { padding: 5px 2px 6px; font-size: 10.5px; font-weight: 600; color: var(--fbts-mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fbts-preset.active .fbts-preset-name { color: var(--fbts-ink); }

/* ---- dials ---- */
.fbts-knobs { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 2px; }
.fbts-knob { width: 66px; display: flex; flex-direction: column; align-items: center; gap: 3px; cursor: ns-resize; outline: none; user-select: none; }
.fbts-knob-dial {
  position: relative; width: 44px; height: 44px; border-radius: 50%;
  background: conic-gradient(from 225deg, var(--fbts-accent) 0 var(--fbts-knob-fill, 0deg), color-mix(in srgb, var(--fbts-ink) 15%, transparent) var(--fbts-knob-fill, 0deg) 270deg, transparent 270deg);
}
.fbts-knob-dial::after {
  content: ''; position: absolute; inset: 4px; border-radius: 50%; border: 1px solid var(--fbts-line);
  background: radial-gradient(circle at 50% 32%, color-mix(in srgb, var(--fbts-ink) 13%, var(--fbts-panel2)), var(--fbts-panel) 72%);
  box-shadow: var(--fbts-sunken);
}
.fbts-knob-needle { position: absolute; z-index: 1; left: 50%; top: 50%; width: 2px; height: 13px; margin: -13px 0 0 -1px; border-radius: 2px; background: var(--fbts-ink); transform-origin: 50% 100%; }
.fbts-knob-value { font-family: var(--fbts-mono); font-size: 9.5px; color: var(--fbts-ink); font-variant-numeric: tabular-nums; }
.fbts-knob-label { font-size: 9.5px; line-height: 1.2; color: var(--fbts-mute); text-align: center; }
.fbts-knob:focus-visible .fbts-knob-dial { outline: 2px solid var(--fbts-accent); outline-offset: 2px; }

/* ---- colour spots ---- */
.fbts-spot-row { display: flex; align-items: flex-start; gap: 10px; padding: 5px 0; }
.fbts-spot-row-label {
  width: 104px; flex: none; padding-top: 7px; color: var(--fbts-mute);
  font-size: 9px; letter-spacing: .07em; text-transform: uppercase; font-weight: 700;
}
.fbts-circles { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 7px 2px; }
.fbts-circle {
  display: flex; flex-direction: column; align-items: center; gap: 5px; width: 62px;
  padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer;
}
.fbts-spot {
  width: 30px; height: 30px; flex: none; border: 1px solid rgba(0,0,0,.45); border-radius: 50%;
  box-shadow: var(--fbts-bevel);
}
.fbts-circle:hover .fbts-spot { box-shadow: var(--fbts-bevel), 0 0 0 2px color-mix(in srgb, var(--fbts-accent) 55%, transparent); }
/* A spot that no longer follows the preset says so. */
.fbts-circle.overridden .fbts-spot { border-color: var(--fbts-accent); }
.fbts-circle.overridden .fbts-circle-label { color: var(--fbts-ink); }
.fbts-circle:focus-visible .fbts-spot { outline: 2px solid var(--fbts-accent); outline-offset: 2px; }
.fbts-circle-label { font-size: 9.5px; line-height: 1.25; color: var(--fbts-mute); text-align: center; }

/* ---- the colour picker ---- */
.fbts-picker {
  position: fixed; z-index: 4; width: 272px; pointer-events: auto; display: none; flex-direction: column;
  border: 1px solid var(--fbts-line); border-radius: var(--fbts-radius-box);
  background: var(--fbts-panel2); color: var(--fbts-ink); box-shadow: 0 20px 60px rgba(0,0,0,.6);
}
.fbts-picker.show { display: flex; }
.fbts-picker-head { display: flex; align-items: center; gap: 7px; padding: 7px 9px; border-bottom: 1px solid var(--fbts-line); background: var(--fbts-head-bg); box-shadow: var(--fbts-bevel); }
.fbts-picker-title { font-size: 11.5px; font-weight: 700; }
.fbts-picker-token { font-family: var(--fbts-mono); font-size: 9.5px; color: var(--fbts-mute); }
.fbts-picker-head .grow { flex: 1; }
.fbts-picker-body { display: flex; flex-direction: column; gap: 9px; padding: 9px; }
.fbts-sv {
  position: relative; height: 116px; cursor: crosshair; border: 1px solid var(--fbts-line); border-radius: 4px;
  background: linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, var(--fbts-hue-color, #f00));
}
.fbts-sv-dot { position: absolute; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.55); pointer-events: none; }
.fbts-hue {
  position: relative; height: 13px; cursor: ew-resize; border: 1px solid var(--fbts-line); border-radius: 7px;
  background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
}
.fbts-hue-thumb { position: absolute; top: -3px; width: 7px; height: 17px; margin-left: -3.5px; border-radius: 3px; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.55); pointer-events: none; }
.fbts-picker-row { display: flex; align-items: center; gap: 7px; }
.fbts-picker-row .fbts-textinput { width: 92px; }
.fbts-picker-label { width: 34px; flex: none; font-size: 10px; color: var(--fbts-mute); }
.fbts-preview { width: 26px; height: 26px; flex: none; border: 1px solid var(--fbts-line); border-radius: 4px; }
.fbts-alpha-wide { flex: 1; min-width: 0; accent-color: var(--fbts-accent); }
.fbts-picker-foot { display: flex; align-items: center; gap: 7px; padding: 8px 9px; border-top: 1px solid var(--fbts-line); }
.fbts-picker-foot .grow { flex: 1; }

/* ---- fill mode, and the two stops of a gradient ---- */
.fbts-mode {
  padding: 4px 9px; border: 1px solid var(--fbts-line); border-radius: 3px; background: none;
  color: var(--fbts-mute); font-size: 10px; font-weight: 600; cursor: pointer;
}
.fbts-mode:hover { color: var(--fbts-ink); }
.fbts-mode.active { background: var(--fbts-accent); border-color: var(--fbts-accent); color: var(--fbts-panel); }
.fbts-stopbtn {
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 7px 3px 4px;
  border: 1px solid var(--fbts-line); border-radius: 3px; background: none;
  color: var(--fbts-mute); font-size: 10px; font-weight: 700; cursor: pointer;
}
.fbts-stopbtn.active { border-color: var(--fbts-accent); color: var(--fbts-ink); }
.fbts-stopswatch { width: 14px; height: 14px; flex: none; border-radius: 2px; border: 1px solid rgba(0,0,0,.45); }

/* ---- page tab: picture boxes and sliders ---- */
.fbts-imgbox {
  display: grid; place-items: center; height: 104px; overflow: hidden; border: 1px dashed var(--fbts-line);
  border-radius: 4px; background-color: var(--fbts-panel);
  background-image: linear-gradient(45deg, rgba(255,255,255,.045) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.045) 75%),
                    linear-gradient(45deg, rgba(255,255,255,.045) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.045) 75%);
  background-size: 14px 14px; background-position: 0 0, 7px 7px;
}
.fbts-imgbox img { max-width: 100%; max-height: 100%; object-fit: contain; }
.fbts-imgbox span { color: var(--fbts-faint); font-size: 10px; text-align: center; padding: 0 8px; }
.fbts-slider { display: flex; align-items: center; gap: 9px; padding: 3px 0; }
.fbts-slider > span:first-child { width: 62px; flex: none; font-size: 10.5px; color: var(--fbts-mute); }
.fbts-slider input[type=range] { flex: 1; min-width: 0; accent-color: var(--fbts-accent); }
.fbts-slider-val { width: 40px; flex: none; text-align: right; font-family: var(--fbts-mono); font-size: 10px; color: var(--fbts-mute); }
.fbts-col { display: flex; flex-direction: column; gap: 8px; }
.fbts-community-note { margin: 0 0 9px; font-size: 10.5px; line-height: 1.5; color: var(--fbts-mute); }
.fbts-community-note code { font-family: var(--fbts-mono); font-size: 10px; color: var(--fbts-ink); }
.fbts-author { color: var(--fbts-faint); font-size: 9.5px; }

/* ---- options ---- */
.fbts-option { display: flex; align-items: center; gap: 8px; padding: 5px 2px; font-size: 11.5px; color: var(--fbts-ink); cursor: pointer; }
.fbts-option input { flex: none; width: 14px; height: 14px; margin: 0; accent-color: var(--fbts-accent); }

.fbts-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
.fbts-row-label { flex: 1; font-size: 11.5px; color: var(--fbts-mute); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fbts-row-label code { font-family: var(--fbts-mono); font-size: 9.5px; color: var(--fbts-faint); display: block; }
.fbts-swatchinput { width: 26px; height: 24px; padding: 0; border: 1px solid var(--fbts-line); border-radius: 4px; background: none; cursor: pointer; flex: none; }
/* Dashed means "nothing set here - it follows the theme". */
.fbts-swatchinput.empty { border-style: dashed; }
.fbts-swatchinput::-webkit-color-swatch-wrapper { padding: 2px; }
.fbts-swatchinput::-webkit-color-swatch { border: none; border-radius: 3px; }
.fbts-textinput {
  width: 104px; flex: none; background: var(--fbts-panel); border: 1px solid var(--fbts-line); color: var(--fbts-ink);
  border-radius: 4px; padding: 5px 7px; font-size: 11px; font-family: var(--fbts-mono); outline: none;
  box-shadow: var(--fbts-sunken);
}
.fbts-textinput:focus { border-color: var(--fbts-accent); }
.fbts-alpha { width: 52px; flex: none; accent-color: var(--fbts-accent); }
.fbts-mini { width: 24px; height: 24px; flex: none; border-radius: 4px; border: 1px solid var(--fbts-line); background: transparent; color: var(--fbts-faint); cursor: pointer; font-size: 11px; }
.fbts-mini:hover { color: var(--fbts-danger); border-color: var(--fbts-danger); }

.fbts-accordion { border: 1px solid var(--fbts-line); border-radius: var(--fbts-radius-box); margin-bottom: 8px; overflow: hidden; background: var(--fbts-fill); }
.fbts-accordion-head { display: flex; align-items: center; gap: 8px; padding: 7px 9px; cursor: pointer; font-size: 11.5px; font-weight: 600; user-select: none; background: var(--fbts-head-bg); box-shadow: var(--fbts-bevel); }
.fbts-accordion-head .chev { color: var(--fbts-faint); font-size: 9px; transition: transform .15s; }
.fbts-accordion.open .chev { transform: rotate(90deg); }
.fbts-accordion-body { display: none; padding: 7px 9px 9px; border-top: 1px solid var(--fbts-line); }
.fbts-accordion.open .fbts-accordion-body { display: block; }

.fbts-btn { padding: 7px 12px; border-radius: var(--fbts-radius-box); border: 1px solid var(--fbts-line); background: var(--fbts-panel2); color: var(--fbts-ink); font-size: 11.5px; font-weight: 600; cursor: pointer; box-shadow: var(--fbts-bevel); }
.fbts-btn:hover { border-color: var(--fbts-accent); }
.fbts-btn.primary { background: var(--fbts-accent); border-color: var(--fbts-accent); color: #0a0c10; }
.fbts-btn.danger:hover { border-color: var(--fbts-danger); color: var(--fbts-danger); }
.fbts-actions { display: flex; flex-wrap: wrap; gap: 7px; padding: 10px 12px; border-top: 1px solid var(--fbts-line); background: var(--fbts-panel2); }
.fbts-actions .grow { flex: 1; }

/* ---- footer bar ---- */
.fbts-footer { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 9px 12px; border-top: 1px solid var(--fbts-line); background: var(--fbts-panel2); box-shadow: var(--fbts-bevel); }
.fbts-footer .grow { flex: 1; }
.fbts-seg { display: flex; flex: none; border: 1px solid var(--fbts-line); border-radius: var(--fbts-radius-box); overflow: hidden; box-shadow: var(--fbts-sunken); }
.fbts-seg button {
  width: 34px; padding: 7px 0; border: 0; border-left: 1px solid var(--fbts-line); background: var(--fbts-panel);
  color: var(--fbts-mute); font-family: var(--fbts-font); font-size: 11.5px; font-weight: 700; cursor: pointer;
}
.fbts-seg button:first-child { border-left: 0; }
.fbts-seg button:hover { color: var(--fbts-ink); }
.fbts-seg button.active { background: var(--fbts-accent); color: #0a0c10; }

/* Between muted and faint: faint alone drops under 3:1 in the light presets. */
.fbts-note { font-size: 10.5px; color: color-mix(in srgb, var(--fbts-mute) 80%, var(--fbts-faint)); line-height: 1.5; margin: 6px 2px 0; }
.fbts-textarea { width: 100%; min-height: 150px; background: var(--fbts-panel); border: 1px solid var(--fbts-line); border-radius: 4px; color: var(--fbts-ink); font-family: var(--fbts-mono); font-size: 11px; line-height: 1.5; padding: 9px; resize: vertical; outline: none; box-shadow: var(--fbts-sunken); }
.fbts-textarea:focus { border-color: var(--fbts-accent); }
.fbts-textarea.drop { border-color: var(--fbts-accent); background: color-mix(in srgb, var(--fbts-accent) 12%, var(--fbts-panel)); }
.fbts-code-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.fbts-code-row input { flex: 1; min-width: 0; margin: 0; font-family: var(--fbts-mono); font-size: 11px; }
.fbts-code { display: block; background: var(--fbts-panel); border: 1px solid var(--fbts-line); border-radius: 4px; padding: 7px 9px; font-family: var(--fbts-mono); font-size: 11px; color: var(--fbts-ink); white-space: pre-wrap; word-break: break-all; box-shadow: var(--fbts-sunken); }
/* ---- settings rows ---- */
.fbts-setting { margin: 0 0 10px; }
.fbts-setting + .fbts-setting { border-top: 1px solid var(--fbts-line); padding-top: 10px; }
.fbts-search { width: 100%; background: var(--fbts-panel); border: 1px solid var(--fbts-line); border-radius: 4px; color: var(--fbts-ink); padding: 7px 9px; font-size: 11.5px; outline: none; margin-bottom: 8px; box-shadow: var(--fbts-sunken); }
.fbts-search:focus { border-color: var(--fbts-accent); }
.fbts-toast {
  position: fixed; right: 18px; bottom: 18px; pointer-events: none; opacity: 0;
  background: #0e1015; border: 1px solid var(--fbts-line); color: var(--fbts-ink);
  padding: 9px 14px; border-radius: 10px; font-size: 11.5px; font-weight: 600;
  transition: opacity .2s, transform .2s; transform: translateY(6px);
  box-shadow: 0 12px 34px rgba(0,0,0,.6);
}
.fbts-toast.show { opacity: 1; transform: translateY(0); }

/* ---- update chip + popup ---- */
.fbts-update-chip {
  position: fixed; right: 16px; bottom: 16px; z-index: 2; pointer-events: auto; display: none;
  align-items: center; gap: 7px; padding: 8px 13px 8px 10px;
  border: 1px solid var(--fbts-line); border-radius: 999px; background: var(--fbts-panel2);
  color: var(--fbts-ink); font-size: 11.5px; font-weight: 600; cursor: pointer; white-space: nowrap;
  box-shadow: 0 10px 30px rgba(0,0,0,.5);
}
.fbts-update-chip.show { display: inline-flex; }
.fbts-update-chip:hover { border-color: var(--fbts-accent); }
.fbts-update-chip svg { width: 15px; height: 15px; flex: none; color: var(--fbts-accent); }
/* Keep clear of the page footer while Theme Studio is open. */
.fbts-root.fbts-page-open .fbts-update-chip { right: 26px; bottom: 68px; }

.fbts-modal-wrap {
  position: fixed; inset: 0; z-index: 6; display: none; place-items: center; padding: 24px;
  pointer-events: auto; background: rgba(0,0,0,.55);
}
.fbts-modal-wrap.show { display: grid; }
.fbts-modal {
  width: min(430px, calc(100vw - 48px)); padding: 18px 20px 16px;
  border: 1px solid var(--fbts-line); border-radius: 16px; background: var(--fbts-panel);
  color: var(--fbts-ink); box-shadow: 0 30px 90px rgba(0,0,0,.6);
}
.fbts-modal h3 { font-size: 15px; font-weight: 700; margin-bottom: 8px; }
.fbts-modal p { font-size: 11.5px; line-height: 1.6; color: var(--fbts-mute); margin-bottom: 9px; }
.fbts-modal p:last-of-type { margin-bottom: 0; }
.fbts-modal code { font-family: var(--fbts-mono); color: var(--fbts-ink); }
.fbts-modal-match { margin: 12px 2px 0; font-size: 10.5px; color: var(--fbts-faint); }
.fbts-modal-foot { display: flex; gap: 8px; align-items: center; margin-top: 14px; }
.fbts-modal-foot .grow { flex: 1; }
`

  /*
   * The panel is really a page: it fills the workspace to the right of
   * Freebuff's icon rail and sits below the tab bar, exactly where the app
   * renders its own settings view. It is themed with the live app tokens, so
   * the studio follows whatever theme is currently applied.
   */
  var PAGE_STYLES = `
:host {
  --fbts-font: var(--font-sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif);
  --fbts-mono: var(--font-mono, ui-monospace, Menlo, Consolas, monospace);
  --fbts-bg: var(--bg, #16171b);
  --fbts-panel: var(--bg, #16171b);
  --fbts-panel2: var(--chrome, var(--surface, #1d1f24));
  --fbts-line: var(--border, #2a2d35);
  --fbts-ink: var(--text, #e7e9ee);
  --fbts-mute: var(--muted, #9aa1ad);
  --fbts-faint: var(--faint, #6d7480);
  --fbts-accent: var(--brand, #5b8cff);
  --fbts-accent2: var(--brand-dim, #8affc1);
  --fbts-danger: var(--danger, #ff6b6b);
  --fbts-radius: var(--radius-md, 10px);
  --fbts-body-size: var(--font-size-body, 13px);
  --fbts-ui-size: var(--font-size-ui, 12px);
  --fbts-label-size: var(--font-size-label, 11px);
}

.fbts-panel {
  position: fixed;
  z-index: 1;
  /*
   * Fallbacks only. The shell defines --tabbar-height / --shell-rail-width /
   * --shell-inset on .desktop-shell, not on :root, and this shadow host is a
   * child of <body> - so it cannot inherit them and var() here would silently
   * fall back. fitToWorkspace() measures the real workspace frame instead and
   * writes the box as inline styles.
   */
  top: 48px;
  left: 52px;
  right: 8px;
  bottom: 8px;
  width: auto;
  max-width: none;
  max-height: none;
  border: none;
  border-radius: 18px;
  box-shadow: none;
  overflow: hidden;
  background: var(--fbts-bg);
  /*
   * The floor, and why every top-level box in this file needs one.
   *
   * The panel is painted with the live theme background, and that can be made
   * translucent with the picker's Opacity control. A translucent background
   * here meant the editor itself went see-through: the app showed through the
   * controls and the page could not be read. So the theme colour is painted
   * OVER an opaque floor instead of in place of one, and the floor is the
   * theme's own background at full strength - which is what the translucent
   * colour would have composited to anyway, so nothing changes until somebody
   * makes a colour translucent.
   *
   * The layer is built in the engine rather than here, because a plain colour is
   * not a background-image and wrapping it inline would leave the property to
   * the invalid-at-computed-value-time rule, which resets it to none instead of
   * keeping the previous declaration.
   */
  background-color: var(--fbts-floor, #14151a);
  background-image: var(--fbts-bg-layer, none);
}

/* The other boxes that are not inside the panel, so need a floor of their own. */
.fbts-modal {
  background-color: var(--fbts-floor, #14151a);
  background-image: var(--fbts-bg-layer, none);
}
.fbts-picker,
.fbts-update-chip {
  background-color: var(--fbts-floor2, var(--fbts-floor, #14151a));
  background-image: var(--fbts-panel2-layer, none);
}

/* ---- title bar: the page banner, like a plugin's header ---- */
.fbts-titlebar {
  padding: 15px 20px 13px;
  background: var(--fbts-panel2);
  border-bottom: 1px solid var(--fbts-line);
}
.fbts-titlebar-icon svg { width: 22px; height: 22px; }
.fbts-title { font-size: var(--font-size-heading, 18px); font-weight: var(--font-weight-semibold, 600); }
.fbts-sub { font-size: var(--fbts-label-size); }
.fbts-x {
  width: auto; height: 30px; padding: 0 12px; font-size: var(--fbts-ui-size);
  font-weight: var(--font-weight-medium, 450);
}
.fbts-x:hover { background: color-mix(in srgb, var(--fbts-ink) 8%, transparent); }

/* ---- tabs: a folder strip across the top of the page ---- */
.fbts-tabs {
  padding: 0 18px;
  gap: 3px;
  background: var(--fbts-panel2);
}
.fbts-tab {
  padding: 8px 17px 7px;
  border-radius: 7px 7px 0 0;
  font-size: var(--fbts-ui-size);
  font-weight: var(--font-weight-medium, 450);
}
.fbts-tab.active { padding-bottom: 8px; }

.fbts-body { padding: 14px 18px 26px; }
.fbts-footer { padding: 10px 18px; }
.fbts-group-head { padding: 7px 11px; font-size: var(--font-size-caption, 10px); }
.fbts-group-body { padding: 11px; }
/* Wide pages fit more thumbnails per row, which is the point of the grid. */
.fbts-presets { grid-template-columns: repeat(auto-fill, minmax(158px, 1fr)); gap: 12px; }
.fbts-group.scroll > .fbts-group-body { max-height: min(52vh, 520px); }
.fbts-knobs { gap: 12px 6px; }
.fbts-spot-row-label { width: 132px; font-size: var(--font-size-caption, 10px); }
.fbts-circle { width: 74px; }
.fbts-spot { width: 34px; height: 34px; }
.fbts-knob { width: 76px; }
.fbts-knob-dial { width: 50px; height: 50px; }
.fbts-knob-needle { height: 15px; margin-top: -15px; }
.fbts-circles { gap: 10px 4px; }
.fbts-row-label { font-size: var(--fbts-ui-size); }
.fbts-textinput { width: 128px; }
.fbts-toast { left: 50%; right: auto; bottom: 28px; transform: translate(-50%, 8px); }
.fbts-toast.show { transform: translate(-50%, 0); }
`

  function mount() {
    if (document.querySelector('[data-fbts-host]')) return

    var host = el('div', { 'data-fbts-host': '' })
    // Deliberately not `all: initial` - that would also reset the --fbts-* tokens
    // the shadow stylesheet inherits from :host.
    host.style.cssText = 'position: fixed; z-index: 2147483600; right: 0; bottom: 0; width: 0; height: 0; pointer-events: none;'
    document.body.appendChild(host)
    var shadow = host.attachShadow({ mode: 'open' })
    shadow.appendChild(el('style', { text: STYLES }))
    shadow.appendChild(el('style', { text: PAGE_STYLES }))

    var panel = el('div', { class: 'fbts-panel' })

    var toast = el('div', { class: 'fbts-toast' })
    var toastTimer = null
    function showToast(msg) {
      toast.textContent = msg
      toast.classList.add('show')
      clearTimeout(toastTimer)
      toastTimer = setTimeout(function () {
        toast.classList.remove('show')
      }, 3200)
    }

    // Saving can happen before the panel exists (a theme is migrated, or a
    // picture turns out to be too big). Those messages waited in queuedNotice
    // and are shown once the panel is on screen.
    saveNotice = function (msg) {
      showToast(msg)
    }

    /* ---- update chip + popup ---- */
    var UPDATE_ICON =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 3.5v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 20h15"/></svg>'

    var chipLabel = el('span', { text: 'Update' })
    var chip = el(
      'button',
      {
        class: 'fbts-update-chip',
        type: 'button',
        title: 'A newer version of Freebuff Theme Studio is available',
        onclick: function () {
          showUpdatePopup()
        },
      },
      [el('span', { html: UPDATE_ICON }), chipLabel],
    )

    var modalBody = el('div', { class: 'fbts-modal' })
    var modalWrap = el('div', { class: 'fbts-modal-wrap', onclick: function (e) { if (e.target === modalWrap) closePopup() } }, [modalBody])

    var remoteVersion = ''
    var checking = false
    var updateStatus = ''

    function showChip(version) {
      chipLabel.textContent = 'Update ' + version
      chip.classList.add('show')
    }
    function hideChip() {
      chip.classList.remove('show')
    }
    function closePopup() {
      modalWrap.classList.remove('show')
    }

    function openRelease(version) {
      // Freebuff's main process denies off-origin popups and hands the URL to
      // the system browser, so this never opens a second app window.
      try {
        window.open(RELEASES_URL + version, '_blank', 'noopener')
      } catch (e) {}
    }

    /** The release list, which is also where the installer is downloaded from. */
    function openReleasesPage() {
      try {
        window.open('https://github.com/RichardFlp/freebuff-ui/releases', '_blank', 'noopener')
      } catch (e) {}
    }

    function showUpdatePopup() {
      if (!remoteVersion) return
      modalBody.textContent = ''
      modalBody.appendChild(el('h3', { text: 'Update available' }))
      modalBody.appendChild(
        el('p', {}, [
          'Freebuff Theme Studio ',
          el('code', { text: 'v' + remoteVersion }),
          ' is out. You have ',
          el('code', { text: 'v' + VERSION }),
          '.',
        ]),
      )
      modalBody.appendChild(
        el('p', { text: 'Download the new installer from GitHub and run it the same way you installed this one. Your theme is kept.' }),
      )
      modalBody.appendChild(
        el('p', { text: 'Update opens the release page in your browser - nothing is downloaded automatically. Press Esc to decide later.' }),
      )
      modalBody.appendChild(el('p', { class: 'fbts-modal-match', text: 'Unofficial extension - not made by Freebuff.' }))
      modalBody.appendChild(
        el('div', { class: 'fbts-modal-foot' }, [
          el('button', {
            class: 'fbts-btn primary',
            type: 'button',
            text: 'Update',
            onclick: function () {
              openRelease(remoteVersion)
              closePopup()
              hideChip()
              showToast('Opening the release page')
            },
          }),
          el('button', {
            class: 'fbts-btn',
            type: 'button',
            text: 'Skip this version',
            onclick: function () {
              writeCookie(SKIP_COOKIE, remoteVersion, 365)
              closePopup()
              showChip(remoteVersion)
              showToast('Update button moved to the corner')
            },
          }),
        ]),
      )
      modalWrap.classList.add('show')
    }

    function isNewer(a, b) {
      if (!/^\d+(?:\.\d+){1,3}$/.test(String(a)) || !/^\d+(?:\.\d+){1,3}$/.test(String(b))) return false
      var pa = String(a).split('.')
      var pb = String(b).split('.')
      if (pa.length < 2) return false
      for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
        var na = parseInt(pa[i], 10) || 0
        var nb = parseInt(pb[i], 10) || 0
        if (na !== nb) return na > nb
      }
      return false
    }

    var cleanVersion = function (v) {
      var value = String(v == null ? '' : v).replace(/["'\s]/g, '')
      return /^\d+(?:\.\d+){1,3}$/.test(value) ? value : ''
    }

    /**
     * The release feed is a stylesheet that only declares
     * `--fbts-remote-version`. Reading it back through getComputedStyle works
     * even cross-origin, and a missing or blocked feed just means silence.
     */
    /** Ask one host for the feed. Calls back with the version, or '' if it could not. */
    function probeHost(url, done) {
      var link = document.createElement('link')
      link.rel = 'stylesheet'
      // jsDelivr ignores query strings for its own cache, so this parameter is
      // here to keep the *browser* honest: it would otherwise keep this file
      // for a week. A per-hour address caps browser staleness at an hour, while
      // the CDN's own entry is purged as part of publishing a release.
      link.href = url + '?h=' + new Date().toISOString().slice(0, 13)
      var settled = false

      function finish(version) {
        if (settled) return
        settled = true
        if (link.parentNode) link.parentNode.removeChild(link)
        done(version)
      }

      link.addEventListener('load', function () {
        var value = ''
        try {
          // Stylesheets from multiple edges declare the same property. Move
          // this loaded sheet to the end so the computed value belongs to this
          // host, not whichever CDN link happens to win the cascade.
          document.head.appendChild(link)
          value = getComputedStyle(document.documentElement).getPropertyValue(REMOTE_VERSION_VAR)
        } catch (e) {}
        finish(cleanVersion(value))
      })
      link.addEventListener('error', function () {
        finish('')
      })
      setTimeout(function () {
        finish('')
      }, CHECK_TIMEOUT)

      document.head.appendChild(link)
    }

    function autoUpdateOn() {
      return !state.settings || state.settings.autoUpdate !== false
    }

    function checkForUpdates(manual) {
      if (checking || !document.head) return
      if (!manual && !autoUpdateOn()) return
      var last = parseInt(readCookie(CHECK_COOKIE) || '0', 10)
      if (!manual && Date.now() - last < CHECK_INTERVAL) return
      checking = true
      updateStatus = 'checking'
      if (manual) showToast('Checking for updates\u2026')

      var remaining = FEED_URLS.length
      var newest = ''
      document.documentElement.setAttribute(UPDATE_PROBE, '')

      function finish(version) {
        if (!checking) return
        checking = false
        updateStatus = 'ok'
        document.documentElement.removeAttribute(UPDATE_PROBE)
        writeCookie(CHECK_COOKIE, String(Date.now()), 365)
        var previouslySeen = readCookie(CHECK_SEEN_COOKIE)
        writeCookie(CHECK_SEEN_COOKIE, version, 365)
        if (!isNewer(version, VERSION)) {
          if (manual) showToast('You are on the latest version')
          refreshVersionLabel()
          return
        }
        remoteVersion = version
        // Don't reopen a dismissed notice every hourly background poll.
        if (!manual && previouslySeen === version) {
          showChip(version)
          return
        }
        // A skipped version stays skipped: it only leaves the corner button.
        if (!manual && readCookie(SKIP_COOKIE) === version) {
          showChip(version)
          return
        }
        showUpdatePopup()
      }

      FEED_URLS.forEach(function (url) {
        probeHost(url, function (version) {
          if (version && (!newest || isNewer(version, newest))) newest = version
          if (--remaining === 0) {
            if (newest) finish(newest)
            else {
              checking = false
              updateStatus = 'failed'
              document.documentElement.removeAttribute(UPDATE_PROBE)
              if (manual) showToast('Could not check for updates')
              refreshVersionLabel()
            }
          }
        })
      })
    }

    var picker = colorPicker()
    var root = el('div', { class: 'fbts-root' }, [panel, toast, chip, modalWrap, picker.node])
    shadow.appendChild(root)

    /* ---- title bar ---- */
    var schemeLabel = el('span', {
      class: 'fbts-version',
      title: 'Check for updates',
      text: 'v' + VERSION,
      onclick: function () { checkForUpdates(true) },
    })

    /*
     * The version line doubles as the update-check readout, because a check
     * that fails silently is indistinguishable from one that never ran - which
     * is how "the auto update is not working" starts.
     */
    function refreshVersionLabel() {
      var presetDef = PRESET_BY_ID[state.preset]
      var tail = presetDef ? presetDef.label : 'custom'
      var mark = updateStatus === 'checking' ? '  \u00b7  checking\u2026' : updateStatus === 'failed' ? '  \u00b7  offline' : ''
      schemeLabel.textContent = 'v' + VERSION + '  \u00b7  ' + tail + mark
      schemeLabel.title =
        updateStatus === 'failed'
          ? 'Could not reach the update server. Click to try again.'
          : 'Check for updates' + (remoteVersion ? ' (latest seen: v' + remoteVersion + ')' : '')
    }
    var head = el('div', { class: 'fbts-titlebar' }, [
      el('span', { class: 'fbts-titlebar-icon', html: RAIL_ICON }),
      el('div', { class: 'fbts-titlebar-text' }, [
        el('div', { class: 'fbts-head-row' }, [
          el('div', { class: 'fbts-title', text: 'Theme Studio' }),
          el('span', {
            class: 'fbts-badge',
            title: 'A community extension. Not made by Freebuff.',
            text: 'Unofficial',
          }),
        ]),
        el('div', { class: 'fbts-sub' }, [
          schemeLabel,
          el('span', { class: 'fbts-sub-sep', text: '\u00b7' }),
          el('span', { text: 'not made by Freebuff' }),
        ]),
      ]),
      el('div', { class: 'grow' }),
      el('button', { class: 'fbts-x', title: 'Close', text: '\u00d7',        onclick: function () { togglePage(false) } }),
    ])

    /* ---- tabs ---- */
    var TAB_DEFS = [
      ['presets', 'Presets'],
      ['community', 'Community'],
      ['colors', 'Colors'],
      ['layout', 'Layout'],
      ['page', 'Logo and background'],
      ['advanced', 'Advanced'],
      ['io', 'Export'],
      ['settings', 'Settings'],
    ]
    var tabsBar = el('div', { class: 'fbts-tabs' })
    var body = el('div', { class: 'fbts-body' })
    var tabPanes = {}
    tabsBar.setAttribute('role', 'tablist')

    TAB_DEFS.forEach(function (def) {
      var tab = el('button', { class: 'fbts-tab', type: 'button', role: 'tab', text: def[1], onclick: function () { selectTab(def[0]) } })
      tab.dataset.tab = def[0]
      tab.id = 'fbts-tab-' + def[0]
      tabsBar.appendChild(tab)
    })

    function selectTab(id) {
      if (!tabPanes[id]) return
      Array.prototype.forEach.call(tabsBar.children, function (c) {
        var selected = c.dataset.tab === id
        c.classList.toggle('active', selected)
        c.setAttribute('aria-selected', selected ? 'true' : 'false')
        c.tabIndex = selected ? 0 : -1
        // The strip scrolls once there are more tabs than fit; keep the one in
        // use on screen, and never scroll the page while doing it.
        if (selected) {
          try {
            c.scrollIntoView({ block: 'nearest', inline: 'nearest' })
          } catch (e) {}
        }
      })
      for (var k in tabPanes) {
        var visible = k === id
        tabPanes[k].style.display = visible ? '' : 'none'
        tabPanes[k].hidden = !visible
      }
    }

    function pane(id) {
      var p = el('div')
      p.dataset.pane = id
      p.setAttribute('role', 'tabpanel')
      var tab = tabsBar.querySelector('[data-tab="' + id + '"]')
      if (tab) {
        p.setAttribute('aria-labelledby', tab.id || (tab.id = 'fbts-tab-' + id))
        tab.setAttribute('aria-controls', p.id || (p.id = 'fbts-pane-' + id))
      }
      tabPanes[id] = p
      body.appendChild(p)
      return p
    }

    /** A titled frame. Every panel on this page is one of these. */
    function group(title, children, opts) {
      opts = opts || {}
      var headRow = el('div', { class: 'fbts-group-head' }, [el('span', { text: title }), el('div', { class: 'grow' })],)
      ;(opts.actions || []).forEach(function (a) { headRow.appendChild(a) })
      return el('div', { class: 'fbts-group' + (opts.scroll ? ' scroll' : '') }, [
        headRow,
        el('div', { class: 'fbts-group-body' }, children),
      ])
    }

    /** A small link that sits in a group header. */
    function headLink(text, title, onclick) {
      var b = el('button', {
        class: 'fbts-head-link', type: 'button', text: text, title: title, onclick: onclick,
        style: 'background:none;border:0;color:inherit;font:inherit;letter-spacing:inherit;cursor:pointer;text-transform:inherit;padding:0',
      })
      return b
    }

    /** The miniature Freebuff that each preset card wears. */
    function thumbParts() {
      return [
        el('div', { class: 't-rail' }, [el('i'), el('i'), el('i'), el('i')]),
        el('div', { class: 't-side' }, [
          el('b', { class: 'w' }), el('b'), el('b'), el('b'), el('b'), el('b'),
        ]),
        el('div', { class: 't-main' }, [
          el('div', { class: 't-line', style: 'width:72%' }),
          el('div', { class: 't-line short' }),
          el('div', { class: 't-bubble' }),
          el('div', { class: 't-composer' }),
        ]),
      ]
    }

    /**
     * Colours for one thumbnail. The Default card shows the palette Freebuff
     * ships with, not the theme in use - otherwise it would just mirror
     * whatever is applied and say nothing.
     */
    function thumbStyle(p) {
      var c = p.colors || STOCK_COLORS
      return (
        '--t-bg:' + c['--bg'] +
        ';--t-surface:' + c['--surface-2'] +
        ';--t-chrome:' + c['--chrome'] +
        ';--t-text:' + c['--text'] +
        ';--t-muted:' + c['--muted'] +
        ';--t-brand:' + c['--brand']
      )
    }

    /*
     * The colour picker. One of these lives on the page and is pointed at a
     * token set whenever a spot or a Colors-tab swatch is clicked, so picking a
     * colour never depends on the native dialog - which is exactly where the
     * round spots were failing.
     */
    function colorPicker() {
      var titleEl = el('span', { class: 'fbts-picker-title' })
      var tokenEl = el('code', { class: 'fbts-picker-token' })
      var closeBtn = el('button', { class: 'fbts-x', type: 'button', text: '\u00d7', title: 'Close' })
      var svDot = el('span', { class: 'fbts-sv-dot' })
      var sv = el('div', { class: 'fbts-sv' }, [svDot])
      var hueThumb = el('span', { class: 'fbts-hue-thumb' })
      var hue = el('div', { class: 'fbts-hue' }, [hueThumb])
      var alpha = el('input', { class: 'fbts-alpha-wide', type: 'range', min: '0', max: '100', step: '1' })
      var hex = el('input', { class: 'fbts-textinput', type: 'text', spellcheck: 'false' })
      var preview = el('span', { class: 'fbts-preview' })
      var resetBtn = el('button', { class: 'fbts-btn', type: 'button', text: 'Reset' })
      var doneBtn = el('button', { class: 'fbts-btn primary', type: 'button', text: 'Done' })

      /*
       * Fill: one flat colour, or a gradient between two of them. A gradient is
       * saved under the same token name as the colour it covers, so a theme
       * with gradients needs no extra vocabulary - and theme files written
       * before this existed keep working, because a theme without a gradient is
       * just a theme with no gradients.
       */
      var stops = { from: { h: 0, s: 0, v: 0, a: 1 }, to: { h: 0, s: 0, v: 0, a: 1 } }
      var activeStop = 'from'
      var mode = 'solid'
      var gradAngle = 160

      function cur() {
        return stops[activeStop]
      }

      var modeBtns = {}
      var modeRow = el('div', { class: 'fbts-picker-row' }, [el('span', { class: 'fbts-picker-label', text: 'Fill' })])
      ;[
        ['solid', 'Solid', 'One flat colour'],
        ['linear', 'Linear', 'A gradient in a straight line'],
        ['radial', 'Radial', 'A gradient from the middle outwards'],
      ].forEach(function (pair) {
        var b = el('button', { class: 'fbts-mode', type: 'button', text: pair[1], title: pair[2] })
        b.addEventListener('click', function () { setMode(pair[0]) })
        modeBtns[pair[0]] = b
        modeRow.appendChild(b)
      })

      var stopSw = {}
      var stopBtns = {}
      var stopRow = el('div', { class: 'fbts-picker-row' }, [el('span', { class: 'fbts-picker-label', text: 'Stop' })])
      ;[
        ['from', 'A'],
        ['to', 'B'],
      ].forEach(function (pair) {
        var sw = el('span', { class: 'fbts-stopswatch' })
        var b = el('button', { class: 'fbts-stopbtn', type: 'button', title: 'Edit stop ' + pair[1] }, [sw, el('span', { text: pair[1] })])
        b.addEventListener('click', function () { activeStop = pair[0]; paint() })
        stopSw[pair[0]] = sw
        stopBtns[pair[0]] = b
        stopRow.appendChild(b)
      })

      var angle = el('input', { class: 'fbts-alpha-wide', type: 'range', min: '0', max: '360', step: '1' })
      var angleRow = el('div', { class: 'fbts-picker-row' }, [el('span', { class: 'fbts-picker-label', text: 'Angle' }), angle])

      var box = el('div', { class: 'fbts-picker' }, [
        el('div', { class: 'fbts-picker-head' }, [titleEl, tokenEl, el('div', { class: 'grow' }), closeBtn]),
        el('div', { class: 'fbts-picker-body' }, [
          modeRow,
          stopRow,
          sv,
          hue,
          angleRow,
          el('div', { class: 'fbts-picker-row' }, [el('span', { class: 'fbts-picker-label', text: 'Opacity' }), alpha]),
          el('div', { class: 'fbts-picker-row' }, [el('span', { class: 'fbts-picker-label', text: 'Hex' }), hex, preview]),
        ]),
        el('div', { class: 'fbts-picker-foot' }, [resetBtn, el('div', { class: 'grow' }), doneBtn]),
      ])

      var target = null // { label, tokens: [] }
      var notify = null
      var anchor = null

      function setMode(next) {
        mode = next
        push()
      }

      function paint() {
        var c = cur()
        var css = hsvaCss(c, c.a)
        sv.style.setProperty('--fbts-hue-color', hsvToHex(c.h, 100, 100))
        svDot.style.left = c.s + '%'
        svDot.style.top = 100 - c.v + '%'
        hueThumb.style.left = (c.h / 360) * 100 + '%'
        alpha.value = String(Math.round(c.a * 100))
        preview.style.background = mode === 'solid' ? css : gradientCss({ type: mode, angle: gradAngle, from: stopColor('from'), to: stopColor('to') })
        hex.value = hsvToHex(c.h, c.s, c.v)
        angle.value = String(Math.round(gradAngle))

        for (var k in modeBtns) modeBtns[k].classList.toggle('active', mode === k)
        var on = mode !== 'solid'
        stopRow.style.display = on ? '' : 'none'
        angleRow.style.display = mode === 'linear' ? '' : 'none'
        for (var s in stopSw) {
          var sv2 = stops[s]
          stopSw[s].style.background = hsvaCss(sv2, sv2.a)
          stopBtns[s].classList.toggle('active', on && activeStop === s)
        }
      }

      function stopColor(which) {
        var s = stops[which]
        return { hex: hsvToHex(s.h, s.s, s.v), a: s.a }
      }

      /**
       * Write the picker's colour onto every token the target covers.
       *
       * A target with no tokens is a callback one: it is editing something that
       * is not a custom property (the window buttons), so the value is handed
       * to the caller instead of being written into state.colors.
       */
      function push() {
        if (!target) return
        var value = stopColor(activeStop)
        var wanted = mode === 'solid' ? null : { type: mode, angle: gradAngle, from: stopColor('from'), to: stopColor('to') }
        if (target.tokens.length) {
          target.tokens.forEach(function (t) {
            // The solid colour is kept underneath either way: it is what the
            // picker opens with next time, and what the gradient falls back to
            // wherever the token is read as a colour.
            state.colors[t] = value
            delete state.layout[t]
            if (wanted) state.gradients[t] = clone(wanted)
            else delete state.gradients[t]
          })
          applyState()
          saveState(state)
          refreshSpots()
        }
        paint()
        if (notify) notify(value.hex, value.a, wanted)
      }

      /** Adopt the colour, or the gradient, a target already has. */
      function loadCurrent(tokens, explicit) {
        var g = explicit && explicit.gradient ? explicit.gradient : tokens.length ? state.gradients[tokens[0]] : null
        if (g) {
          mode = g.type
          gradAngle = g.angle
          stops.from = hsvFromColor(g.from)
          stops.to = hsvFromColor(g.to)
          activeStop = 'from'
          return
        }
        mode = 'solid'
        gradAngle = 160
        activeStop = 'from'
        var base = explicit && explicit.color ? explicit.color : tokens.length ? currentColorFor(tokens[0]) : { hex: '#808080', a: 1 }
        // parseColor() only reads strings, and currentColorFor() hands back an
        // object - so accept both rather than quietly falling through to grey.
        var c = asColorValue(base) || { hex: '#808080', a: 1 }
        stops.from = hsvFromColor(c)
        // Stop B starts a little lighter than stop A, so switching a fill to a
        // gradient shows something rather than a flat bar.
        var b = hsvFromColor(c)
        b.v = Math.min(100, b.v + 28)
        b.s = Math.max(0, b.s - 18)
        stops.to = b
      }

      function hsvFromColor(c) {
        var rgb = [parseInt(c.hex.slice(1, 3), 16), parseInt(c.hex.slice(3, 5), 16), parseInt(c.hex.slice(5, 7), 16)]
        var hsv = rgbToHsv(rgb[0], rgb[1], rgb[2])
        return { h: hsv.h, s: hsv.s, v: hsv.v, a: c.a == null ? 1 : c.a }
      }

      /** A {hex,a} object or a colour string, as {hex,a} - or null. */
      function asColorValue(v) {
        if (v && typeof v === 'object' && typeof v.hex === 'string') return { hex: v.hex, a: v.a == null ? 1 : v.a }
        if (typeof v === 'string') {
          var parsed = parseColor(v)
          return parsed ? { hex: parsed.hex, a: parsed.a == null ? 1 : parsed.a } : null
        }
        return null
      }

      function open(next, anchorEl) {
        target = next
        notify = next.onChange || null
        anchor = anchorEl
        loadCurrent(next.tokens || [], next.initial)
        titleEl.textContent = next.label
        tokenEl.textContent = next.solidOnly ? '' : next.tokens.join(' ')
        modeRow.style.display = next.solidOnly ? 'none' : ''
        if (next.solidOnly) mode = 'solid'
        paint()
        place()
        box.classList.add('show')
      }

      /** Keep the popup beside its spot and inside the window. */
      function place() {
        if (!anchor || !anchor.isConnected) return
        var r = anchor.getBoundingClientRect()
        var w = box.offsetWidth || 272
        var h = box.offsetHeight || 240
        var left = r.left + r.width / 2 - w / 2
        var top = r.top - h - 10
        if (top < 8) top = r.bottom + 10
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
        top = Math.max(8, Math.min(top, window.innerHeight - h - 8))
        box.style.left = Math.round(left) + 'px'
        box.style.top = Math.round(top) + 'px'
      }

      function close() {
        box.classList.remove('show')
        target = null
        notify = null
      }

      function drag(el, onMove) {
        el.addEventListener('pointerdown', function (e) {
          if (e.button !== 0) return
          e.preventDefault()
          var move = function (ev) { onMove(ev) }
          move(e)
          var up = function () {
            el.removeEventListener('pointermove', move)
            document.removeEventListener('pointerup', up, true)
          }
          el.addEventListener('pointermove', move)
          document.addEventListener('pointerup', up, true)
        })
      }

      drag(sv, function (e) {
        var r = sv.getBoundingClientRect()
        var c = cur()
        c.s = bound(((e.clientX - r.left) / r.width) * 100, 0, 100)
        c.v = bound(100 - ((e.clientY - r.top) / r.height) * 100, 0, 100)
        push()
      })
      drag(hue, function (e) {
        var r = hue.getBoundingClientRect()
        cur().h = bound(((e.clientX - r.left) / r.width) * 360, 0, 360)
        push()
      })

      alpha.addEventListener('input', function () {
        cur().a = bound(parseFloat(alpha.value) / 100, 0, 1)
        push()
      })
      angle.addEventListener('input', function () {
        gradAngle = bound(parseFloat(angle.value) || 0, 0, 360)
        push()
      })
      hex.addEventListener('input', function () {
        var parsed = parseColor(hex.value)
        if (!parsed) return
        var rgb = [parseInt(parsed.hex.slice(1, 3), 16), parseInt(parsed.hex.slice(3, 5), 16), parseInt(parsed.hex.slice(5, 7), 16)]
        var hsv = rgbToHsv(rgb[0], rgb[1], rgb[2])
        var c = cur()
        c.h = hsv.h
        c.s = hsv.s
        c.v = hsv.v
        push()
      })
      resetBtn.addEventListener('click', function () {
        if (!target) return
        if (!target.tokens.length && typeof target.onReset === 'function') {
          target.onReset()
          close()
          return
        }
        target.tokens.forEach(function (t) {
          delete state.colors[t]
          delete state.layout[t]
          delete state.gradients[t]
        })
        applyState()
        saveState(state)
        loadCurrent(target.tokens)
        paint()
        refreshSpots()
        if (notify) notify(stopColor('from').hex, stops.from.a)
        showToast('Back to the preset')
      })
      closeBtn.addEventListener('click', close)
      doneBtn.addEventListener('click', close)
      document.addEventListener(
        'pointerdown',
        function (e) {
          if (!box.classList.contains('show')) return
          var path = e.composedPath ? e.composedPath() : []
          if (path.indexOf(box) !== -1) return
          // clicking another spot re-targets instead of closing
          for (var i = 0; i < path.length; i++) {
            if (path[i] && path[i].classList && path[i].classList.contains('fbts-circle')) return
          }
          close()
        },
        true,
      )

      return { node: box, open: open, close: close, place: place, isOpen: function () { return box.classList.contains('show') } }
    }

    /*
     * A dial. Drag up or down, scroll, or use the arrow keys; double-click puts
     * it back to the middle. Values land in state.adjust and retune the whole
     * palette through currentValues().
     */
    function knob(def) {
      var needle = el('span', { class: 'fbts-knob-needle' })
      var dial = el('div', { class: 'fbts-knob-dial' }, [needle])
      var valueEl = el('div', { class: 'fbts-knob-value' })
      var node = el(
        'div',
        { class: 'fbts-knob', role: 'slider', tabindex: '0', title: def.label + ' - drag or scroll, double-click to reset' },
        [dial, valueEl, el('div', { class: 'fbts-knob-label', text: def.label })],
      )
      var span = def.max - def.min

      function current() {
        var v = Number(state.adjust ? state.adjust[def.key] : NaN)
        return isFinite(v) ? v : DEFAULT_ADJUST[def.key]
      }

      function render() {
        var v = current()
        var t = (v - def.min) / span
        needle.style.transform = 'rotate(' + (-135 + t * 270).toFixed(1) + 'deg)'
        dial.style.setProperty('--fbts-knob-fill', (t * 270).toFixed(1) + 'deg')
        valueEl.textContent = (v > 0 && def.key === 'hue' ? '+' : '') + v + def.unit
        node.setAttribute('aria-label', def.label + ' adjustment, currently ' + v + def.unit)
        node.setAttribute('aria-valuenow', String(v))
      }

      function set(v) {
        v = bound(Math.round(v / def.step) * def.step, def.min, def.max)
        if (v === current()) return
        state.adjust[def.key] = v
        applyState()
        saveState(state)
        render()
        // A dial retunes the whole palette, so the spots and swatches follow.
        refreshSpots()
      }

      var lastY = 0
      var dragging = false
      node.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return
        dragging = true
        lastY = e.clientY
        e.preventDefault()
        node.focus()
        try {
          node.setPointerCapture(e.pointerId)
        } catch (err) {}
      })
      node.addEventListener('pointermove', function (e) {
        if (!dragging) return
        var dy = e.clientY - lastY
        lastY = e.clientY
        set(current() - dy * (e.shiftKey ? 0.15 : 1) * (span / 200))
      })
      function endDrag() {
        if (!dragging) return
        dragging = false
        showToast(def.label + ': ' + current() + def.unit)
      }
      node.addEventListener('pointerup', endDrag)
      node.addEventListener('pointercancel', endDrag)
      node.addEventListener('dblclick', function () { set(DEFAULT_ADJUST[def.key]) })
      node.addEventListener(
        'wheel',
        function (e) {
          e.preventDefault()
          set(current() + (e.deltaY < 0 ? def.step : -def.step) * (e.shiftKey ? 10 : 1))
        },
        { passive: false },
      )
      node.addEventListener('keydown', function (e) {
        var nudge = def.step * (e.shiftKey ? 10 : 1)
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set(current() + nudge)
        else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set(current() - nudge)
        else if (e.key === 'Home') set(DEFAULT_ADJUST[def.key])
        else return
        e.preventDefault()
        e.stopPropagation()
      })

      render()
      return { node: node, def: def, render: render, set: set }
    }

    /* ---- persistence helpers ---- */
    /*
     * One committed change, then redraw everything that shows the theme.
     *
     * refreshSpots() used to be left out, and every change that went through
     * here - a preset, a scheme switch, a radius, a hex typed into the Colors
     * tab - left the colour spots painted with the previous theme's colours
     * until something else happened to redraw them. That is the reported
     * "quick colours do not change after I choose a template".
     */
    function commit(message) {
      applyState()
      saveState(state)
      refreshActive()
      refreshSpots()
      if (message) showToast(message)
    }

    function setOverride(token, value) {
      if (value == null || value === '') {
        delete state.colors[token]
        delete state.layout[token]
        delete state.gradients[token]
      } else if (typeof value === 'object') {
        state.colors[token] = value
        delete state.layout[token]
        delete state.gradients[token]
      } else {
        state.layout[token] = value
        delete state.colors[token]
        delete state.gradients[token]
      }
      commit()
    }

    function currentColorFor(token) {
      if (state.colors[token]) {
        var c = state.colors[token]
        return typeof c === 'string' ? parseColor(c) || { hex: '#000000', a: 1 } : { hex: c.hex, a: c.a == null ? 1 : c.a }
      }
      return resolveTokenColor(token) || { hex: '#808080', a: 1 }
    }

    /** How a token should be painted right now: its gradient, or its colour. */
    function fillFor(token) {
      var g = state.gradients[token]
      if (g) return gradientCss(g)
      return toCss(currentColorFor(token))
    }

    /** Redraw every spot from the live colours, and mark the ones you changed. */
    function refreshSpots() {
      spotNodes.forEach(function (s) {
        s.dot.style.background = fillFor(s.tokens[0])
        var changed = false
        for (var i = 0; i < s.tokens.length; i++) if (state.colors[s.tokens[i]] || state.gradients[s.tokens[i]]) changed = true
        s.node.classList.toggle('overridden', changed)
      })
      /*
       * Keep the Colors tab in step too: swatch, hex and alpha. A row that
       * has focus is somebody mid-edit, so it keeps what they are typing.
       * Rows with no swatch are the layout rows - a text value, not a colour -
       * and are left alone.
       */
      Array.prototype.forEach.call(shadow.querySelectorAll('[data-token]'), function (row) {
        var sw = row.querySelector('.fbts-swatchinput')
        if (!sw) return
        var token = row.dataset.token
        sw.style.background = fillFor(token)
        var c = currentColorFor(token)
        var txt = row.querySelector('input[type=text]')
        if (txt && txt !== shadow.activeElement) txt.value = c.hex
        var alpha = row.querySelector('input[type=range]')
        if (alpha && alpha !== shadow.activeElement) alpha.value = String(Math.round(c.a * 100))
      })
    }

    function refreshKnobs() {
      knobs.forEach(function (k) { k.render() })
    }

    /* ---- color row ---- */
    function colorRow(token, labelText) {
      var initial = currentColorFor(token)
      // The swatch opens the in-page picker rather than a native colour dialog.
      var colorInput = el('button', { class: 'fbts-swatchinput', type: 'button', title: 'Pick a colour' })
      colorInput.style.background = toCss(initial)
      var alpha = el('input', { class: 'fbts-alpha', type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(initial.a * 100)) })
      var hex = el('input', { class: 'fbts-textinput', type: 'text', value: initial.hex, spellcheck: 'false' })
      var reset = el('button', { class: 'fbts-mini', title: 'Reset', text: '\u21ba' })

      function paintSwatch(hexValue, a) {
        var g = state.gradients[token]
        colorInput.style.background = g ? gradientCss(g) : toCss({ hex: hexValue, a: a == null ? 1 : a })
      }

      function push(commitNow) {
        var parsed = parseColor(hex.value) || { hex: '#000000', a: 1 }
        var a = parseFloat(alpha.value) / 100
        paintSwatch(parsed.hex, a)
        if (commitNow) setOverride(token, { hex: parsed.hex, a: a })
      }

      colorInput.addEventListener('click', function () {
        picker.open(
          {
            label: labelText || token,
            tokens: [token],
            onChange: function (picked, a) {
              hex.value = picked
              alpha.value = String(Math.round(a * 100))
              paintSwatch(picked, a)
            },
          },
          colorInput,
        )
      })
      hex.addEventListener('input', function () {
        var parsed = parseColor(hex.value)
        if (parsed) push(true)
      })
      alpha.addEventListener('input', function () { push(true) })
      reset.addEventListener('click', function () {
        delete state.gradients[token]
        setOverride(token, null)
        var fresh = resolveTokenColor(token) || { hex: '#808080', a: 1 }
        hex.value = fresh.hex
        alpha.value = String(Math.round(fresh.a * 100))
        paintSwatch(fresh.hex, fresh.a)
        showToast('Reset ' + token)
      })

      var row = el('div', { class: 'fbts-row', 'data-token': token }, [
        el('div', { class: 'fbts-row-label', title: token }, [
          el('span', { text: labelText || token }),
          el('code', { text: token }),
        ]),
        colorInput,
        alpha,
        hex,
        reset,
      ])
      return row
    }

    /* ---- text/size row ---- */
    function textRow(token, labelText) {
      var current = state.layout[token] || ''
      var input = el('input', {
        class: 'fbts-textinput', type: 'text', value: current, placeholder: 'app default', spellcheck: 'false',
        oninput: function () {
          var value = input.value.trim()
          var safe = value ? sanitizeLayoutValue(token, value) : ''
          if (value && !safe) {
            input.setCustomValidity('Use a plain CSS value for this token (no rules, URLs, braces or !important).')
            input.reportValidity()
            return
          }
          input.setCustomValidity('')
          setOverride(token, safe || null)
        },
      })
      var reset = el('button', {
        class: 'fbts-mini', title: 'Reset', text: '\u21ba',
        onclick: function () {
          input.value = ''
          setOverride(token, null)
          showToast('Reset ' + token)
        },
      })
      return el('div', { class: 'fbts-row', 'data-token': token }, [
        el('div', { class: 'fbts-row-label', title: token }, [
          el('span', { text: labelText || token }),
          el('code', { text: token }),
        ]),
        input,
        reset,
      ])
    }

    /* ---- Presets tab ---- */
    var presetsPane = pane('presets')
    var presetsGrid = el('div', { class: 'fbts-presets' })
    PRESETS.forEach(function (p) {
      var card = el(
        'div',
        {
          class: 'fbts-preset', 'data-preset': p.id, title: 'Apply ' + p.label,
          onclick: function () {
            state.preset = p.id
            state.colors = {}
            // A solid preset must not inherit gradients from the previous theme.
            state.gradients = {}
            applyState()
            saveState(state, true)
            // The Community tab keeps its own highlight; a preset is not that
            // theme any more. Cleared first, so the rebuild below repaints
            // both highlights from the same state.
            communityActiveId = ''
            // A preset swaps the whole theme, so every row and spot is reseeded
            // from it - commit() alone left them showing the previous theme.
            rebuild()
            renderCommunity()
            showToast('Applied ' + p.label)
          },
        },
        [el('div', { class: 'fbts-thumb', style: thumbStyle(p) }, thumbParts()), el('div', { class: 'fbts-preset-name', text: p.label })],
      )
      presetsGrid.appendChild(card)
    })
    presetsPane.appendChild(group('Presets', [presetsGrid], { scroll: true }))

    /* Dials: they retune whatever palette is in use. */
    var knobRow = el('div', { class: 'fbts-knobs' })
    var knobs = []
    ADJUST_DEFS.forEach(function (def) {
      var k = knob(def)
      knobs.push(k)
      knobRow.appendChild(k.node)
    })
    presetsPane.appendChild(
      group(
        'Adjustments',
        [
          knobRow,
          el('div', { class: 'fbts-note', text: 'Retunes the palette above. Drag a dial up or down, scroll on it, or use the arrow keys. Double-click resets one dial.' }),
        ],
        {
          actions: [
            headLink('Reset', 'Put every dial back', function () {
              state.adjust = clone(DEFAULT_ADJUST)
              commit('Adjustments reset')
              refreshKnobs()
            }),
          ],
        },
      ),
    )

    /*
     * Colour spots: the tokens people reach for, in rows by job. One spot can
     * stand for several tokens (--brand and --brand-2 are the same colour in
     * every preset, and setting only one of them would half-apply).
     */
    var SPOT_GROUPS = [
      ['Surfaces', [
        ['Background', ['--bg', '--workspace-surface']],
        ['Chrome', ['--chrome', '--shell-base']],
        ['Sidebar', ['--sidebar-canvas', '--sidebar-row-background']],
        ['Surface', ['--surface']],
        ['Surface 2', ['--surface-2', '--input', '--bubble']],
        ['Raised', ['--raised', '--popover', '--selected']],
      ]],
      ['Text', [
        ['Text', ['--text', '--sidebar-ink']],
        ['Muted', ['--muted', '--sidebar-muted']],
        ['Faint', ['--faint', '--placeholder']],
        ['Accent text', ['--accent']],
        ['Button text', ['--primary-action-text']],
      ]],
      ['Brand', [
        ['Brand', ['--brand', '--brand-2']],
        ['Brand light', ['--brand-1']],
        ['Brand tint', ['--brand-3']],
        ['Brand dim', ['--brand-dim']],
        ['Primary action', ['--primary-action']],
        ['Links', ['--brand-ink']],
      ]],
      ['Lines and status', [
        ['Border', ['--border', '--control-border']],
        ['Ok', ['--ok', '--green']],
        ['Warning', ['--warn', '--premium']],
        ['Danger', ['--danger']],
        ['Info', ['--info']],
      ]],
      ['Code', [
        ['Comment', ['--syntax-comment']],
        ['Keyword', ['--syntax-keyword']],
        ['String', ['--syntax-string']],
        ['Number', ['--syntax-number']],
        ['Function', ['--syntax-function']],
        ['Type', ['--syntax-type']],
        ['Property', ['--syntax-property']],
      ]],
    ]

    var allSpotTokens = []
    var spotsRow = el('div')
    var spotNodes = []
    SPOT_GROUPS.forEach(function (entry) {
      var row = el('div', { class: 'fbts-circles' })
      entry[1].forEach(function (spot) {
        var label = spot[0]
        var tokens = spot[1]
        allSpotTokens = allSpotTokens.concat(tokens)
        var dot = el('span', { class: 'fbts-spot' })
        function handBack() {
          var changed = false
          tokens.forEach(function (t) {
            if (state.colors[t] || state.gradients[t]) changed = true
            delete state.colors[t]
            delete state.gradients[t]
          })
          if (!changed) return
          applyState()
          saveState(state, true)
          refreshSpots()
          picker.close()
          showToast(label + ' is back to the preset')
        }
        var btn = el('button', {
          class: 'fbts-circle', type: 'button',
          title: label + ' - ' + tokens.join(', ') + ' (right-click to hand it back to the preset)',
          onclick: function () { picker.open({ label: label, tokens: tokens }, btn) },
          oncontextmenu: function (e) { e.preventDefault(); handBack() },
        }, [dot, el('span', { class: 'fbts-circle-label', text: label })])
        spotNodes.push({ tokens: tokens, dot: dot, node: btn })
        row.appendChild(btn)
      })
      spotsRow.appendChild(el('div', { class: 'fbts-spot-row' }, [el('span', { class: 'fbts-spot-row-label', text: entry[0] }), row]))
    })
    presetsPane.appendChild(
      group('Colour spots', [
        spotsRow,
        el('div', { class: 'fbts-note', style: 'margin-top:8px', text: 'Click a spot to pick a colour for it. Right-click one to hand it back to the preset. Every other colour is in the Colors tab.' }),
      ], {
        actions: [
          headLink('Reset', 'Hand every spot back to the preset', function () {
            allSpotTokens.forEach(function (t) {
              delete state.colors[t]
              delete state.gradients[t]
            })
            applyState()
            saveState(state, true)
            refreshSpots()
            showToast('Colour spots reset')
          }),
          headLink('All colours', 'Open the Colors tab', function () { selectTab('colors') }),
        ],
      }),
    )

    /* The light/dark preference controls live on the Settings tab now. */
    var schemeRow = el('div')
    ;[
      ['auto', 'Match the preset'],
      ['dark', 'Dark mode'],
      ['light', 'Light mode'],
    ].forEach(function (pair) {
      var input = el('input', { type: 'radio', name: 'fbts-scheme', value: pair[0], 'data-scheme': pair[0] })
      input.addEventListener('change', function () {
        state.scheme = pair[0] === 'auto' ? '' : pair[0]
        document.documentElement.style.removeProperty('color-scheme')
        commit('Scheme: ' + pair[0])
      })
      schemeRow.appendChild(el('label', { class: 'fbts-option' }, [input, el('span', { text: pair[1] })]))
    })

    /* ---- Colors tab ---- */
    var colorsPane = pane('colors')
    colorsPane.appendChild(el('div', { class: 'fbts-note', text: 'Changes apply instantly and are saved automatically. \u21ba resets a single token.' }))
    var colorPanels = {}

    GROUP_ORDER.forEach(function (groupName) {
      var tokens = CURATED.filter(function (x) {
        return x.group === groupName
      })
      if (!tokens.length) return
      var isOpen = groupName === 'Surfaces' || groupName === 'Brand'
      var acc = el('div', { class: 'fbts-accordion' + (isOpen ? ' open' : '') })
      var headEl = el('div', { class: 'fbts-accordion-head' }, [
        el('span', { class: 'chev', text: '\u25b6' }),
        el('span', { text: groupName }),
        el('span', { class: 'grow', style: 'flex:1' }),
        el('span', { style: 'color:var(--fbts-faint);font-size:10px', text: String(tokens.length) }),
      ])
      headEl.addEventListener('click', function () { acc.classList.toggle('open') })
      var bodyEl = el('div', { class: 'fbts-accordion-body' })
      tokens.forEach(function (tk) {
        var row = tk.kind === 'color' ? colorRow(tk.name, tk.label) : textRow(tk.name, tk.label)
        bodyEl.appendChild(row)
      })
      acc.appendChild(headEl)
      acc.appendChild(bodyEl)
      colorsPane.appendChild(acc)
      colorPanels[groupName] = { acc: acc, body: bodyEl, tokens: tokens }
    })

    /* ---- Layout tab ---- */
    var layoutPane = pane('layout')
    /*
     * Every token that rounds a corner.
     *
     * The Corner radius buttons used to set twelve of these and look like they
     * were not working, because the corners people actually look at are rounded
     * by tokens the buttons did not touch: the workspace box is rounded by
     * --workspace-corner (declared on .desktop-shell, so setting it on <html>
     * did nothing), and the settings page rounds itself with
     * --settings-card-radius / --settings-control-radius / --settings-popup-radius
     * / --settings-corner. --radius, --radius-block and --sidebar-row-radius are
     * aliases of others, and are pinned too so the aliases cannot disagree with
     * what they point at.
     */
    var CORNER_TOKENS = [
      '--radius-xs', '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl',
      '--radius-control', '--radius-chrome-control', '--radius-popup', '--radius-composer',
      '--radius-dialog', '--radius-block', '--radius-inline', '--radius',
      '--sidebar-row-radius', '--settings-card-radius', '--settings-control-radius',
      '--settings-popup-radius', '--settings-corner', '--clip-radius', '--workspace-corner',
    ]
    var RADIUS_TOKENS = CORNER_TOKENS.concat(['--radius-round'])
    var FONT_TOKENS = ['--font-size-caption', '--font-size-label', '--font-size-ui', '--font-size-body', '--font-size-message', '--font-size-title', '--font-size-heading', '--font-size-display']
    var SIZE_TOKENS = ['--chat-content-max-width', '--explorer-width', '--catalog-width', '--tabbar-height', '--control-height-md', '--sidebar-row-gap']

    function layoutGroup(title, tokens) {
      var acc = el('div', { class: 'fbts-accordion open' })
      var headEl = el('div', { class: 'fbts-accordion-head' }, [el('span', { class: 'chev', text: '\u25b6' }), el('span', { text: title })])
      headEl.addEventListener('click', function () { acc.classList.toggle('open') })
      var bodyEl = el('div', { class: 'fbts-accordion-body' })
      tokens.forEach(function (name) {
        var meta = CURATED.filter(function (x) { return x.name === name })[0]
        bodyEl.appendChild(textRow(name, meta ? meta.label : name))
      })
      acc.appendChild(headEl)
      acc.appendChild(bodyEl)
      return acc
    }

    function radiusPreset(title, value) {
      return el('button', {
        class: 'fbts-btn', text: title,
        title: 'Set every corner to ' + value,
        onclick: function () {
          CORNER_TOKENS.forEach(function (t) { state.layout[t] = value })
          // --radius-round is the "fully round" token (pills, avatars). Leaving
          // it alone keeps Round and Pill looking round instead of squaring off
          // every pill in the app; Square means square, so it goes too.
          state.layout['--radius-round'] = value === '0px' ? '0px' : '999px'
          commit('Radius: ' + title)
        },
      })
    }

    function fontScale(factor) {
      var base = { '--font-size-caption': 10, '--font-size-label': 11, '--font-size-ui': 12, '--font-size-body': 13, '--font-size-message': 14, '--font-size-title': 15, '--font-size-heading': 20, '--font-size-display': 24 }
      return el('button', {
        class: 'fbts-btn', text: Math.round(factor * 100) + '%',
        onclick: function () {
          for (var k in base) state.layout[k] = Math.round(base[k] * factor * 100) / 100 + 'px'
          commit('Text scale: ' + Math.round(factor * 100) + '%')
        },
      })
    }

    layoutPane.appendChild(
      group('Corner radius', [
        el('div', { class: 'fbts-actions', style: 'border:none;background:none;padding:0' }, [
          radiusPreset('Square', '0px'),
          radiusPreset('Subtle', '6px'),
          radiusPreset('Round', '12px'),
          radiusPreset('Pill', '24px'),
        ]),
      ]),
    )
    layoutPane.appendChild(
      group('Text scale', [
        el('div', { class: 'fbts-actions', style: 'border:none;background:none;padding:0' }, [
          fontScale(0.9), fontScale(1), fontScale(1.1), fontScale(1.2),
        ]),
      ]),
    )
    layoutPane.appendChild(
      group('Typography', [
        layoutGroup('Fonts', ['--font-sans', '--font-mono']),
        layoutGroup('Font sizes', FONT_TOKENS),
      ]),
    )
    layoutPane.appendChild(group('Radii', [layoutGroup('Radius tokens', RADIUS_TOKENS)]))
    layoutPane.appendChild(group('Dimensions', [layoutGroup('Sizing', SIZE_TOKENS)]))

    /*
     * ================================================================
     * Logo and background
     * ================================================================
     *
     * Both are pictures, so both are stored as data URLs and travel inside the
     * theme: a .fbtheme file with a background in it needs no hosting and no
     * extra files. The price is size, so both are scaled to fit a budget on the
     * way in and kept in cookie series of their own - a picture can then only
     * ever cost the picture, never the colours.
     */

    // Filled in by the two panes below, and called by rebuild() after a theme
    // is imported, so the controls follow the state instead of the other way
    // round.
    var pageRefresh = null

    /*
     * Picking a picture. A small file is passed through untouched; anything
     * over the budget for its slot is scaled down and re-encoded first, so
     * what reaches the state is always something the theme can remember.
     */
    function readImageFile(file, kind, cb) {
      if (!file) return
      if (!/^image\/(png|jpe?g|gif|webp|avif|svg\+xml)$/i.test(file.type || '')) {
        showToast('Choose a PNG, JPG, GIF, WebP, AVIF or SVG image')
        return
      }
      if (file.size > 24 * 1024 * 1024) {
        showToast('That picture is over 24 MB - please resize it first')
        return
      }
      var limit = IMAGE_KINDS[kind] || IMAGE_KINDS.background
      /*
       * A file that is small on disk can still be over budget once it is a
       * data URL: base64 adds about a third, and a URL-encoded SVG can double.
       * So the budget is checked on the encoded result, not the file size,
       * and anything that lands over it goes through the same resize path as a
       * big picture rather than being stored at any size.
       */
      var isSvg = /^image\/svg\+xml/i.test(file.type)
      if (file.size <= limit.maxBytes || isSvg) {
        var reader = new FileReader()
        reader.onload = function () {
          var data = cleanDataUrl(String(reader.result == null ? '' : reader.result))
          if (!data) {
            showToast('That file is not a supported image')
            return
          }
          if (!imageOverBudget(data, kind)) {
            cb(data)
            return
          }
          fitImage(data, kind, function (fitted) {
            if (!fitted) {
              showToast('That picture does not fit the theme size limit - try a smaller one')
              return
            }
            cb(fitted)
          })
        }
        reader.onerror = function () { showToast('Could not read that file') }
        reader.readAsDataURL(file)
        return
      }
      var url = null
      try {
        url = URL.createObjectURL(file)
      } catch (e) {
        showToast('Could not read that file')
        return
      }
      fitImage(url, kind, function (fitted) {
        try {
          URL.revokeObjectURL(url)
        } catch (e) {}
        if (!fitted) {
          showToast('Could not read that picture')
          return
        }
        cb(fitted)
      })
    }

    function imagePicker(label, kind, onPick) {
      var input = el('input', {
        type: 'file', style: 'display:none',
        accept: 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml',
      })
      input.addEventListener('change', function () {
        var f = input.files && input.files[0]
        input.value = ''
        readImageFile(f, kind, onPick)
      })
      var btn = el('button', { class: 'fbts-btn', type: 'button', text: label, onclick: function () { input.click() } })
      return { input: input, btn: btn }
    }

    function previewBox(getSrc, emptyText) {
      var box = el('div', { class: 'fbts-imgbox' })
      function render() {
        var src = getSrc()
        box.textContent = ''
        if (src) box.appendChild(el('img', { src: src, alt: '' }))
        else box.appendChild(el('span', { text: emptyText }))
      }
      render()
      return { node: box, render: render }
    }

    function sliderRow(label, min, max, step, get, set, fmt) {
      var val = el('span', { class: 'fbts-slider-val' })
      var input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) })
      function render() {
        var v = get()
        input.value = String(v)
        val.textContent = fmt ? fmt(v) : String(v)
      }
      input.addEventListener('input', function () {
        set(parseFloat(input.value))
        val.textContent = fmt ? fmt(parseFloat(input.value)) : input.value
      })
      render()
      return { node: el('div', { class: 'fbts-slider' }, [el('span', { text: label }), input, val]), render: render }
    }

    function segRow(label, options, get, set) {
      var btns = {}
      var row = el('div', { class: 'fbts-picker-row' }, [el('span', { class: 'fbts-picker-label', text: label })])
      options.forEach(function (pair) {
        var b = el('button', { class: 'fbts-mode', type: 'button', text: pair[1], title: pair[2] || pair[1] })
        b.addEventListener('click', function () {
          set(pair[0])
          render()
        })
        btns[pair[0]] = b
        row.appendChild(b)
      })
      function render() {
        var v = get()
        for (var k in btns) btns[k].classList.toggle('active', k === v)
      }
      render()
      return { node: row, render: render }
    }

    var pagePane = pane('page')

    /* ---- the logo ---- */
    var logoPreview = previewBox(function () { return state.logo.image }, 'No picture - Freebuff draws its own mark.')
    var logoPick = imagePicker('Choose a picture', 'logo', function (raw) {
      var url = cleanDataUrl(raw)
      if (!url) {
        showToast('That file is not an image')
        return
      }
      state.logo.image = url
      commit('Logo changed')
      renderLogo()
    })
    var logoSize = sliderRow('Size', 0.5, 3, 0.05, function () { return state.logo.size }, function (v) {
      state.logo.size = v
      commit()
    }, function (v) { return Math.round(v * 100) + '%' })
    var logoOpacity = sliderRow('Opacity', 0.05, 1, 0.05, function () { return state.logo.opacity }, function (v) {
      state.logo.opacity = v
      commit()
    }, function (v) { return Math.round(v * 100) + '%' })
    var logoFilter = el('input', {
      class: 'fbts-textinput', type: 'text', spellcheck: 'false', placeholder: 'CSS filter, e.g. invert(1)',
      oninput: function () {
        state.logo.filter = logoFilter.value.trim().slice(0, 120)
        commit()
      },
    })
    var logoClear = el('button', {
      class: 'fbts-btn', type: 'button', text: 'Remove',
      onclick: function () {
        state.logo = clone(DEFAULT_LOGO)
        commit('Logo cleared')
        renderLogo()
      },
    })

    function renderLogo() {
      logoFilter.value = state.logo.filter || ''
      logoPick.btn.textContent = state.logo.image ? 'Replace picture' : 'Choose a picture'
      logoPreview.render()
      logoSize.render()
      logoOpacity.render()
    }

    pagePane.appendChild(
      group('Freebuff logo', [
        el('div', { class: 'fbts-grid' }, [
          logoPreview.node,
          el('div', { class: 'fbts-col' }, [
            el('div', { class: 'fbts-actions', style: 'border:none;background:none;padding:0' }, [logoPick.btn, logoClear]),
            logoPick.input,
            logoSize.node,
            logoOpacity.node,
            el('div', { class: 'fbts-picker-row' }, [el('span', { class: 'fbts-picker-label', text: 'Filter' }), logoFilter]),
          ]),
        ]),
        el('div', {
          class: 'fbts-note',
          text: 'SVG, PNG, JPG, GIF or WebP. It replaces the mark on the new-thread screen, the loading screen, the splash and the project sidebar wordmark. Size and opacity only affect the watermark, which Freebuff draws very faint on purpose. Like the background picture, a logo is kept for this session only - Export the theme to keep it.',
        }),
      ], { actions: [headLink('Reset', 'Back to Freebuff\u2019s own mark', function () {
        state.logo = clone(DEFAULT_LOGO)
        commit('Logo cleared')
        renderLogo()
      })] }),
    )

    /* ---- the background picture ---- */
    var bgPreview = previewBox(function () { return state.background.image }, 'No picture - the theme\u2019s own colour is used.')
    var bgPick = imagePicker('Choose a picture', 'background', function (raw) {
      var url = cleanDataUrl(raw)
      if (!url) {
        showToast('That file is not an image')
        return
      }
      state.background.image = url
      commit('Background changed')
      renderBackground()
    })
    var bgFit = segRow('Fit', [
      ['cover', 'Cover', 'Fill the area, cropping what does not fit'],
      ['contain', 'Fit', 'Fit the whole picture inside'],
      ['tile', 'Tile', 'Repeat it at its own size'],
      ['stretch', 'Stretch', 'Stretch it to fill, ignoring the shape'],
    ], function () { return state.background.fit }, function (v) { state.background.fit = v; commit() })
    var bgPos = segRow('Position', [
      ['center', 'Middle'], ['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right'],
    ], function () { return state.background.position }, function (v) { state.background.position = v; commit() })
    var bgWhere = segRow('Where', [
      ['workspace', 'Workspace', 'The chat and editor area only'],
      ['whole', 'Whole window', 'Behind the sidebar and the tab bar too'],
    ], function () { return state.background.whole ? 'whole' : 'workspace' }, function (v) {
      state.background.whole = v === 'whole'
      commit()
    })
    var bgOpacity = sliderRow('Opacity', 0.05, 1, 0.05, function () { return state.background.opacity }, function (v) {
      state.background.opacity = v
      commit()
    }, function (v) { return Math.round(v * 100) + '%' })
    var bgDim = sliderRow('Dim', 0, 0.9, 0.05, function () { return state.background.dim }, function (v) {
      state.background.dim = v
      commit()
    }, function (v) { return Math.round(v * 100) + '%' })
    var bgClear = el('button', {
      class: 'fbts-btn', type: 'button', text: 'Remove',
      onclick: function () {
        state.background = clone(DEFAULT_BACKGROUND)
        commit('Background cleared')
        renderBackground()
      },
    })

    function renderBackground() {
      bgPick.btn.textContent = state.background.image ? 'Replace picture' : 'Choose a picture'
      bgPreview.render()
      bgFit.render()
      bgPos.render()
      bgWhere.render()
      bgOpacity.render()
      bgDim.render()
    }

    pagePane.appendChild(
      group('Background picture', [
        el('div', { class: 'fbts-grid' }, [
          bgPreview.node,
          el('div', { class: 'fbts-col' }, [
            el('div', { class: 'fbts-actions', style: 'border:none;background:none;padding:0' }, [bgPick.btn, bgClear]),
            bgPick.input,
            bgWhere.node,
          ]),
        ]),
        el('div', { class: 'fbts-col', style: 'margin-top:9px' }, [bgFit.node, bgPos.node, bgOpacity.node, bgDim.node]),
        el('div', {
          class: 'fbts-note',
          text: 'The picture is saved inside the theme, so it travels with a .fbtheme file and needs no hosting. Big pictures are scaled down to fit what a theme can remember (about 150 KB, up to 2560 px on the long side), so nothing huge reaches the page. Freebuff\u2019s own storage cannot hold a picture between launches without breaking its own requests, so a picture lasts for this session: Export the theme to keep it, or bake it into the install with the injector. Dim adds a dark veil; opacity lets the theme colour show through.',
        }),
      ], { actions: [headLink('Reset', 'Remove the background picture', function () {
        state.background = clone(DEFAULT_BACKGROUND)
        commit('Background cleared')
        renderBackground()
      })] }),
    )

    /*
     * The minimise / maximise / close buttons.
     *
     * They have no custom property to set - the app paints them with
     * `color: var(--faint)` and hardcodes #fff for the close button's hover -
     * so they are reached by a rule in the page stylesheet and edited through
     * the picker's callback mode.
     */
    var windowRows = []

    function windowRow(key, labelText, hint) {
      var swatch = el('button', { class: 'fbts-swatchinput', type: 'button', title: 'Pick a colour' })
      var hexRead = el('span', { class: 'fbts-author' })
      var reset = el('button', {
        class: 'fbts-mini', title: 'Follow the theme again', text: '\u21ba',
        onclick: function () {
          state.window[key] = ''
          commit('Window buttons reset')
          renderWindowRows()
          showToast(labelText + ' follows the theme again')
        },
      })
      swatch.addEventListener('click', function () {
        picker.open(
          {
            label: labelText,
            tokens: [],
            solidOnly: true,
            initial: { color: state.window[key] || resolveTokenColor('--faint') },
            onChange: function (hexValue, a) {
              state.window[key] = toCss({ hex: hexValue, a: a == null ? 1 : a })
              commit()
              renderWindowRows()
            },
            onReset: function () {
              state.window[key] = ''
              commit('Window buttons reset')
              renderWindowRows()
              showToast(labelText + ' follows the theme again')
            },
          },
          swatch,
        )
      })
      var row = { key: key, swatch: swatch, hexRead: hexRead, node: null }
      row.node = el('div', { class: 'fbts-row' }, [
        el('div', { class: 'fbts-row-label', title: hint || labelText }, [
          el('span', { text: labelText }),
          el('code', { text: hint || '' }),
        ]),
        swatch,
        hexRead,
        reset,
      ])
      windowRows.push(row)
      return row.node
    }

    function renderWindowRows() {
      windowRows.forEach(function (r) {
        var v = state.window[r.key]
        r.swatch.style.background = v || resolveTokenColor('--faint')
        r.swatch.classList.toggle('empty', !v)
        r.hexRead.textContent = v ? 'set' : 'theme'
      })
    }

    pagePane.appendChild(
      group('Window buttons', [
        el('div', {
          class: 'fbts-note',
          style: 'margin:0 0 9px',
          text: 'The minimise, maximise and close buttons in the corner. They follow the theme\u2019s faint text colour until you set one here.',
        }),
        windowRow('ink', 'Button colour', '.window-control'),
        windowRow('hoverInk', 'Hover icon', '.window-control:hover'),
        windowRow('hoverBg', 'Hover background', '.window-control:hover'),
        windowRow('closeInk', 'Close icon on hover', '.window-control-close:hover'),
        windowRow('closeBg', 'Close background on hover', '.window-control-close:hover'),
      ], {
        actions: [headLink('Reset', 'Hand all five back to the theme', function () {
          state.window = clone(DEFAULT_WINDOW)
          commit('Window buttons reset')
          renderWindowRows()
        })],
      }),
    )

    renderLogo()
    renderBackground()
    renderWindowRows()
    pageRefresh = function () {
      renderLogo()
      renderBackground()
      renderWindowRows()
    }

    /*
     * ================================================================
     * Community themes
     * ================================================================
     *
     * The list lives in its own asset (assets/community-themes.js), which the
     * installer writes next to the engine and loads first. It is a plain data
     * file, so adding a theme is a one-file pull request - and because it ships
     * with the extension, this tab works with no network at all.
     */
    var communityPane = pane('community')
    var communityRefresh = null
    var SUBMIT_URL = 'https://github.com/RichardFlp/freebuff-ui/issues/new'

    function communityThemes() {
      var src = window.__FREEBUFF_THEME_COMMUNITY__
      var list = (src && src.themes) || []
      var out = []
      for (var i = 0; i < list.length; i++) {
        var e = list[i]
        if (!e) continue
        var theme = null
        try {
          // A share code is preferred when present: it survives being pasted
          // into a file more or less anywhere.
          if (e.shareCode) theme = parseThemeText(e.shareCode)
          else if (e.theme) theme = normalizeState(e.theme)
        } catch (err) {
          theme = null
        }
        if (!theme) continue
        theme.name = e.name || theme.name
        out.push({ id: e.id || 'community-' + i, name: theme.name, author: e.author || '', note: e.note || '', theme: theme })
      }
      return out
    }

    /** Hex strings for a thumbnail, resolved through the theme's own preset. */
    function previewColors(s) {
      var out = {}
      var p = s.preset !== 'default' ? PRESET_BY_ID[s.preset] : null
      if (p && p.colors) for (var k in p.colors) out[k] = p.colors[k]
      for (var c in s.colors) out[c] = toCss(s.colors[c])
      return out
    }

    function applyThemeObject(next, label) {
      state = normalizeState(next)
      shrinkThemeImages(state, function () {
        applyState()
        saveState(state, true)
        rebuild()
        showToast('Applied "' + label + '"')
      })
    }

    var community = communityThemes()
    var communityGrid = el('div', { class: 'fbts-presets' })
    var communityEmpty = el('div', {
      class: 'fbts-note',
      text: 'No community themes are bundled with this build.',
      style: 'margin:0',
    })
    var communityCards = {}
    var communityActiveId = ''

    function renderCommunity() {
      for (var id in communityCards) {
        communityCards[id].card.classList.toggle('active', id === communityActiveId)
      }
    }

    community.forEach(function (entry) {
      // The author's own description rides along in the tooltip rather than in a
      // box of its own, which took up a third of the tab to say very little.
      var tip = 'Apply ' + entry.name
      if (entry.note) tip += '\n' + entry.note
      if (entry.author) tip += '\nby ' + entry.author
      var card = el('div', { class: 'fbts-preset', title: tip })
      var thumb = el('div', { class: 'fbts-thumb', style: thumbStyle({ colors: previewColors(entry.theme) }) }, thumbParts())
      card.appendChild(thumb)
      card.appendChild(el('div', { class: 'fbts-preset-name', text: entry.name }))
      if (entry.author) card.appendChild(el('div', { class: 'fbts-author', text: 'by ' + entry.author }))
      card.addEventListener('click', function () {
        communityActiveId = entry.id
        applyThemeObject(entry.theme, entry.name)
        renderCommunity()
      })
      communityGrid.appendChild(card)
      communityCards[entry.id] = { card: card, entry: entry }
    })

    communityPane.appendChild(
      group(community.length ? 'Community themes' : 'Community themes', [
        el('div', {
          class: 'fbts-community-note',
          html:
            'Themes made by other people, shipped inside the extension. Click one to apply it - it ' +
            'overwrites the theme you are editing, so save yours first if you want to keep it.',
        }),
        community.length ? communityGrid : communityEmpty,
      ], {
        actions: community.length
          ? [headLink('Save one', 'Save the theme you are looking at as a file', function () {
              download(JSON.stringify(themeDocument(state), null, 2), themeFileName(state.name))
              showToast('Saved ' + themeFileName(state.name))
            })]
          : [],
      }),
    )

    /* ---- submit one ---- */
    function submitUrl() {
      var name = state.name || 'Untitled'
      var body = [
        '### Theme name',
        name,
        '',
        '### What it is',
        'One or two lines about the look, and anything it is based on.',
        '',
        '### Sharing it',
        'Export it with Save .fbtheme, then drag the file into this issue.',
        'You can paste the Share code too - either works.',
        '',
        '### Checklist',
        '- [ ] I attached the .fbtheme file (or pasted the share code)',
        '- [ ] It is my own work, or I have permission to share it',
        '- [ ] The theme name is set in the editor',
        '',
        'Thank you. Accepted themes are added to the Community tab of the next release.',
      ].join('\n')
      return SUBMIT_URL + '?title=' + encodeURIComponent('Community theme: ' + name) + '&body=' + encodeURIComponent(body)
    }

    communityPane.appendChild(
      group('Submit your own', [
        el('div', {
          class: 'fbts-community-note',
          html:
            'Three steps. <b>1.</b> Set the theme name. <b>2.</b> Save it as a .fbtheme file. ' +
            '<b>3.</b> Open the submission page and drag the file in.',
        }),
        el('div', { class: 'fbts-actions', style: 'border:none;background:none;padding:0' }, [
          el('button', {
            class: 'fbts-btn primary', type: 'button', text: 'Open the submission page',
            onclick: function () {
              try {
                window.open(submitUrl(), '_blank', 'noopener')
              } catch (e) {}
              showToast('Opening GitHub')
            },
          }),
          el('button', {
            class: 'fbts-btn', type: 'button', text: 'Save .fbtheme',
            onclick: function () {
              download(JSON.stringify(themeDocument(state), null, 2), themeFileName(state.name))
              showToast('Saved ' + themeFileName(state.name))
            },
          }),
          el('button', {
            class: 'fbts-btn', type: 'button', text: 'Copy share code',
            onclick: function () { copyText(shareCode(state), 'Share code copied') },
          }),
        ]),
        el('div', {
          class: 'fbts-note',
          text: 'The submission page opens in your browser and is pre-filled with a short form. Nothing is sent anywhere until you press Submit there.',
        }),
      ]),
    )

    communityRefresh = renderCommunity
    renderCommunity()

    /* ---- Advanced tab ---- */
    var advPane = pane('advanced')
    var rawArea = el('textarea', { class: 'fbts-textarea', spellcheck: 'false', placeholder: '/* e.g. .composer { backdrop-filter: blur(20px); } */' })
    rawArea.value = state.raw || ''
    var rawTimer = null
    rawArea.addEventListener('input', function () {
      state.raw = rawArea.value
      clearTimeout(rawTimer)
      rawTimer = setTimeout(function () {
        applyState()
        saveState(state)
      }, 250)
    })
    advPane.appendChild(
      group('Raw CSS', [
        rawArea,
        el('div', { class: 'fbts-note', text: 'Injected as a <style> tag. Anything CSS can do, this can do.' }),
      ]),
    )

    var search = el('input', { class: 'fbts-search', type: 'text', placeholder: 'Filter tokens\u2026' })
    var advList = el('div')
    advPane.appendChild(
      group('All tokens', [
        el('div', { class: 'fbts-note', style: 'margin:0 0 8px', text: 'Every custom property Freebuff ships. Non-colour values are edited as text.' }),
        search,
        advList,
      ], { scroll: true }),
    )
    var advRows = []
    ALL_TOKENS.forEach(function (name) {
      var meta = CURATED.filter(function (x) { return x.name === name })[0]
      var label = meta ? meta.label : name
      var row = meta && meta.kind === 'color' ? colorRow(name, label) : textRow(name, label)
      row.dataset.search = name.toLowerCase()
      advRows.push(row)
      advList.appendChild(row)
    })
    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase()
      advRows.forEach(function (r) { r.style.display = !q || r.dataset.search.indexOf(q) !== -1 ? '' : 'none' })
    })

    /* ---- Export tab ---- */
    var ioPane = pane('io')
    var nameInput = el('input', { class: 'fbts-search', type: 'text', placeholder: 'Theme name' })
    nameInput.value = state.name || 'Custom'
    nameInput.addEventListener('input', function () {
      state.name = nameInput.value
      saveState(state)
      // The name travels with the theme, so the generated boxes must follow it.
      refreshActive()
    })
    ioPane.appendChild(group('Theme name', [nameInput]))

    function copyText(text, okMessage) {
      if (!navigator.clipboard) {
        showToast('Clipboard unavailable')
        return
      }
      navigator.clipboard.writeText(text).then(function () { showToast(okMessage) }).catch(function () { showToast('Copy failed') })
    }

    /* "This theme": generated output, kept in step with the live theme. */
    var exportArea = el('textarea', { class: 'fbts-textarea', spellcheck: 'false', readonly: 'readonly' })
    ioPane.appendChild(
      group('This theme', [
        exportArea,
        el('div', { class: 'fbts-actions', style: 'border:none;background:none;padding:8px 0 0' }, [
          el('button', {
            class: 'fbts-btn primary', text: 'Save .fbtheme',
            onclick: function () {
              download(JSON.stringify(themeDocument(state), null, 2), themeFileName(state.name))
              showToast('Saved ' + themeFileName(state.name))
            },
          }),
          el('button', {
            class: 'fbts-btn', text: 'Copy theme',
            onclick: function () { copyText(exportArea.value, 'Theme JSON copied') },
          }),
          el('button', {
            class: 'fbts-btn', text: 'Copy CSS',
            onclick: function () { copyText(cssText(), 'CSS copied') },
          }),
        ]),
      ]),
    )

    var shareInput = el('input', {
      class: 'fbts-search',
      type: 'text',
      readonly: 'readonly',
      style: 'font-family:var(--fbts-mono);font-size:11px',
      title: 'One line that carries the whole theme',
    })
    ioPane.appendChild(
      group('Share code', [
        el('div', { class: 'fbts-code-row' }, [
          shareInput,
          el('button', {
            class: 'fbts-btn', text: 'Copy',
            onclick: function () { copyText(shareInput.value, 'Share code copied') },
          }),
        ]),
        el('div', { class: 'fbts-note', style: 'margin:0', text: 'One line, so it survives being pasted into a chat or an issue.' }),
      ]),
    )

    /* "Paste a theme": the editable box. Nothing overwrites this one. */
    var importArea = el('textarea', {
      class: 'fbts-textarea',
      spellcheck: 'false',
      style: 'min-height:104px',
      placeholder: 'Paste a share code, or the contents of a .fbtheme file.',
    })

    var fileInput = el('input', { type: 'file', accept: '.fbtheme,.json,application/json', style: 'display:none' })
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0]
      fileInput.value = ''
      if (file) readThemeFile(file)
    })

    ioPane.appendChild(
      group('Open a theme', [
        importArea,
        fileInput,
        el('div', { class: 'fbts-actions', style: 'border:none;background:none;padding:8px 0 0' }, [
          el('button', {
            class: 'fbts-btn primary', text: 'Import',
            onclick: function () { importThemeFromText(importArea.value) },
          }),
          el('button', {
            class: 'fbts-btn', text: 'Choose a file',
            onclick: function () { fileInput.click() },
          }),
        ]),
        el('div', { class: 'fbts-note', text: 'You can also drop a .fbtheme file anywhere on this page.' }),
      ]),
    )

    /* ---- Settings tab ---- */
    var settingsPane = pane('settings')
    // Assigned below; refreshActive() runs after all panes exist, and guards
    // on it in case a caller reaches it first.
    var settingsRefresh = null

    /** A labelled checkbox that reads and writes one value. */
    function toggleRow(labelText, note, get, set) {
      var input = el('input', { type: 'checkbox' })
      input.checked = !!get()
      input.addEventListener('change', function () { set(input.checked) })
      var node = el('div', { class: 'fbts-setting' }, [
        el('label', { class: 'fbts-option' }, [input, el('span', { text: labelText })]),
        note ? el('div', { class: 'fbts-note', style: 'margin:2px 0 0 22px', text: note }) : null,
      ])
      return { node: node, render: function () { input.checked = !!get() } }
    }

    function settingsGroup(title, children) {
      return group(title, children)
    }

    var followToggle = toggleRow(
      'Let a theme switch Freebuff\u2019s light or dark appearance',
      'On: a dark theme also puts Freebuff into dark, so no panel is left on the light palette. Off: Freebuff keeps the appearance you chose in its own settings.',
      function () { return !state.settings || state.settings.followThemeAppearance !== false },
      function (on) {
        state.settings.followThemeAppearance = on
        commit(on ? 'Themes may switch the app appearance' : 'Freebuff keeps its own appearance')
      },
    )

    var autoUpdateToggle = toggleRow(
      'Check for new versions automatically',
      'One quiet check per hour, when the page is open. The button below always works.',
      function () { return !state.settings || state.settings.autoUpdate !== false },
      function (on) {
        state.settings.autoUpdate = on
        commit(on ? 'Automatic update checks on' : 'Automatic update checks off')
      },
    )

    var storageReadout = el('div', { class: 'fbts-note', style: 'margin:0 0 8px' })
    var updateReadout = el('div', { class: 'fbts-note', style: 'margin:0 0 8px' })
    var skippedReadout = el('div', { class: 'fbts-note', style: 'margin:0 0 8px' })

    function storageReport() {
      var payload = JSON.stringify(cookiePayload(state))
      var encoded = toBase64Url(payload)
      var chunks = encoded.length ? Math.ceil(encoded.length / COOKIE_CHUNK) : 0
      return {
        payload: payload.length,
        chunks: chunks,
        fits: chunks <= COOKIE_MAX_THEME_CHUNKS,
        maxChunks: COOKIE_MAX_THEME_CHUNKS,
        raw: (state.raw || '').length,
      }
    }

    function formatBytes(n) {
      if (n < 1024) return n + ' B'
      return (Math.round((n / 1024) * 10) / 10) + ' KB'
    }

    function lastCheckedText() {
      var raw = parseInt(readCookie(CHECK_COOKIE) || '0', 10)
      if (!raw) return 'Not checked yet on this profile.'
      var mins = Math.round((Date.now() - raw) / 60000)
      if (mins < 1) return 'Checked just now.'
      if (mins < 60) return 'Checked ' + mins + ' minute' + (mins === 1 ? '' : 's') + ' ago.'
      var hours = Math.round(mins / 60)
      if (hours < 24) return 'Checked ' + hours + ' hour' + (hours === 1 ? '' : 's') + ' ago.'
      return 'Checked ' + Math.round(hours / 24) + ' days ago.'
    }

    function renderSettings() {
      followToggle.render()
      autoUpdateToggle.render()
      var rep = storageReport()
      storageReadout.textContent =
        'Theme: ' + formatBytes(rep.payload) + ' of at most ' + rep.maxChunks + ' x ' + formatBytes(COOKIE_CHUNK) +
        ' (' + rep.chunks + ' of ' + rep.maxChunks + ' chunks used' + (rep.fits ? ')' : ' - too big, it will not be stored)') +
        '. Custom CSS: ' + formatBytes(rep.raw) + ' of ' + formatBytes(COOKIE_MAX_RAW) + ' stored.'
      updateReadout.textContent = 'You are on v' + VERSION + ' (installed engine). ' + lastCheckedText()
      var skipped = readCookie(SKIP_COOKIE)
      skippedReadout.textContent = skipped ? 'Version ' + skipped + ' is skipped.' : 'No version is being skipped.'
    }
    settingsRefresh = renderSettings

    function eraseAllThemeCookies() {
      var names = []
      document.cookie.split(';').forEach(function (entry) {
        var name = entry.trim().split('=')[0]
        if (name && name.indexOf('fbts') === 0) names.push(name)
      })
      names.forEach(eraseCookie)
      return names.length
    }

    /**
     * Everything this page is allowed to delete, and nothing else: every style
     * it has written into Freebuff, every cookie it has stored, and the session
     * cache. It is the first half of the Delete button; the second half is a
     * request the guard outside the page carries out.
     */
    function clearPageSideData() {
      var name
      for (name in applied.colors) unsetVar(name)
      for (name in applied.layout) unsetVar(name)
      applied = { colors: {}, layout: {} }
      state = clone(DEFAULT_STATE)
      stateDirty = false
      pending = null
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      var rawStyle = document.getElementById(RAW_STYLE_ID)
      if (rawStyle) rawStyle.remove()
      var pageStyle = document.getElementById(PAGE_STYLE_ID)
      if (pageStyle) pageStyle.remove()
      var cookies = eraseAllThemeCookies()
      try {
        localStorage.removeItem(LS_KEY)
      } catch (e) {}
      document.documentElement.style.removeProperty('color-scheme')
      wantedDataTheme = appDataTheme || null
      enforceAppThemeAttribute()
      rebuild()
      refreshKnobs()
      renderSettings()
      return cookies
    }

    /**
     * Ask the guard to take Theme Studio off the machine.
     *
     * A web page cannot delete files in Freebuff's install folder, and it
     * cannot end the guard's process either - that is the browser sandbox doing
     * its job. What it can do is leave a request in the one store it owns, and
     * the guard reads that out of the cookie jar on its next pass: it clears the
     * stored theme, removes the injected scripts, the engine and the community
     * file, puts index.html back, and then takes itself away.
     *
     * Freebuff closes as part of that, because Chromium holds the cookie jar in
     * memory and would otherwise write the theme straight back after it was
     * deleted. The confirm step says so before anything happens.
     */
    function requestRemoval() {
      if (removalRequested) return true
      var cookies = clearPageSideData()
      // Written after the wipe above, which erases every fbts cookie - the
      // request among them. The value is epoch milliseconds rather than an ISO
      // string on purpose: a ':' in a cookie value is stored percent-encoded,
      // and the guard would then be parsing "%3A" out of the jar. Digits need
      // no escaping, so what the guard reads is what was written here.
      var written = false
      try {
        written = writeCookie(UNINSTALL_COOKIE, String(Date.now()), 1)
      } catch (e) {
        written = false
      }
      if (written) {
        removalRequested = true
        // The icon goes with the request, not with the files: the page that
        // drew it is the page the request came from.
        removeRailButton()
      }
      showRemoveProgress(cookies, written)
      return written
    }

    /** Offer the theme as a file before it is deleted. Exporting is one click
     *  in the Export tab, but nobody finds it while staring at a delete prompt. */
    function saveThemeCopy() {
      try {
        download(JSON.stringify(themeDocument(state), null, 2), themeFileName(state.name))
        showToast('Saved ' + themeFileName(state.name))
      } catch (e) {
        showToast('Could not save the theme file')
      }
    }

    function showDeleteConfirm() {
      modalBody.textContent = ''
      modalBody.appendChild(el('h3', { text: 'Delete Theme Studio?' }))
      modalBody.appendChild(
        el('p', { text: 'This deletes your stored theme, the automatic-update settings, the session cache and every style this page has written into Freebuff - and then removes the panel itself: the injected scripts and the engine come out of the install folder, and Freebuff\u2019s own index.html is put back. It cannot be undone, so save a .fbtheme first if you want to keep the theme.' }),
      )
      modalBody.appendChild(
        el('p', { text: 'Freebuff closes to finish the job and opens again as stock Freebuff, so save anything else you are working on before going ahead.' }),
      )
      modalBody.appendChild(
        el('div', { class: 'fbts-modal-foot' }, [
          el('button', {
            class: 'fbts-btn danger', type: 'button', text: 'Delete everything',
            onclick: function () {
              closePopup()
              requestRemoval()
            },
          }),
          el('button', { class: 'fbts-btn', type: 'button', text: 'Save a copy first', onclick: saveThemeCopy }),
          el('button', { class: 'fbts-btn', type: 'button', text: 'Cancel', onclick: function () { closePopup() } }),
        ]),
      )
      modalWrap.classList.add('show')
    }

    /** What the request produced. A page cannot watch its own removal - the
     *  guard has to close Freebuff to clear the cookie jar - so this says what
     *  was done from here, what happens next, and how to finish it by hand if
     *  no guard is running. */
    function showRemoveProgress(cookieCount, requested) {
      modalBody.textContent = ''
      if (!requested) {
        modalBody.appendChild(el('h3', { text: 'Could not leave the request' }))
        modalBody.appendChild(
          el('p', {
            text: 'Your theme, its settings and every style this page wrote are gone, but the panel could not ask the guard to remove itself: cookies are blocked, and a cookie is the only place the guard can read the request from. Run the installer once more with --uninstall to finish.',
          }),
        )
      } else {
        modalBody.appendChild(el('h3', { text: 'Removing Theme Studio' }))
        modalBody.appendChild(
          el('p', {}, [
            'Deleted ' + cookieCount + ' theme cookies, the session cache and every style this page had written. ',
            'The background guard does the rest on its next pass - within about 15 seconds. It clears the stored theme, removes the injected scripts, the engine and the community file, and puts Freebuff\u2019s own index.html back. ',
            'Freebuff closes while that happens, and opens again as stock Freebuff.',
          ]),
        )
      }
      modalBody.appendChild(
        el('p', { text: 'If nothing happens within a minute the guard is not running - the installer\u2019s --uninstall does exactly the same removal from outside.' }),
      )
      var command = el('code', { class: 'fbts-code', text: 'FreebuffThemeInjector.exe --uninstall' })
      modalBody.appendChild(el('p', {}, [command]))
      modalBody.appendChild(
        el('div', { class: 'fbts-modal-foot' }, [
          el('button', {
            class: 'fbts-btn primary', type: 'button', text: 'Copy the command',
            onclick: function () { copyText('FreebuffThemeInjector.exe --uninstall', 'Command copied') },
          }),
          el('button', { class: 'fbts-btn', type: 'button', text: 'Get the installer again', onclick: function () { openReleasesPage() } }),
          el('button', { class: 'fbts-btn', type: 'button', text: 'Close', onclick: function () { closePopup() } }),
        ]),
      )
      modalWrap.classList.add('show')
    }

    settingsPane.appendChild(
      settingsGroup('Light and dark', [
        schemeRow,
        followToggle.node,
        el('div', { class: 'fbts-note', text: 'The scheme controls Freebuff\u2019s own light or dark palette, which is what the settings page, dialogs and this panel inherit. The colours above are separate and stay whatever the theme says.' }),
      ]),
    )

    settingsPane.appendChild(
      settingsGroup('Updates', [
        autoUpdateToggle.node,
        updateReadout,
        el('div', { class: 'fbts-actions', style: 'border:none;background:none;padding:0' }, [
          el('button', { class: 'fbts-btn', type: 'button', text: 'Check now', onclick: function () { checkForUpdates(true); setTimeout(renderSettings, 1500) } }),
        ]),
        skippedReadout,
        el('div', { class: 'fbts-actions', style: 'border:none;background:none;padding:0' }, [
          el('button', {
            class: 'fbts-btn', type: 'button', text: 'Forget skipped version',
            onclick: function () {
              eraseCookie(SKIP_COOKIE)
              renderSettings()
              showToast('Skipped version forgotten')
            },
          }),
          headLink('What\u2019s new', 'Open the release list', function () { openReleasesPage() }),
        ]),
      ]),
    )

    settingsPane.appendChild(
      settingsGroup('Storage', [
        storageReadout,
        el('div', { class: 'fbts-note', text: 'The theme is kept in Freebuff\u2019s own cookie store, which is the only place that survives a restart because the app takes a new port every launch. Background pictures and logos are session-only by design; export a theme file to keep one.' }),
        el('div', { class: 'fbts-actions', style: 'border:none;background:none;padding:0' }, [
          el('button', {
            class: 'fbts-btn', type: 'button', text: 'Save now',
            onclick: function () {
              var ok = saveStateNow(state, true)
              renderSettings()
              showToast(ok ? 'Theme saved' : 'Could not save the theme')
            },
          }),
          el('button', {
            class: 'fbts-btn', type: 'button', text: 'Forget the session cache',
            onclick: function () {
              try {
                localStorage.removeItem(LS_KEY)
              } catch (e) {}
              showToast('Session cache cleared')
            },
          }),
        ]),
      ]),
    )

    settingsPane.appendChild(
      settingsGroup('Delete', [
        el('div', { class: 'fbts-note', style: 'color:var(--fbts-danger);margin:0 0 8px', text: 'Deleting removes your theme, the saved settings and every style this page wrote into Freebuff - then the panel, the engine and the community file from the install folder, with Freebuff\u2019s own index.html put back. A page cannot delete files, so the background guard does that part, and Freebuff closes to finish.' }),
        el('div', { class: 'fbts-actions', style: 'border:none;background:none;padding:0' }, [
          el('button', { class: 'fbts-btn danger', type: 'button', text: 'Delete Theme Studio', onclick: showDeleteConfirm }),
        ]),
      ]),
    )

    /*
     * Two slots, like the A/B switch on a plugin. Each holds a whole theme, and
     * every edit goes to whichever slot is showing, so a variant can be built
     * without losing the version you started from.
     */
    var slots = { A: clone(state), B: clone(state) }
    var activeSlot = 'B'

    function useSlot(name) {
      if (name === activeSlot) return
      slots[activeSlot] = clone(state)
      activeSlot = name
      state = clone(slots[name])
      state.adjust = normalizeAdjust(state.adjust)
      applyState()
      saveState(state, true)
      rebuild()
      showToast('Editing slot ' + name)
    }

    /* ---- footer ---- */
    var slotBar = el('div', { class: 'fbts-seg' })
    ;['A', 'B'].forEach(function (name) {
      slotBar.appendChild(
        el('button', {
          type: 'button', text: name, 'data-slot': name,
          title: 'Slot ' + name + ' - two themes, one click apart',
          onclick: function () { useSlot(name) },
        }),
      )
    })
    var footer = el('div', { class: 'fbts-footer' }, [
      slotBar,
      el('button', {
        class: 'fbts-btn danger', text: 'Reset all',
        onclick: function () {
          resetAll()
          slots[activeSlot] = clone(state)
          rebuild()
          refreshKnobs()
          showToast('Reset to Freebuff defaults')
        },
      }),
      el('button', {
        class: 'fbts-btn', text: 'Check for updates',
        onclick: function () { checkForUpdates(true) },
      }),
      el('div', { class: 'grow' }),
      el('span', {
        class: 'fbts-note',
        style: 'margin:0',
        text: 'Unofficial community extension, not made by Freebuff.',
      }),
    ])

    panel.appendChild(head)
    panel.appendChild(tabsBar)
    panel.appendChild(body)
    panel.appendChild(footer)

    document.addEventListener(
      'keydown',
      function (e) {
        if (e.key === 'Tab' && panel.classList.contains('open')) {
          var focusable = Array.prototype.filter.call(
            panel.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]'),
            function (item) { return item.getClientRects().length > 0 },
          )
          if (focusable.length) {
            var first = focusable[0]
            var last = focusable[focusable.length - 1]
            var activeElement = shadow.activeElement
            if (e.shiftKey && (activeElement === first || !panel.contains(activeElement))) {
              e.preventDefault()
              last.focus()
            } else if (!e.shiftKey && (activeElement === last || !panel.contains(activeElement))) {
              e.preventDefault()
              first.focus()
            }
          }
        }
        if (e.ctrlKey && e.altKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
          e.preventDefault()
          togglePage()
        }
        if (e.key === 'Escape') {
          // Esc backs out of the popup first, then closes the page.
          if (modalWrap.classList.contains('show')) {
            e.preventDefault()
            closePopup()
          } else if (panel.classList.contains('open')) {
            e.preventDefault()
            togglePage(false)
          }
        }
      },
      true,
    )

    /* ---- opening a theme ---- */
    function importThemeFromText(text) {
      var parsed
      try {
        parsed = parseThemeText(text)
      } catch (e) {
        showToast('That is not a theme')
        return
      }
      state = parsed
      importArea.value = ''
      // A theme made by an older version can carry a picture far bigger than
      // the store will hold. Bring it down to size before anything is saved,
      // so opening an old theme cannot leave the app unable to remember it.
      shrinkThemeImages(state, function () {
        applyState()
        saveState(state, true)
        rebuild()
        showToast('Opened "' + (state.name || 'theme') + '"')
      })
    }

    function readThemeFile(file) {
      if (file.size > 12 * 1024 * 1024) {
        showToast('That theme file is over 12 MB')
        return
      }
      var reader = new FileReader()
      reader.onload = function () {
        importThemeFromText(String(reader.result == null ? '' : reader.result))
      }
      reader.onerror = function () { showToast('Could not read that file') }
      reader.readAsText(file)
    }

    /* Dropping a .fbtheme file on the page opens it. */
    panel.addEventListener('dragover', function (e) {
      if (!e.dataTransfer) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      importArea.classList.add('drop')
    })
    panel.addEventListener('dragleave', function (e) {
      if (e.target === panel || !panel.contains(e.relatedTarget)) importArea.classList.remove('drop')
    })
    panel.addEventListener('drop', function (e) {
      e.preventDefault()
      importArea.classList.remove('drop')
      var dt = e.dataTransfer
      if (!dt) return
      var file = dt.files && dt.files[0]
      if (file && file.size) {
        readThemeFile(file)
        return
      }
      var text = dt.getData('text/plain') || dt.getData('text')
      if (text) importThemeFromText(text)
      else showToast('Nothing to open')
    })

    /* ---- refresh helpers ---- */
    function refreshActive() {
      // preset cards
      Array.prototype.forEach.call(presetsGrid.children, function (card) {
        // While a Community theme is the one applied, no stock preset is:
        // the highlight belongs to the community card until you pick a preset.
        card.classList.toggle('active', !communityActiveId && card.dataset.preset === state.preset)
      })
      // options
      Array.prototype.forEach.call(schemeRow.querySelectorAll('[data-scheme]'), function (input) {
        var mode = input.dataset.scheme
        input.checked = mode === 'auto' ? !state.scheme : state.scheme === mode
      })
      // the A/B slots
      Array.prototype.forEach.call(slotBar.children, function (btn) {
        btn.classList.toggle('active', btn.dataset.slot === activeSlot)
      })
      // The generated boxes only; the import box belongs to whoever is typing.
      exportArea.value = JSON.stringify(themeDocument(state), null, 2)
      shareInput.value = shareCode(state)
      if (settingsRefresh) settingsRefresh()
      refreshVersionLabel()
    }

    function rebuild() {
      // Simplest correct approach for a full-state swap: reload the pane values.
      Object.keys(tabPanes).forEach(function (k) {
        var p = tabPanes[k]
        if (k === 'colors' || k === 'advanced' || k === 'layout') {
          // re-seed every row from state
          Array.prototype.forEach.call(p.querySelectorAll('[data-token]'), function (row) {
            var token = row.dataset.token
            var colorInput = row.querySelector('.fbts-swatchinput')
            if (colorInput) {
              var c = currentColorFor(token)
              colorInput.style.background = fillFor(token)
              var txt = row.querySelector('input[type=text]')
              if (txt) txt.value = c.hex
              var alpha = row.querySelector('input[type=range]')
              if (alpha) alpha.value = String(Math.round(c.a * 100))
            } else {
              var input = row.querySelector('input[type=text]')
              if (input) input.value = state.layout[token] || ''
            }
          })
        }
      })
      rawArea.value = state.raw || ''
      nameInput.value = state.name || ''
      refreshKnobs()
      refreshSpots()
      // The logo, background and community panes show state rather than edit
      // it directly, so an imported theme has to push them a redraw.
      if (pageRefresh) pageRefresh()
      if (communityRefresh) communityRefresh()
      refreshActive()
    }

    function download(text, filename) {
      var blob = new Blob([text], { type: 'application/json' })
      var url = URL.createObjectURL(blob)
      var a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      setTimeout(function () {
        URL.revokeObjectURL(url)
        a.remove()
      }, 1000)
    }

    function togglePage(force) {
      var open = typeof force === 'boolean' ? force : !panel.classList.contains('open')
      if (open) fitToWorkspace(panel)
      panel.classList.toggle('open', open)
      root.classList.toggle('fbts-page-open', open)
      if (railButton) {
        if (open) {
          // Only one destination should look active: take the highlight off the
          // app's own rail entries. React restores its own on the next
          // navigation, so this never fights the shell.
          var others = document.querySelectorAll('.shell-nav-button[aria-current]')
          for (var i = 0; i < others.length; i++) {
            if (others[i] !== railButton) others[i].removeAttribute('aria-current')
          }
          railButton.setAttribute('aria-current', 'page')
        } else {
          railButton.removeAttribute('aria-current')
        }
      }
      if (open) refreshActive()
    }

    ui = { toggle: togglePage, refresh: refreshActive, checkForUpdates: checkForUpdates }

    // The sidebar entry is the only entry point; watchRail() keeps re-attaching
    // it if React ever replaces the rail.
    installRailButton()

    // Keep the page glued to the workspace frame: on window resize and whenever
    // the shell decides to re-lay itself out (sidebar collapse, compact mode).
    pagePanel = panel
    fitToWorkspace(panel)
    window.addEventListener('resize', fitPage)
    try {
      var frameEl = document.querySelector('.workspace-frame') || document.querySelector('.settings-frame')
      new ResizeObserver(fitPage).observe(frameEl || document.documentElement)
    } catch (e) {}      selectTab('presets')
      refreshSpots()
      refreshKnobs()
      refreshActive()

      // The first apply can run before every app stylesheet has arrived. Once
      // the page has finished loading, re-read them so the token targets are
      // complete, then re-apply the same theme against the fuller map.
      watchAppThemeAttribute()
      window.addEventListener('load', function () {
        discoveredTargets = null
        applyState()
        enforceAppThemeAttribute()
      })

    if (queuedNotice) {
      showToast(queuedNotice)
      queuedNotice = ''
    }

    // One quiet check per session, well clear of the app's own startup work,
    // then a poll so a session left open still hears about a release. The
    // hourly guard inside checkForUpdates() decides whether the poll actually
    // asks anyone.
    setTimeout(function () {
      checkForUpdates(false)
    }, 2500)
    setInterval(function () {
      checkForUpdates(false)
    }, CHECK_POLL)

    // Small surface for power users and for the sandbox tests.
    window.__FREEBUFF_THEME_STUDIO_API__ = {
      version: VERSION,
      checkForUpdates: checkForUpdates,
      state: function () {
        return clone(state)
      },
      /** Pretend the update feed reported this version. */
      simulateUpdate: function (v) {
        remoteVersion = cleanVersion(v)
        if (remoteVersion) showUpdatePopup()
      },
      /** Same, but a skipped version: it only shows the corner button. */
      simulateChip: function (v) {
        remoteVersion = cleanVersion(v)
        showChip(remoteVersion)
      },
    }
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */

  function boot() {
    if (!document.body) return
    try {
      mount()
      closePageOnExternalNav()
      watchRail()
    } catch (err) {
      // Never let a UI failure take the host app down with it.
      console.error('[freebuff-theme-studio] failed to mount', err)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})();

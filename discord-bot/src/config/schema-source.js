/**
 * Source of config.schema.json (`npm run schema` writes the file; a test checks it is in sync).
 *
 * Conventions shared with the website panel (docs/bot-api.md):
 *  - every module is an object with `enabled` (toggle) – the panel shows one tab per module,
 *  - `x-ui`: channel | role | text | textarea | toggle | select | color | number | list,
 *  - `x-i18n`: translation key of the label (locales/<lang>.json → "panel.…"), `x-i18n-help`:
 *    optional help text key, `x-i18n-options`: { value: key } for select options,
 *  - channel/role ids are strings ("" = not set), lists of ids are arrays of strings,
 *  - `x-channel-types`: which channel types a channel picker offers,
 *  - empty template strings mean "use the bot's default text in the server language".
 */

const ID = '^(\\d{17,20})?$';
const ID_STRICT = '^\\d{17,20}$';
const LANGS = ['pl', 'en', 'de', 'es', 'fr', 'uk', 'ru', 'cs', 'pt-BR', 'tr'];

// ------------------------------------------------------------------ field helpers
// `key` overrides the derived label key (shared labels live under panel.common.*)

const opt = (o = {}) => {
  const extra = {};
  if (o.key) extra['x-i18n'] = `panel.${o.key}`;
  if (o.help) extra['x-i18n-help'] = typeof o.help === 'string' ? `panel.${o.help}` : true;
  return extra;
};

export const f = {
  toggle: (def = false, o) => ({ type: 'boolean', default: def, 'x-ui': 'toggle', ...opt(o) }),
  text: (def = '', o = {}) => ({ type: 'string', default: def, maxLength: o.max ?? 200, ...(o.pattern ? { pattern: o.pattern } : {}), 'x-ui': 'text', ...opt(o) }),
  textarea: (def = '', o = {}) => ({ type: 'string', default: def, maxLength: o.max ?? 2000, 'x-ui': 'textarea', ...opt(o) }),
  number: (def, min, max, o = {}) => ({ type: o.float ? 'number' : 'integer', default: def, minimum: min, maximum: max, 'x-ui': 'number', ...opt(o) }),
  color: (def = '#9d5cff', o) => ({ type: 'string', default: def, pattern: '^#[0-9a-fA-F]{6}$', 'x-ui': 'color', ...opt(o) }),
  channel: (types = ['text', 'announcement'], o) => ({ type: 'string', default: '', pattern: ID, 'x-ui': 'channel', 'x-channel-types': types, ...opt(o) }),
  role: (o) => ({ type: 'string', default: '', pattern: ID, 'x-ui': 'role', ...opt(o) }),
  roles: (o = {}) => ({ type: 'array', default: [], maxItems: o.maxItems ?? 25, items: { type: 'string', pattern: ID_STRICT, 'x-ui': 'role' }, 'x-ui': 'list', ...opt(o) }),
  channels: (types = ['text', 'announcement', 'forum', 'voice'], o = {}) => ({ type: 'array', default: [], maxItems: o.maxItems ?? 50, items: { type: 'string', pattern: ID_STRICT, 'x-ui': 'channel', 'x-channel-types': types }, 'x-ui': 'list', ...opt(o) }),
  strings: (def = [], o = {}) => ({ type: 'array', default: def, maxItems: o.maxItems ?? 200, items: { type: 'string', maxLength: o.itemMax ?? 100, 'x-ui': 'text' }, 'x-ui': 'list', ...opt(o) }),
  select: (values, def, o = {}) => ({ type: o.type || 'string', enum: values, default: def, 'x-ui': 'select', ...(o.options ? { 'x-options': o.options } : {}), ...opt(o) }),
  list: (itemProps, def = [], o = {}) => ({ type: 'array', default: def, maxItems: o.maxItems ?? 25, 'x-ui': 'list', items: { type: 'object', additionalProperties: false, properties: itemProps }, ...opt(o) }),
  group: (props, o) => ({ type: 'object', additionalProperties: false, properties: props, ...opt(o) }),
};

// option sets with shared translations: panel.options.<set>.<value>
const ACTIONS = ['delete', 'warn', 'timeout', 'kick', 'ban'];
const set = (name) => ({ options: name });

/** Standard announcement feed: channel + role ping + message template + toggle. */
const feed = (def = false, extra = {}) => f.group({
  enabled: f.toggle(def, { key: 'common.enabled' }),
  channel: f.channel(['text', 'announcement'], { key: 'common.channel' }),
  role: f.role({ key: 'common.pingRole' }),
  template: f.textarea('', { key: 'common.template', help: 'common.template_help', max: 1500 }),
  ...extra,
});

const rule = (props = {}, action = 'delete') => f.group({
  enabled: f.toggle(false, { key: 'common.enabled' }),
  action: f.select(ACTIONS, action, { key: 'automod.action', ...set('actions') }),
  ...props,
});

// ------------------------------------------------------------------ modules

const modules = {
  general: f.group({
    language: f.select(LANGS, 'pl', { ...set('languages') }),
    useMemberLocale: f.toggle(true, { help: true }),
    timezone: f.text('Europe/Warsaw', { max: 64, help: true }),
    color: f.color('#9d5cff'),
    staffRoles: f.roles({ help: true }),
    commandCooldownSeconds: f.number(3, 0, 60),
    disabledCommands: f.strings([], { maxItems: 100, itemMax: 32, help: true }),
  }),

  nore: f.group({
    enabled: f.toggle(true, { key: 'common.enabled' }),
    releases: feed(false, { prereleases: f.toggle(false), changelog: f.toggle(true) }),
    news: feed(false),
    events: feed(false, { reminders: f.toggle(true, { help: true }) }),
  }),

  social: f.group({
    enabled: f.toggle(false, { key: 'common.enabled' }),
    intervalMinutes: f.number(5, 2, 60),
    youtube: f.list({
      channelId: f.text('', { max: 64, pattern: '^(UC[\\w-]{22})?$', help: true }),
      name: f.text('', { max: 100, key: 'common.name' }),
      channel: f.channel(['text', 'announcement'], { key: 'common.channel' }),
      role: f.role({ key: 'common.pingRole' }),
      template: f.textarea('', { key: 'common.template', max: 1500 }),
    }),
    twitch: f.list({
      login: f.text('', { max: 32, pattern: '^([a-zA-Z0-9_]{3,25})?$' }),
      channel: f.channel(['text', 'announcement'], { key: 'common.channel' }),
      role: f.role({ key: 'common.pingRole' }),
      template: f.textarea('', { key: 'common.template', max: 1500 }),
      endMessage: f.toggle(true),
    }),
    bridges: f.list({
      platform: f.select(['tiktok', 'instagram', 'x'], 'tiktok', { ...set('platforms') }),
      username: f.text('', { max: 64, pattern: '^([\\w.]{1,64})?$' }),
      channel: f.channel(['text', 'announcement'], { key: 'common.channel' }),
      role: f.role({ key: 'common.pingRole' }),
      template: f.textarea('', { key: 'common.template', max: 1500 }),
    }, [], { help: true }),
    rss: f.list({
      url: f.text('', { max: 500, pattern: '^(https?://.+)?$' }),
      name: f.text('', { max: 100, key: 'common.name' }),
      channel: f.channel(['text', 'announcement'], { key: 'common.channel' }),
      role: f.role({ key: 'common.pingRole' }),
      template: f.textarea('', { key: 'common.template', max: 1500 }),
    }, [], { maxItems: 50 }),
    github: f.list({
      repo: f.text('', { max: 140, pattern: '^([\\w.-]+/[\\w.-]+)?$' }),
      kind: f.select(['releases', 'commits'], 'releases', { ...set('githubKinds') }),
      branch: f.text('', { max: 100 }),
      channel: f.channel(['text', 'announcement'], { key: 'common.channel' }),
      role: f.role({ key: 'common.pingRole' }),
      template: f.textarea('', { key: 'common.template', max: 1500 }),
    }),
  }),

  status: f.group({
    enabled: f.toggle(false, { key: 'common.enabled' }),
    services: feed(false, { downTemplate: f.textarea('', { max: 1500 }), upTemplate: f.textarea('', { max: 1500 }), failuresBeforeIncident: f.number(2, 1, 10) }),
    servers: f.list({
      address: f.text('', { max: 255, pattern: '^([A-Za-z0-9.\\-_:\\[\\]]{1,255})?$' }),
      name: f.text('', { max: 100, key: 'common.name' }),
      channel: f.channel(['text', 'announcement'], { key: 'common.channel' }),
      role: f.role({ key: 'common.pingRole' }),
      notify: f.toggle(true),
      live: f.toggle(false, { help: true }),
    }, [], { maxItems: 15 }),
    board: f.group({
      enabled: f.toggle(false, { key: 'common.enabled' }),
      channel: f.channel(['text', 'announcement'], { key: 'common.channel' }),
      services: f.toggle(true),
      servers: f.toggle(true),
    }),
  }),

  moderation: f.group({
    enabled: f.toggle(true, { key: 'common.enabled' }),
    logChannel: f.channel(['text'], { key: 'common.logChannel' }),
    modRoles: f.roles({ help: true }),
    dmOnAction: f.toggle(true),
    requireReason: f.toggle(false),
    appealUrl: f.text('', { max: 300, pattern: '^(https?://.+)?$' }),
    warnExpiryDays: f.number(30, 0, 3650, { help: true }),
    thresholds: f.list({
      warns: f.number(3, 1, 100),
      action: f.select(['timeout', 'kick', 'ban'], 'timeout', { key: 'automod.action', ...set('actions') }),
      durationMinutes: f.number(60, 0, 40320),
    }, [{ warns: 3, action: 'timeout', durationMinutes: 60 }, { warns: 5, action: 'kick', durationMinutes: 0 }, { warns: 7, action: 'ban', durationMinutes: 0 }], { maxItems: 10 }),
  }),

  automod: f.group({
    enabled: f.toggle(false, { key: 'common.enabled' }),
    logChannel: f.channel(['text'], { key: 'common.logChannel' }),
    exemptRoles: f.roles(),
    exemptChannels: f.channels(['text', 'announcement', 'forum', 'voice', 'category']),
    timeoutMinutes: f.number(10, 1, 40320),
    spam: rule({ maxMessages: f.number(6, 2, 50), perSeconds: f.number(5, 1, 60) }, 'timeout'),
    duplicates: rule({ max: f.number(3, 2, 20) }),
    mentions: rule({ max: f.number(5, 1, 50) }, 'timeout'),
    invites: rule({ allowed: f.strings([], { maxItems: 50, itemMax: 64, help: true }) }),
    links: rule({ allowList: f.strings(['noroclient.pl', 'youtube.com', 'youtu.be', 'twitch.tv', 'github.com', 'tenor.com', 'imgur.com', 'minecraft.net'], { maxItems: 200, itemMax: 100 }) }),
    badWords: rule({ words: f.strings([], { maxItems: 500, itemMax: 64, help: true }) }),
    caps: rule({ minLength: f.number(12, 4, 500), percent: f.number(70, 30, 100) }),
    newAccounts: f.group({
      enabled: f.toggle(false, { key: 'common.enabled' }),
      minAgeDays: f.number(3, 1, 365),
      action: f.select(['kick', 'timeout', 'role'], 'kick', { key: 'automod.action', ...set('actions') }),
      role: f.role({ help: true }),
    }),
    raid: f.group({
      enabled: f.toggle(true, { key: 'common.enabled' }),
      joins: f.number(10, 3, 100),
      perSeconds: f.number(10, 2, 300),
      action: f.select(['none', 'kick', 'timeout'], 'kick', { key: 'automod.action', ...set('actions') }),
      durationMinutes: f.number(10, 1, 1440, { help: true }),
      alertRole: f.role({ key: 'common.pingRole' }),
    }),
  }),

  welcome: f.group({
    enabled: f.toggle(false, { key: 'common.enabled' }),
    channel: f.channel(['text'], { key: 'common.channel' }),
    message: f.textarea('', { key: 'common.template', help: 'common.template_help' }),
    embed: f.toggle(true, { key: 'common.embed' }),
    color: f.color('#9d5cff', { key: 'common.color' }),
    image: f.toggle(true, { help: true }),
    dm: f.toggle(false),
    dmMessage: f.textarea(''),
  }),

  goodbye: f.group({
    enabled: f.toggle(false, { key: 'common.enabled' }),
    channel: f.channel(['text'], { key: 'common.channel' }),
    message: f.textarea('', { key: 'common.template', help: 'common.template_help' }),
    embed: f.toggle(true, { key: 'common.embed' }),
  }),

  autorole: f.group({
    enabled: f.toggle(false, { key: 'common.enabled' }),
    roles: f.roles(),
    botRoles: f.roles(),
    delaySeconds: f.number(0, 0, 3600),
  }),

  verification: f.group({
    enabled: f.toggle(false, { key: 'common.enabled' }),
    channel: f.channel(['text'], { key: 'common.channel' }),
    role: f.role(),
    unverifiedRole: f.role({ help: true }),
    captcha: f.toggle(true),
    message: f.textarea(''),
    kickAfterHours: f.number(0, 0, 720, { help: true }),
  }),

  tickets: f.group({
    enabled: f.toggle(false, { key: 'common.enabled' }),
    mode: f.select(['channel', 'thread'], 'channel', { ...set('ticketModes') }),
    category: f.channel(['category']),
    logChannel: f.channel(['text'], { key: 'common.logChannel' }),
    staffRoles: f.roles(),
    maxOpen: f.number(1, 1, 10),
    nameTemplate: f.text('ticket-{number}', { max: 60, help: true }),
    openMessage: f.textarea(''),
    pingStaff: f.toggle(true),
    autoCloseHours: f.number(48, 0, 720, { help: true }),
    warnBeforeCloseHours: f.number(12, 0, 168),
    ratings: f.toggle(true),
    dmTranscript: f.toggle(false),
    blacklist: f.strings([], { maxItems: 500, itemMax: 20, help: true }),
    blacklistRoles: f.roles(),
    panels: f.list({
      id: f.text('main', { max: 32, pattern: '^[a-z0-9_-]{1,32}$', key: 'common.id' }),
      channel: f.channel(['text'], { key: 'common.channel' }),
      title: f.text('', { max: 256 }),
      description: f.textarea('', { max: 2000 }),
      style: f.select(['buttons', 'select'], 'buttons', { ...set('menuStyles') }),
      categories: f.strings([], { maxItems: 25, itemMax: 32, help: true }),
      color: f.color('#9d5cff', { key: 'common.color' }),
    }, [{ id: 'main', channel: '', title: '', description: '', style: 'buttons', categories: [], color: '#9d5cff' }], { maxItems: 10 }),
    categories: f.list({
      id: f.text('support', { max: 32, pattern: '^[a-z0-9_-]{1,32}$', key: 'common.id' }),
      label: f.text('', { max: 80 }),
      emoji: f.text('', { max: 64 }),
      description: f.text('', { max: 100 }),
      staffRoles: f.roles(),
      parent: f.channel(['category']),
      priority: f.select(['low', 'normal', 'high', 'urgent'], 'normal', { ...set('priorities') }),
      questions: f.list({
        label: f.text('', { max: 45 }),
        placeholder: f.text('', { max: 100 }),
        style: f.select(['short', 'paragraph'], 'paragraph', { ...set('inputStyles') }),
        required: f.toggle(true),
      }, [], { maxItems: 5 }),
    }, [
      { id: 'support', label: '', emoji: '🛠️', description: '', staffRoles: [], parent: '', priority: 'normal', questions: [] },
      { id: 'bug', label: '', emoji: '🐞', description: '', staffRoles: [], parent: '', priority: 'high', questions: [] },
      { id: 'other', label: '', emoji: '💬', description: '', staffRoles: [], parent: '', priority: 'low', questions: [] },
    ], { maxItems: 25 }),
  }),

  suggestions: f.group({
    enabled: f.toggle(false, { key: 'common.enabled' }),
    channel: f.channel(['text', 'forum']),
    reviewChannel: f.channel(['text'], { help: true }),
    staffRoles: f.roles(),
    allowAnonymous: f.toggle(true),
    threads: f.toggle(true),
    cooldownMinutes: f.number(10, 0, 1440),
    dmOnStatus: f.toggle(true),
    requireReview: f.toggle(false, { help: true }),
    categories: f.list({
      id: f.text('', { max: 32, pattern: '^[a-z0-9_-]{0,32}$', key: 'common.id' }),
      label: f.text('', { max: 80 }),
      emoji: f.text('', { max: 64 }),
    }, [{ id: 'client', label: 'Nore Client', emoji: '🎮' }, { id: 'launcher', label: 'Nore Launcher', emoji: '🚀' }, { id: 'discord', label: 'Discord', emoji: '💬' }], { maxItems: 25 }),
  }),

  applications: f.group({
    enabled: f.toggle(false, { key: 'common.enabled' }),
    reviewChannel: f.channel(['text']),
    staffRoles: f.roles(),
    dmResult: f.toggle(true),
    forms: f.list({
      id: f.text('staff', { max: 32, pattern: '^[a-z0-9_-]{1,32}$', key: 'common.id' }),
      title: f.text('', { max: 45 }),
      description: f.textarea('', { max: 1000 }),
      role: f.role({ help: true }),
      resultChannel: f.channel(['text', 'announcement'], { help: true }),
      cooldownDays: f.number(14, 0, 365),
      questions: f.list({
        label: f.text('', { max: 45 }),
        placeholder: f.text('', { max: 100 }),
        style: f.select(['short', 'paragraph'], 'paragraph', { ...set('inputStyles') }),
        required: f.toggle(true),
      }, [], { maxItems: 5 }),
    }, [
      { id: 'staff', title: '', description: '', role: '', resultChannel: '', cooldownDays: 14, questions: [] },
      { id: 'partner', title: '', description: '', role: '', resultChannel: '', cooldownDays: 30, questions: [] },
    ], { maxItems: 10 }),
  }),

  minecraft: f.group({
    enabled: f.toggle(false, { key: 'common.enabled' }),
    address: f.text('', { max: 255, pattern: '^([A-Za-z0-9.\\-_:\\[\\]]{1,255})?$', help: true }),
    chatChannel: f.channel(['text'], { help: true }),
    linkedRole: f.role(),
    syncNicknames: f.toggle(false),
    nicknameTemplate: f.text('{name}', { max: 32 }),
    rankRoles: f.list({ rank: f.text('', { max: 32 }), role: f.role() }, [], { maxItems: 25, help: true }),
  }),

  roles: f.group({
    enabled: f.toggle(true, { key: 'common.enabled' }),
    menus: f.list({
      id: f.text('', { max: 32, pattern: '^[a-z0-9_-]{0,32}$', key: 'common.id' }),
      channel: f.channel(['text'], { key: 'common.channel' }),
      title: f.text('', { max: 256 }),
      description: f.textarea('', { max: 2000 }),
      mode: f.select(['buttons', 'select', 'reactions'], 'buttons', { ...set('menuStyles') }),
      multiple: f.toggle(true),
      roles: f.list({
        role: f.role(),
        label: f.text('', { max: 80 }),
        emoji: f.text('', { max: 64 }),
        description: f.text('', { max: 100 }),
      }, [], { maxItems: 25 }),
    }, [], { maxItems: 25 }),
  }),

  leveling: f.group({
    enabled: f.toggle(false, { key: 'common.enabled' }),
    xpMin: f.number(15, 0, 1000),
    xpMax: f.number(25, 0, 1000),
    cooldownSeconds: f.number(60, 0, 3600),
    multiplier: f.number(1, 0.1, 10, { float: true }),
    voiceXpPerMinute: f.number(0, 0, 100, { help: true }),
    announce: f.select(['off', 'current', 'channel', 'dm'], 'current', { ...set('announce') }),
    announceChannel: f.channel(['text'], { key: 'common.channel' }),
    message: f.textarea('', { key: 'common.template', help: 'common.template_help' }),
    ignoredChannels: f.channels(['text', 'announcement', 'forum', 'voice', 'category']),
    ignoredRoles: f.roles(),
    rewards: f.list({ level: f.number(5, 1, 1000), role: f.role() }, [], { maxItems: 50 }),
    stackRewards: f.toggle(true),
  }),

  giveaways: f.group({
    enabled: f.toggle(true, { key: 'common.enabled' }),
    managerRoles: f.roles(),
    pingRole: f.role({ key: 'common.pingRole' }),
  }),

  polls: f.group({ enabled: f.toggle(true, { key: 'common.enabled' }) }),

  reminders: f.group({
    enabled: f.toggle(true, { key: 'common.enabled' }),
    maxPerUser: f.number(25, 1, 100),
  }),

  starboard: f.group({
    enabled: f.toggle(false, { key: 'common.enabled' }),
    channel: f.channel(['text'], { key: 'common.channel' }),
    emoji: f.text('⭐', { max: 64 }),
    threshold: f.number(3, 1, 100),
    selfStar: f.toggle(false),
    nsfw: f.toggle(false),
    ignoredChannels: f.channels(['text', 'announcement', 'forum', 'voice', 'category']),
  }),

  customCommands: f.group({
    enabled: f.toggle(true, { key: 'common.enabled' }),
    prefix: f.text('!', { max: 5 }),
    commands: f.list({
      trigger: f.text('', { max: 100 }),
      response: f.textarea('', { max: 2000 }),
      match: f.select(['command', 'exact', 'prefix', 'contains', 'word'], 'command', { ...set('match') }),
      embed: f.toggle(false, { key: 'common.embed' }),
      reply: f.toggle(true),
      deleteTrigger: f.toggle(false),
    }, [], { maxItems: 100 }),
  }),

  scheduled: f.group({
    enabled: f.toggle(false, { key: 'common.enabled' }),
    messages: f.list({
      id: f.text('', { max: 32, pattern: '^[a-z0-9_-]{0,32}$', key: 'common.id' }),
      channel: f.channel(['text', 'announcement'], { key: 'common.channel' }),
      content: f.textarea('', { max: 2000 }),
      embed: f.toggle(false, { key: 'common.embed' }),
      mode: f.select(['interval', 'daily', 'weekly'], 'daily', { ...set('scheduleModes') }),
      everyMinutes: f.number(60, 10, 43200),
      time: f.text('12:00', { max: 5, pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
      weekday: f.select([1, 2, 3, 4, 5, 6, 0], 1, { type: 'integer', ...set('weekdays') }),
    }, [], { maxItems: 25 }),
  }),

  stats: f.group({
    enabled: f.toggle(false, { key: 'common.enabled' }),
    intervalMinutes: f.number(10, 10, 1440),
    channels: f.list({
      channel: f.channel(['voice', 'text', 'category'], { key: 'common.channel' }),
      template: f.text('👥 {members}', { max: 100, key: 'common.template', help: true }),
    }, [], { maxItems: 10 }),
  }),

  logging: f.group({
    enabled: f.toggle(false, { key: 'common.enabled' }),
    messages: f.channel(['text']),
    members: f.channel(['text']),
    server: f.channel(['text']),
    voice: f.channel(['text']),
    ignoredChannels: f.channels(['text', 'announcement', 'forum', 'voice', 'category']),
    ignoreBots: f.toggle(true),
  }),

  boosts: f.group({
    enabled: f.toggle(false, { key: 'common.enabled' }),
    channel: f.channel(['text'], { key: 'common.channel' }),
    message: f.textarea('', { key: 'common.template', help: 'common.template_help' }),
    role: f.role({ help: true }),
    perksChannel: f.channel(['text', 'voice', 'forum']),
    thankDm: f.toggle(false),
  }),

  community: f.group({
    autoPublish: f.channels(['announcement'], { help: true }),
    forumAutoTag: f.toggle(false, { help: true }),
  }),

  server: f.group({
    applyOnSync: f.toggle(false, { help: true }),
    name: f.text('', { max: 100, help: 'server.keep_help' }),
    description: f.textarea('', { max: 120 }),
    verificationLevel: f.select(['keep', 'none', 'low', 'medium', 'high', 'very_high'], 'keep', { ...set('verificationLevels') }),
    explicitContentFilter: f.select(['keep', 'disabled', 'members_without_roles', 'all_members'], 'keep', { ...set('contentFilters') }),
    defaultNotifications: f.select(['keep', 'all', 'mentions'], 'keep', { ...set('notifications') }),
    systemChannel: f.channel(['text']),
    afkChannel: f.channel(['voice']),
    afkTimeout: f.select([0, 60, 300, 900, 1800, 3600], 0, { type: 'integer', ...set('afkTimeouts') }),
  }),

  actions: f.group({
    queue: f.list({
      id: f.text('', { max: 64, pattern: '^[A-Za-z0-9_-]{0,64}$', key: 'common.id' }),
      type: f.select(['setup', 'setup_repair', 'backup_create', 'post_panels', 'discovery_check', 'apply_server'], 'post_panels', { ...set('actionTypes') }),
      template: f.select(['nore-client', 'mc-server', 'gaming', 'support'], 'nore-client', { ...set('templates') }),
      size: f.select(['small', 'medium', 'full'], 'full', { ...set('sizes') }),
      language: f.select(['', ...LANGS], '', { ...set('languages') }),
    }, [], { maxItems: 20, help: true }),
  }),

  utility: f.group({ enabled: f.toggle(true, { key: 'common.enabled' }) }),
};

// ------------------------------------------------------------------ x-i18n keys

/** Adds derived `x-i18n` keys: panel.<module>._label for groups/lists, panel.<path> for leaves. */
function annotate(node, path) {
  const isContainer = node.type === 'object' || (node.type === 'array' && node.items?.type === 'object');
  if (!node['x-i18n']) node['x-i18n'] = isContainer ? `panel.${path}._label` : `panel.${path}`;
  if (node['x-i18n-help'] === true) node['x-i18n-help'] = isContainer ? `panel.${path}._help` : `panel.${path}_help`;
  if (node['x-options']) {
    const setName = node['x-options'];
    node['x-i18n-options'] = Object.fromEntries(node.enum.map(v => [String(v), `panel.options.${setName}.${v === '' ? 'default' : v}`]));
    delete node['x-options'];
  }
  if (node.type === 'object') for (const [k, v] of Object.entries(node.properties)) annotate(v, `${path}.${k}`);
  if (node.type === 'array' && node.items?.type === 'object') for (const [k, v] of Object.entries(node.items.properties)) annotate(v, `${path}.${k}`);
  return node;
}

export function buildSchema() {
  const properties = {};
  for (const [name, mod] of Object.entries(modules)) {
    const m = structuredClone(mod);
    m['x-module'] = true;
    m['x-i18n'] = `panel.${name}._label`;
    m['x-i18n-help'] = `panel.${name}._help`;
    for (const [k, v] of Object.entries(m.properties)) annotate(v, `${name}.${k}`);
    properties[name] = m;
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://noroclient.pl/api/v2/bot/config.schema.json',
    title: 'Nore Bot guild configuration',
    description: 'Generated by discord-bot/scripts/build-schema.js from src/config/schema-source.js. Do not edit by hand.',
    $comment: 'x-ui: channel|role|text|textarea|toggle|select|color|number|list. x-i18n: label key in locales/<lang>.json, x-i18n-help: help key, x-i18n-options: option label keys, x-channel-types: channel picker filter, x-module: top-level module tab. Empty strings for ids mean "not set"; empty templates mean "default text in the server language".',
    'x-version': 1,
    'x-languages': LANGS,
    type: 'object',
    additionalProperties: false,
    properties,
  };
}

export const MODULE_NAMES = Object.keys(modules);
export { LANGS };

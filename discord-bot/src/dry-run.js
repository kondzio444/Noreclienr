/**
 * `node . --dry-run`: loads every module, builds every slash command (with localizations), checks
 * them against Discord's limits, validates the schema defaults, locale completeness and every
 * builder template in every language and size, prints the command list and exits.
 * Needs no token and no network.
 */
import { Bot } from './core/bot.js';
import { lintCommand, requiredKeys } from './core/commands.js';
import { validate } from './config/validate.js';
import { LANGUAGES, keysOf, translator, has } from './i18n/index.js';
import { loadTemplates, compileTemplate, SIZES } from './lib/templates.js';
import { validateLayout, planLayout } from './lib/layout.js';
import { CONTENT_KINDS } from './modules/builder/content.js';

export async function dryRun(env) {
  const bot = await new Bot({ env, dryRun: true }).init();
  const problems = [];
  const json = bot.commandJson();
  for (const c of json) problems.push(...lintCommand(c));
  if (json.length > 100) problems.push(`${json.length} global commands (limit 100)`);

  // translations used by command definitions must exist in English (base) and Polish (default)
  for (const def of bot.commands.values()) for (const k of requiredKeys(def)) for (const l of ['en', 'pl']) if (!has(l, k, { exact: true })) problems.push(`missing ${l} ${k}`);

  // schema defaults must validate against the schema
  const errs = validate(bot.config.defaults, bot.config.schema);
  for (const e of errs) problems.push(`default config ${e.pointer}: ${e.message}`);

  // locale completeness vs English
  const en = new Set(keysOf('en'));
  const coverage = {};
  for (const l of LANGUAGES) {
    const keys = new Set(keysOf(l));
    const missing = [...en].filter(k => !keys.has(k));
    coverage[l] = `${(((en.size - missing.length) / en.size) * 100).toFixed(1)}%`;
    if (missing.length) problems.push(`locale ${l}: ${missing.length} keys missing (e.g. ${missing.slice(0, 3).join(', ')})`);
  }

  // builder templates
  const templates = loadTemplates();
  const sizes = {};
  for (const [id, tpl] of Object.entries(templates)) {
    for (const lang of LANGUAGES) {
      for (const size of SIZES) {
        const c = compileTemplate(tpl, { t: translator(lang), size, vars: { server: 'Test', website: 'https://noroclient.pl', address: 'MC.noreclient.pl' } });
        for (const p of validateLayout(c.layout)) problems.push(`template ${id}/${lang}/${size}: ${p}`);
        for (const x of [...c.layout.roles, ...c.layout.channels]) if (/tpl\.[a-z]/.test(x.name) || /tpl\.[a-z]/.test(x.topic || '')) problems.push(`template ${id}/${lang}: untranslated ${x.key} "${x.name}"`);
        for (const x of c.layout.channels) if (x.topicKey && !has(lang, x.topicKey, { exact: true })) problems.push(`template ${id}/${lang}: no topic ${x.topicKey}`);
        for (const k of c.content) if (!CONTENT_KINDS.includes(k.kind)) problems.push(`template ${id}: unknown content ${k.kind}`);
        for (const k of c.content) if (!has(lang, `tpl.content.${k.kind}.title`, { exact: true })) problems.push(`template ${id}/${lang}: no content tpl.content.${k.kind}`);
        for (const m of Object.keys(c.menus)) if (!has(lang, `tpl.menu.${m}.title`, { exact: true })) problems.push(`template ${id}/${lang}: no menu ${m}`);
        if (lang === 'pl') {
          // apply against an empty fake guild: what the builder would create
          const plan = planLayout(c.layout, { roles: [], channels: [] });
          sizes[`${id}/${size}`] = `${c.layout.roles.length} roles, ${c.layout.channels.filter(x => x.type === 'category').length} categories, ${c.layout.channels.filter(x => x.type !== 'category').length} channels → ${plan.ops.length} layout steps, ${c.content.length} posts, ${c.panels.length} panels, ${c.binds.length} config bindings`;
          // and again against the result: a rerun must create nothing (idempotency)
          const fake = { roles: c.layout.roles.map((r, i) => ({ id: `r${i}`, name: r.name, color: 0, permissions: [] })), channels: c.layout.channels.map((x, i) => ({ id: `c${i}`, name: x.name, type: x.type, parentId: x.parent ? `c${c.layout.channels.findIndex(y => y.key === x.parent)}` : null })) };
          const again = planLayout(c.layout, fake);
          if (again.summary.create.roles || again.summary.create.channels) problems.push(`template ${id}/${size}: rerun would create ${again.summary.create.roles} roles / ${again.summary.create.channels} channels`);
        }
      }
    }
  }

  console.log(`Nore Bot dry run – ${bot.modules.length} modules, ${json.length} slash commands, ${bot.commandPaths().length} runnable paths\n`);
  for (const p of bot.commandPaths()) console.log(`  /${p.path}${p.def.module ? `  [${p.def.module}]` : ''}`);
  console.log('\nLocales:', Object.entries(coverage).map(([l, c]) => `${l} ${c}`).join(', '));
  console.log('\nTemplates:');
  for (const [k, v] of Object.entries(sizes)) console.log(`  ${k.padEnd(22)} ${v}`);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems.slice(0, 200)) console.log(`  ✗ ${p}`);
    return 1;
  }
  console.log('\n✓ all checks passed');
  return 0;
}

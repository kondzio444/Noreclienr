/**
 * Custom commands and auto-responses (config.customCommands): "!rules" style commands with the
 * configured prefix, or exact / prefix / contains / whole-word triggers. Managed by /cc.
 */
import { opt } from '../core/commands.js';
import { EPHEMERAL } from '../core/ui.js';
import { render, memberVars, clip } from '../lib/template.js';
import { normalizeText } from '../lib/automod.js';

const cooldown = new Map();

/** Does `content` trigger the command? (pure, unit-tested) */
export function matches(cmd, content, prefix) {
  const text = content.trim();
  const trig = cmd.trigger.trim();
  if (!trig) return false;
  const lc = text.toLowerCase(), lt = trig.toLowerCase();
  switch (cmd.match) {
    case 'command': { const full = (prefix + lt).toLowerCase(); return lc === full || lc.startsWith(full + ' '); }
    case 'exact': return lc === lt;
    case 'prefix': return lc.startsWith(lt);
    case 'contains': return lc.includes(lt);
    case 'word': return normalizeText(text).split(/[^\p{L}\p{N}]+/u).includes(normalizeText(trig));
    default: return false;
  }
}

export default {
  name: 'customCommands',
  events: {
    async messageCreate(bot, message) {
      if (!message.guild || message.author.bot || !message.content) return;
      const cfg = bot.cfg(message.guild.id).customCommands;
      if (!cfg.enabled || !cfg.commands.length) return;
      const cmd = cfg.commands.find(c => matches(c, message.content, cfg.prefix));
      if (!cmd) return;
      const key = `${message.channelId}:${cmd.trigger}`;
      if ((cooldown.get(key) || 0) > Date.now()) return;
      cooldown.set(key, Date.now() + 5000);
      const text = render(cmd.response, { ...memberVars(message.member || message.author), channel: `<#${message.channelId}>` });
      const payload = cmd.embed ? { embeds: [bot.embed(message.guild.id).setDescription(clip(text, 4000))] } : { content: clip(text, 2000) };
      payload.allowedMentions = { users: [message.author.id] };
      if (cmd.reply) await message.reply(payload).catch(() => {}); else await message.channel.send(payload).catch(() => {});
      if (cmd.deleteTrigger) await message.delete().catch(() => {});
      if (cooldown.size > 2000) for (const [k, v] of cooldown) if (v < Date.now()) cooldown.delete(k);
    },
  },
  commands: [{
    name: 'cc', category: 'automation', module: null, perms: ['ManageGuild'],
    subs: {
      add: {
        options: [opt.string('trigger', true, { max: 100 }), opt.string('response', true, { max: 2000 }), opt.string('match', false, { choices: { values: ['command', 'exact', 'prefix', 'contains', 'word'], key: (v) => `panel.options.match.${v}` } }), opt.bool('embed'), opt.bool('delete_trigger')],
        async run(ctx) {
          const list = structuredClone(ctx.cfg.customCommands.commands).filter(c => c.trigger.toLowerCase() !== ctx.str('trigger').toLowerCase());
          list.push({ trigger: ctx.str('trigger'), response: ctx.str('response').replace(/\\n/g, '\n'), match: ctx.str('match') || 'command', embed: !!ctx.bool('embed'), reply: true, deleteTrigger: !!ctx.bool('delete_trigger') });
          const res = ctx.bot.config.set(ctx.guild.id, 'customCommands.commands', list, { by: ctx.user.id });
          return res.ok ? ctx.ok('cc.added', { trigger: ctx.str('trigger') }) : ctx.fail('cc.limit');
        },
      },
      remove: {
        options: [opt.string('trigger', true, { autocomplete: true })],
        autocomplete: (ctx) => ctx.cfg.customCommands.commands.map(c => ({ name: c.trigger, value: c.trigger })),
        async run(ctx) {
          const list = ctx.cfg.customCommands.commands.filter(c => c.trigger !== ctx.str('trigger'));
          ctx.bot.config.set(ctx.guild.id, 'customCommands.commands', list, { by: ctx.user.id });
          return ctx.ok('cc.removed', { trigger: ctx.str('trigger') });
        },
      },
      list: {
        async run(ctx) {
          const c = ctx.cfg.customCommands;
          const lines = c.commands.map(x => `\`${x.match === 'command' ? c.prefix : ''}${x.trigger}\` · ${ctx.t(`panel.options.match.${x.match}`)} → ${clip(x.response.replace(/\n/g, ' '), 60)}`);
          return ctx.reply({ embeds: [ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('cc.list_title')).setDescription(lines.join('\n') || ctx.t('cc.none'))], flags: EPHEMERAL });
        },
      },
    },
  }],
};

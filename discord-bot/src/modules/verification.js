/**
 * Verification gate: a panel with a button; optional captcha (arithmetic question in a modal);
 * grants the verified role, removes the "unverified" role, gives autoroles, can kick members who do
 * not verify in time.
 */
import { ModalBuilder, TextInputBuilder, TextInputStyle, ButtonStyle } from 'discord.js';
import { randomInt } from 'node:crypto';
import { opt } from '../core/commands.js';
import { EPHEMERAL, row, button, okEmbed, errEmbed } from '../core/ui.js';
import { render, memberVars } from '../lib/template.js';

const pending = new Map(); // `${guild}:${user}` -> { answer, at }

export function makeCaptcha(rnd = randomInt) {
  const ops = ['+', '-', '×'];
  const op = ops[rnd(0, 3)];
  let a = rnd(2, 13), b = rnd(2, 13);
  if (op === '-' && b > a) [a, b] = [b, a];
  const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;
  return { question: `${a} ${op} ${b}`, answer };
}

export function panelPayload(bot, guildId) {
  const cfg = bot.cfg(guildId).verification;
  const tg = bot.tg(guildId);
  const e = bot.embed(guildId).setTitle(tg('verify.panel_title')).setDescription(cfg.message || tg('verify.panel_text'));
  return { embeds: [e], components: [row(button('verify:start', tg('verify.button'), ButtonStyle.Success, '✅'))] };
}

async function complete(ctx) {
  const cfg = ctx.cfg;
  const v = cfg.verification;
  const member = ctx.member;
  const add = [v.role, ...(cfg.autorole.enabled ? cfg.autorole.roles : [])].filter(Boolean)
    .filter(r => { const role = ctx.guild.roles.cache.get(r); return role && role.position < ctx.guild.members.me.roles.highest.position; });
  try {
    if (add.length) await member.roles.add(add, 'Nore Bot verification');
    if (v.unverifiedRole && member.roles.cache.has(v.unverifiedRole)) await member.roles.remove(v.unverifiedRole, 'Nore Bot verification');
  } catch {
    return ctx.reply({ embeds: [errEmbed(ctx.t('verify.role_error'))], flags: EPHEMERAL });
  }
  ctx.bot.scheduler.cancel(ctx.guild.id, t => t.type === 'verify_kick' && t.data.userId === member.id);
  ctx.bot.audit(ctx.guild.id, 'member_verified', { userId: member.id });
  return ctx.reply({ embeds: [okEmbed(ctx.t('verify.done', { server: ctx.guild.name }))], flags: EPHEMERAL });
}

export default {
  name: 'verification',
  events: {
    async guildMemberAdd(bot, member) {
      const v = bot.cfg(member.guild.id).verification;
      if (v.enabled && v.kickAfterHours > 0 && !member.user.bot) bot.scheduler.add(member.guild.id, 'verify_kick', Date.now() + v.kickAfterHours * 3_600_000, { userId: member.id });
    },
  },
  timers: {
    async verify_kick(bot, guildId, { userId }) {
      const guild = bot.client.guilds.cache.get(guildId);
      const v = guild && bot.cfg(guildId).verification;
      if (!v?.enabled) return;
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member || (v.role && member.roles.cache.has(v.role))) return;
      if (v.unverifiedRole && !member.roles.cache.has(v.unverifiedRole)) return;
      const tg = bot.tg(guildId);
      await member.send(tg('verify.kicked_dm', { server: guild.name })).catch(() => {});
      await member.kick(tg('verify.kick_reason')).catch(() => {});
    },
  },
  commands: [{
    name: 'verify', category: 'admin', perms: ['ManageGuild'],
    subs: {
      panel: {
        options: [opt.channel('channel', false, { channelTypes: ['text'] })],
        async run(ctx) {
          const ch = ctx.channelOpt('channel') || ctx.i.channel;
          if (!ctx.cfg.verification.role) return ctx.fail('verify.no_role');
          const msg = await ctx.bot.send(ctx.guild, ch.id, panelPayload(ctx.bot, ctx.guild.id));
          if (!msg) return ctx.fail('errors.cannot_send', { channel: `${ch}` });
          return ctx.ok('verify.panel_sent', { url: msg.url });
        },
      },
    },
  }],
  components: {
    async verify(ctx, [action]) {
      const v = ctx.cfg.verification;
      if (!v.role) return ctx.fail('verify.no_role');
      if (action === 'start') {
        if (ctx.member.roles.cache.has(v.role)) return ctx.info('verify.already');
        if (!v.captcha) return complete(ctx);
        const c = makeCaptcha();
        pending.set(`${ctx.guild.id}:${ctx.user.id}`, { answer: c.answer, at: Date.now() });
        const modal = new ModalBuilder().setCustomId('verify:answer').setTitle(ctx.t('verify.captcha_title'))
          .addComponents(row(new TextInputBuilder().setCustomId('answer').setLabel(ctx.t('verify.captcha_question', { question: c.question }).slice(0, 45)).setStyle(TextInputStyle.Short).setMaxLength(6).setRequired(true)));
        return ctx.i.showModal(modal);
      }
      if (action === 'answer' && ctx.i.isModalSubmit()) {
        const key = `${ctx.guild.id}:${ctx.user.id}`;
        const p = pending.get(key);
        pending.delete(key);
        if (!p || Date.now() - p.at > 5 * 60_000) return ctx.fail('verify.expired');
        if (parseInt(ctx.i.fields.getTextInputValue('answer').trim(), 10) !== p.answer) return ctx.fail('verify.wrong');
        return complete(ctx);
      }
    },
  },
};

export { render, memberVars };

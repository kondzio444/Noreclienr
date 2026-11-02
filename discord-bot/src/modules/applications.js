/**
 * Applications: staff applications, partnerships ("współprace") and any other form.
 * Form (modal) → staff review channel with Accept / Reject → DM with the result, role on accept,
 * and – for partnerships – the partner ad posted in the result channel.
 */
import { ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { opt } from '../core/commands.js';
import { EPHEMERAL, row, button, okEmbed, COLORS, embed } from '../core/ui.js';
import { clip } from '../lib/template.js';
import { ts } from '../lib/duration.js';
import { has } from '../i18n/index.js';

const state = (bot, gid) => bot.store.ns(gid, 'applications', () => ({ next: 1, items: {}, last: {} }));

export function formQuestions(tg, lang, form) {
  if (form.questions?.length) return form.questions.filter(q => q.label).slice(0, 5);
  const set = has(lang, `apps.q.${form.id}.1`) ? form.id : 'generic';
  const out = [];
  for (let i = 1; i <= 5; i++) {
    if (!has(lang, `apps.q.${set}.${i}`)) break;
    out.push({ label: tg(`apps.q.${set}.${i}`), placeholder: has(lang, `apps.p.${set}.${i}`) ? tg(`apps.p.${set}.${i}`) : '', style: i === 1 ? 'short' : 'paragraph', required: true });
  }
  return out;
}

export const formTitle = (tg, f) => f.title || (has('en', `apps.title.${f.id}`) ? tg(`apps.title.${f.id}`) : f.id);

export function panelPayload(bot, guildId, form) {
  const tg = bot.tg(guildId);
  const e = bot.embed(guildId).setTitle(formTitle(tg, form)).setDescription(form.description || (has('en', `apps.desc.${form.id}`) ? tg(`apps.desc.${form.id}`) : tg('apps.desc.generic')));
  return { embeds: [e], components: [row(button(`app:start:${form.id}`, tg('apps.apply_button'), ButtonStyle.Primary, '📝'))] };
}

async function start(ctx, formId) {
  const cfg = ctx.cfg.applications;
  if (!cfg.enabled || !cfg.reviewChannel) return ctx.fail('apps.not_configured');
  const form = cfg.forms.find(f => f.id === formId);
  if (!form) return ctx.fail('apps.no_form');
  const st = state(ctx.bot, ctx.guild.id);
  const last = st.last[`${form.id}:${ctx.user.id}`] || 0;
  if (form.cooldownDays && Date.now() - last < form.cooldownDays * 86_400_000) return ctx.fail('apps.cooldown', { when: ts(last + form.cooldownDays * 86_400_000) });
  if (Object.values(st.items).some(a => a.form === form.id && a.userId === ctx.user.id && a.status === 'pending')) return ctx.fail('apps.pending');
  const qs = formQuestions(ctx.tg, ctx.cfg.general.language, form);
  const modal = new ModalBuilder().setCustomId(`app:submit:${form.id}`).setTitle(clip(formTitle(ctx.t, form), 45));
  qs.forEach((q, i) => {
    const input = new TextInputBuilder().setCustomId(`q${i}`).setLabel(clip(q.label, 45)).setStyle(q.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph).setRequired(!!q.required).setMaxLength(q.style === 'short' ? 200 : 1500);
    if (q.placeholder) input.setPlaceholder(clip(q.placeholder, 100));
    modal.addComponents(row(input));
  });
  return ctx.i.showModal(modal);
}

function appEmbed(tg, a) {
  const color = a.status === 'accepted' ? COLORS.ok : a.status === 'rejected' ? COLORS.error : COLORS.info;
  return embed(color).setTitle(`📝 #${a.id} · ${a.title}`).setAuthor({ name: `${a.userName} (${a.userId})`, iconURL: a.avatar || undefined })
    .addFields(...a.answers.map(x => ({ name: clip(x.q, 256), value: clip(x.a || '—', 1024) })),
      { name: tg('apps.status'), value: `${tg(`apps.st.${a.status}`)}${a.reviewer ? ` · <@${a.reviewer}>` : ''}${a.reason ? `\n${clip(a.reason, 500)}` : ''}` })
    .setTimestamp(a.createdAt);
}

async function decide(ctx, a, accepted, reason) {
  const bot = ctx.bot;
  const cfg = ctx.cfg.applications;
  const form = cfg.forms.find(f => f.id === a.form) || { id: a.form };
  a.status = accepted ? 'accepted' : 'rejected';
  a.reviewer = ctx.user.id;
  a.reason = reason || null;
  a.decidedAt = Date.now();
  bot.store.touch(ctx.guild.id);
  const tg = ctx.tg;
  const member = await ctx.guild.members.fetch(a.userId).catch(() => null);
  if (accepted && form.role && member) await member.roles.add(form.role, `application #${a.id}`).catch(() => {});
  if (accepted && form.resultChannel) {
    const e = bot.embed(ctx.guild.id).setTitle(form.id === 'partner' ? `🤝 ${clip(a.answers[0]?.a || a.userName, 240)}` : `🎉 ${formTitle(tg, form)}`)
      .setDescription(form.id === 'partner' ? clip(a.answers.slice(1).map(x => x.a).filter(Boolean).join('\n\n'), 4000) : tg('apps.accepted_public', { user: `<@${a.userId}>`, form: formTitle(tg, form) }))
      .setThumbnail(a.avatar || null).setFooter({ text: tg('apps.partner_footer') });
    await bot.send(ctx.guild, form.resultChannel, { embeds: [e], allowedMentions: { parse: [] } });
  }
  if (cfg.dmResult) {
    const user = member?.user || await bot.client.users.fetch(a.userId).catch(() => null);
    await user?.send({ embeds: [embed(accepted ? COLORS.ok : COLORS.error).setTitle(tg(accepted ? 'apps.dm_accepted' : 'apps.dm_rejected', { form: formTitle(tg, form), server: ctx.guild.name })).setDescription(reason ? clip(reason, 2000) : null)] }).catch(() => {});
  }
  bot.audit(ctx.guild.id, 'application_decision', { id: a.id, form: a.form, accepted, by: ctx.user.id });
}

const formAuto = (ctx) => ctx.cfg.applications.forms.map(f => ({ name: formTitle(ctx.t, f), value: f.id }));

export default {
  name: 'applications',
  commands: [
    {
      name: 'apply', category: 'community',
      options: [opt.string('form', true, { autocomplete: true })],
      autocomplete: formAuto,
      run: (ctx) => start(ctx, ctx.str('form')),
    },
    {
      name: 'applications', category: 'community', perms: ['ManageGuild'],
      allowRoles: (cfg) => cfg.applications.staffRoles,
      subs: {
        panel: {
          options: [opt.string('form', true, { autocomplete: true }), opt.channel('channel', false, { channelTypes: ['text'] })],
          autocomplete: formAuto,
          async run(ctx) {
            const form = ctx.cfg.applications.forms.find(f => f.id === ctx.str('form'));
            if (!form) return ctx.fail('apps.no_form');
            const ch = ctx.channelOpt('channel') || ctx.i.channel;
            const msg = await ctx.bot.send(ctx.guild, ch.id, panelPayload(ctx.bot, ctx.guild.id, form));
            return msg ? ctx.ok('apps.panel_sent', { url: msg.url }) : ctx.fail('errors.cannot_send', { channel: `${ch}` });
          },
        },
        list: {
          options: [opt.string('status', false, { choices: { values: ['pending', 'accepted', 'rejected'], key: (v) => `apps.st.${v}` } })],
          async run(ctx) {
            const status = ctx.str('status') || 'pending';
            const list = Object.values(state(ctx.bot, ctx.guild.id).items).filter(a => a.status === status).slice(-25).reverse();
            const lines = list.map(a => `**#${a.id}** ${a.title} · <@${a.userId}> · ${ts(a.createdAt)}`);
            return ctx.reply({ embeds: [ctx.bot.embed(ctx.guild.id).setTitle(ctx.t('apps.list_title', { status: ctx.t(`apps.st.${status}`) })).setDescription(lines.join('\n') || ctx.t('apps.none'))], flags: EPHEMERAL });
          },
        },
      },
    },
  ],
  components: {
    async app(ctx, [action, arg]) {
      const bot = ctx.bot;
      if (action === 'start') return start(ctx, arg);
      if (action === 'submit' && ctx.i.isModalSubmit()) {
        const cfg = ctx.cfg.applications;
        const form = cfg.forms.find(f => f.id === arg);
        if (!form) return ctx.fail('apps.no_form');
        const qs = formQuestions(ctx.tg, ctx.cfg.general.language, form);
        const st = state(bot, ctx.guild.id);
        const a = { id: st.next++, form: form.id, title: formTitle(ctx.tg, form), userId: ctx.user.id, userName: ctx.user.username, avatar: ctx.user.displayAvatarURL({ size: 64 }), answers: qs.map((q, i) => ({ q: q.label, a: ctx.i.fields.fields.has(`q${i}`) ? ctx.i.fields.getTextInputValue(`q${i}`) : '' })), status: 'pending', createdAt: Date.now() };
        st.items[a.id] = a;
        st.last[`${form.id}:${ctx.user.id}`] = Date.now();
        bot.store.touch(ctx.guild.id);
        const staffPing = cfg.staffRoles.map(r => `<@&${r}>`).join(' ');
        const msg = await bot.send(ctx.guild, cfg.reviewChannel, {
          content: staffPing || undefined, embeds: [appEmbed(ctx.tg, a)],
          components: [row(button(`app:accept:${a.id}`, ctx.tg('apps.accept'), ButtonStyle.Success, '✅'), button(`app:reject:${a.id}`, ctx.tg('apps.reject'), ButtonStyle.Danger, '❌'))],
          allowedMentions: { roles: cfg.staffRoles },
        });
        if (msg) { a.reviewMessage = msg.id; bot.store.touch(ctx.guild.id); }
        bot.audit(ctx.guild.id, 'application_new', { id: a.id, form: form.id, userId: ctx.user.id });
        return ctx.reply({ embeds: [okEmbed(ctx.t('apps.sent', { form: a.title }))], flags: EPHEMERAL });
      }
      const a = state(bot, ctx.guild.id).items[Number(arg)];
      if (!a) return ctx.fail('apps.not_found');
      const cfg = ctx.cfg.applications;
      if (!ctx.isStaff(cfg.staffRoles)) return ctx.fail('apps.staff_only');
      if (a.status !== 'pending') return ctx.fail('apps.already_decided');
      if (action === 'accept') {
        await ctx.i.deferUpdate();
        await decide(ctx, a, true, null);
        return ctx.i.editReply({ embeds: [appEmbed(ctx.tg, a)], components: [] });
      }
      if (action === 'reject') {
        return ctx.i.showModal(new ModalBuilder().setCustomId(`app:rejectform:${a.id}`).setTitle(ctx.t('apps.reject'))
          .addComponents(row(new TextInputBuilder().setCustomId('reason').setLabel(ctx.t('apps.reason')).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000))));
      }
      if (action === 'rejectform' && ctx.i.isModalSubmit()) {
        await ctx.i.deferUpdate();
        await decide(ctx, a, false, ctx.i.fields.getTextInputValue('reason'));
        return ctx.i.editReply({ embeds: [appEmbed(ctx.tg, a)], components: [] });
      }
    },
  },
};

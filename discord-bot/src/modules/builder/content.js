/**
 * Starter content the builder posts into a new server: rules, start-here guide, FAQ, server info,
 * role descriptions, links, partnership / staff / creator / beta programmes, how to join the
 * Minecraft server, ranks, voting, changelog and announcement starters, booster perks.
 * All texts come from locales (tpl.content.<kind>.*). `vars`: { server, address, website, ... }.
 */
import { has } from '../../i18n/index.js';
import { embed, row, linkButton } from '../../core/ui.js';
import { colorInt } from '../../lib/template.js';

/** Numbered items <prefix>.1 … <prefix>.N that exist in the language. */
function numbered(t, lang, prefix, max = 20) {
  const out = [];
  for (let i = 1; i <= max; i++) {
    if (!has(lang, `${prefix}.${i}`)) break;
    out.push(t(`${prefix}.${i}`));
  }
  return out;
}

const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '1️⃣1️⃣', '1️⃣2️⃣'];

export function contentPayloads(kind, { t, lang, vars, accent, mention, roleMention, roles = [] }) {
  const c = colorInt(accent);
  const T = (k, v) => t(`tpl.content.${kind}.${k}`, { ...vars, ...v });
  const links = () => row(
    linkButton(vars.website, t('tpl.content.links.website'), '🌐'),
    linkButton(`${vars.website}/#download`, t('tpl.content.links.download'), '⬇️'),
    linkButton(`${vars.website}/api`, 'API', '🧩'),
    linkButton('https://github.com/kondzio444/Noreclienr', 'GitHub', '🐙'),
  );
  switch (kind) {
    case 'rules': {
      const sections = numbered(t, lang, 'tpl.content.rules.s');
      const head = embed(c).setTitle(T('title')).setDescription(T('intro'));
      const body = embed(c).setDescription(sections.map((s, i) => `${NUM[i] || `**${i + 1}.**`} ${s}`).join('\n\n'));
      const foot = embed(c).setDescription(T('footer'));
      return [{ embeds: [head, body, foot], pin: true }];
    }
    case 'start': {
      const steps = numbered(t, lang, 'tpl.content.start.step');
      const e = embed(c).setTitle(T('title')).setDescription(`${T('intro')}\n\n${steps.map((s, i) => `**${i + 1}.** ${s}`).join('\n')}`)
        .addFields(
          { name: T('channels'), value: [mention('rules') && `📜 ${mention('rules')}`, mention('verify') && `✅ ${mention('verify')}`, mention('roles') && `🎭 ${mention('roles')}`, mention('faq') && `❓ ${mention('faq')}`, mention('support_info') && `🎫 ${mention('support_info')}`, mention('general') && `💬 ${mention('general')}`].filter(Boolean).join('\n') || '—' },
        );
      return [{ embeds: [e], components: [links()], pin: true }];
    }
    case 'faq': {
      const qs = numbered(t, lang, 'tpl.content.faq.q');
      const as = numbered(t, lang, 'tpl.content.faq.a');
      const e = embed(c).setTitle(T('title')).setDescription(qs.map((q, i) => `**❓ ${q}**\n${as[i] || ''}`).join('\n\n').slice(0, 4096));
      return [{ embeds: [e], pin: true }];
    }
    case 'info': {
      const e = embed(c).setTitle(T('title')).setDescription(T('text'))
        .addFields({ name: T('website'), value: vars.website, inline: true }, ...(vars.address ? [{ name: T('address'), value: `\`${vars.address}\``, inline: true }] : []));
      return [{ embeds: [e], components: [links()], pin: true }];
    }
    case 'links': {
      const e = embed(c).setTitle(T('title')).setDescription(T('text'));
      return [{ embeds: [e], components: [links()], pin: true }];
    }
    case 'roles': {
      const lines = roles.filter(r => r.desc).map(r => `${roleMention(r.key)} – ${r.desc}`);
      const chunks = [];
      let cur = '';
      for (const l of lines) { if ((cur + l).length > 3800) { chunks.push(cur); cur = ''; } cur += l + '\n'; }
      if (cur) chunks.push(cur);
      return [{ embeds: [embed(c).setTitle(T('title')).setDescription(T('intro')), ...chunks.slice(0, 8).map(d => embed(c).setDescription(d))], pin: true }];
    }
    case 'howtojoin': {
      const steps = numbered(t, lang, 'tpl.content.howtojoin.step');
      return [{ embeds: [embed(c).setTitle(T('title')).setDescription(`${T('intro')}\n\n${steps.map((s, i) => `**${i + 1}.** ${s}`).join('\n')}`).addFields({ name: T('address'), value: `\`\`\`\n${vars.address}\n\`\`\`` }, { name: T('versions'), value: T('versions_text') })], components: [links()], pin: true }];
    }
    case 'ip': return [{ embeds: [embed(c).setTitle(T('title')).setDescription(T('text')).addFields({ name: 'IP', value: `\`\`\`\n${vars.address}\n\`\`\`` })], pin: true }];
    case 'ranks': {
      const ranks = numbered(t, lang, 'tpl.content.ranks.r');
      return [{ embeds: [embed(c).setTitle(T('title')).setDescription(`${T('intro')}\n\n${ranks.join('\n')}\n\n-# ${T('note')}`)], pin: true }];
    }
    case 'vote': return [{ embeds: [embed(c).setTitle(T('title')).setDescription(`${T('text')}\n\n-# ${T('note')}`)], pin: true }];
    case 'partners': {
      const rules = numbered(t, lang, 'tpl.content.partners.req');
      return [{ embeds: [embed(c).setTitle(T('title')).setDescription(`${T('intro')}\n\n**${T('requirements')}**\n${rules.map(r => `• ${r}`).join('\n')}\n\n${T('how')}`)], pin: true }];
    }
    case 'staffapp': {
      const reqs = numbered(t, lang, 'tpl.content.staffapp.req');
      return [{ embeds: [embed(c).setTitle(T('title')).setDescription(`${T('intro')}\n\n**${T('requirements')}**\n${reqs.map(r => `• ${r}`).join('\n')}\n\n${T('how')}`)], pin: true }];
    }
    case 'creators': {
      const reqs = numbered(t, lang, 'tpl.content.creators.req');
      return [{ embeds: [embed(c).setTitle(T('title')).setDescription(`${T('intro')}\n\n${reqs.map(r => `• ${r}`).join('\n')}\n\n${T('how')}`)], pin: true }];
    }
    case 'beta': return [{ embeds: [embed(c).setTitle(T('title')).setDescription(T('text'))], pin: true }];
    case 'boosts': {
      const perks = numbered(t, lang, 'tpl.content.boosts.perk');
      return [{ embeds: [embed(0xf47fff).setTitle(T('title')).setDescription(`${T('intro')}\n\n${perks.map(p => `💎 ${p}`).join('\n')}`)], pin: true }];
    }
    case 'support': return [{ embeds: [embed(c).setTitle(T('title')).setDescription(T('text'))] }];
    case 'changelog': return [{ embeds: [embed(c).setTitle(T('title')).setDescription(T('text'))] }];
    case 'announcement': return [{ content: T('text'), embeds: [embed(c).setTitle(T('title')).setDescription(T('body'))] }];
    case 'staffguide': {
      const items = numbered(t, lang, 'tpl.content.staffguide.i');
      return [{ embeds: [embed(c).setTitle(T('title')).setDescription(items.map((x, i) => `**${i + 1}.** ${x}`).join('\n'))], pin: true }];
    }
    case 'bugs': return [{ embeds: [embed(c).setTitle(T('title')).setDescription(T('text'))], pin: true }];
    case 'appeals': return [{ embeds: [embed(c).setTitle(T('title')).setDescription(T('text'))], pin: true }];
    case 'events': return [{ embeds: [embed(c).setTitle(T('title')).setDescription(T('text'))], pin: true }];
    case 'market': return [{ embeds: [embed(c).setTitle(T('title')).setDescription(T('text'))], pin: true }];
    case 'international': return [{ embeds: [embed(c).setTitle(T('title')).setDescription(T('text'))], pin: true }];
    default: return [];
  }
}

export const CONTENT_KINDS = ['rules', 'start', 'faq', 'info', 'links', 'roles', 'howtojoin', 'ip', 'ranks', 'vote', 'partners', 'staffapp', 'creators', 'beta', 'boosts', 'support', 'changelog', 'announcement', 'staffguide', 'bugs', 'appeals', 'events', 'market', 'international'];

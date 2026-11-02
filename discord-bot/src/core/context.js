/**
 * Per-interaction context passed to every command / component handler.
 *
 *   ctx.t(key, vars)   – user's language (their Discord locale when the guild allows it): ephemeral replies
 *   ctx.tg(key, vars)  – guild language: public messages
 *   ctx.cfg            – effective guild config
 */
import { translator, normalizeLang } from '../i18n/index.js';
import { EPHEMERAL, okEmbed, errEmbed, infoEmbed } from './ui.js';

export class Ctx {
  constructor(bot, interaction) {
    this.bot = bot;
    this.i = interaction;
    this.guild = interaction.guild;
    this.member = interaction.member;
    this.user = interaction.user;
    this.cfg = this.guild ? bot.config.get(this.guild.id) : bot.config.defaults;
    const guildLang = this.cfg.general.language;
    const userLang = this.cfg.general.useMemberLocale ? normalizeLang(interaction.locale) : null;
    this.tg = translator(guildLang);
    this.t = translator(userLang || guildLang);
    this.lang = this.t.lang;
  }

  get options() { return this.i.options; }
  str(name) { return this.i.options.getString(name); }
  int(name) { return this.i.options.getInteger(name); }
  num(name) { return this.i.options.getNumber(name); }
  bool(name) { return this.i.options.getBoolean(name); }
  userOpt(name) { return this.i.options.getUser(name); }
  memberOpt(name) { return this.i.options.getMember(name); }
  channelOpt(name) { return this.i.options.getChannel(name); }
  roleOpt(name) { return this.i.options.getRole(name); }
  attachment(name) { return this.i.options.getAttachment(name); }

  /** reply / followUp / editReply depending on the interaction state */
  async reply(payload) {
    const p = typeof payload === 'string' ? { content: payload } : payload;
    if (this.i.deferred && !this.i.replied) {
      const { flags, withResponse, ...rest } = p;
      const msg = await this.i.editReply(rest);
      return withResponse ? msg : msg;
    }
    if (this.i.replied) return this.i.followUp(p);
    return this.i.reply(p);
  }

  async defer(ephemeral = true) {
    if (this.i.deferred || this.i.replied) return;
    if (this.i.isMessageComponent?.() && !ephemeral) return this.i.deferUpdate();
    await this.i.deferReply(ephemeral ? { flags: EPHEMERAL } : {});
  }

  ok(key, vars) { return this.reply({ embeds: [okEmbed(this.t(key, vars))], flags: EPHEMERAL }); }
  fail(key, vars) { return this.reply({ embeds: [errEmbed(this.t(key, vars))], flags: EPHEMERAL }); }
  info(key, vars) { return this.reply({ embeds: [infoEmbed(this.t(key, vars))], flags: EPHEMERAL }); }

  /** Is the member staff (Manage Server, a configured staff role, or one of the extra roles)? */
  isStaff(extraRoles = []) {
    const m = this.member;
    if (!m) return false;
    if (m.permissions?.has?.('ManageGuild')) return true;
    const roles = [...(this.cfg.general.staffRoles || []), ...extraRoles];
    return roles.some(r => m.roles?.cache?.has(r));
  }
}

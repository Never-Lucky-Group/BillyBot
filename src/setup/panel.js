import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
} from 'discord.js';
import { logger } from '../lib/logger.js';
import { SETUP_SAVE_FAILED, notAdminSetup, setupNotYours } from '../lib/replies.js';
import { edit, send } from '../lib/send.js';
import {
  DEFAULT_DJ_ROLE_NAME,
  DEFAULT_MUSIC_CHANNEL_NAME,
  isAdmin,
  musicSetup,
} from '../music/access.js';

// The panel stops taking clicks after this long without one, like GuildBot's setup panel. Discord
// lets a bot answer a click for 15 minutes.
export const PANEL_IDLE_MS = 14 * 60_000;

const PREFIX = 'billy-setup';
export const CHANGE_BUTTON_ID = `${PREFIX}:change`;
export const CHANNEL_FIELD_ID = 'music-channel';
export const ROLE_FIELD_ID = 'dj-role';
// Channels people can type commands in: text channels and the chat of voice channels.
const MUSIC_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildVoice];
// The bot needs these in the music channel to read commands and answer them.
const CHANNEL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
];

// The embeds may name roles and members; never ping them.
const NO_MENTIONS = { parse: [] };

// !setup: posts a panel showing the server's music channel and DJ role, with a button that opens
// a form to change them. Only the member who ran !setup can use it; it is posted in the channel
// (a typed command cannot get a private reply), but every answer to a click is private.
export async function openSetupPanel(message) {
  const panel = new SetupPanel(message);
  await panel.open();
}

class SetupPanel {
  #guild;
  #user;
  #channel;
  #client;
  #message = null;
  #collector = null;
  #closed = false;

  constructor(commandMessage) {
    this.#guild = commandMessage.guild;
    this.#user = commandMessage.author;
    this.#channel = commandMessage.channel;
    this.#client = commandMessage.client;
  }

  async open() {
    this.#message = await send(this.#channel, this.#render());
    if (!this.#message) return;
    // `idle` restarts with every click.
    this.#collector = this.#message.createMessageComponentCollector({ idle: PANEL_IDLE_MS });
    this.#collector.on('collect', (component) => void this.#onClick(component));
    this.#collector.on('end', () => void this.#close());
  }

  async #onClick(component) {
    try {
      if (component.user.id !== this.#user.id) {
        await this.#private(component, setupNotYours(this.#prefix));
        return;
      }
      // Permissions are checked again: they may have changed since !setup.
      if (!isAdmin(component.member)) {
        await this.#private(component, notAdminSetup(this.#prefix));
        return;
      }
      if (component.customId === CHANGE_BUTTON_ID) await this.#change(component);
    } catch (error) {
      logger.error({ err: error, guildId: this.#guild.id }, 'Setup panel failed');
    }
  }

  // Opens the form, then saves what is submitted and shows it on the panel.
  async #change(component) {
    const formId = `${PREFIX}:form:${component.id}`;
    await component.showModal(this.#form(formId));

    let submit;
    try {
      submit = await component.awaitModalSubmit({
        filter: (candidate) => candidate.customId === formId && candidate.user.id === this.#user.id,
        time: PANEL_IDLE_MS,
      });
    } catch {
      // Closed, or left open too long; nothing to answer.
      return;
    }
    if (!isAdmin(submit.member)) {
      await this.#private(submit, notAdminSetup(this.#prefix));
      return;
    }

    const choice = {
      musicChannelId: submit.fields.getSelectedChannels(CHANNEL_FIELD_ID)?.first()?.id ?? null,
      djRoleId: submit.fields.getSelectedRoles(ROLE_FIELD_ID)?.first()?.id ?? null,
    };
    const before = this.#client.settingsStore.get(this.#guild.id);
    try {
      await this.#client.settingsStore.set(this.#guild.id, choice, this.#user.id);
    } catch (error) {
      logger.error({ err: error, guildId: this.#guild.id }, 'Could not save the settings');
      await this.#private(submit, SETUP_SAVE_FAILED);
      return;
    }
    logger.info(
      { guildId: this.#guild.id, userId: this.#user.id, before, after: choice },
      'Changed the music settings',
    );
    await submit.update(this.#render(this.#savedNote(choice)));
  }

  #form(formId) {
    const setup = musicSetup(this.#guild, this.#client.settingsStore);
    const channel = new ChannelSelectMenuBuilder()
      .setCustomId(CHANNEL_FIELD_ID)
      .setChannelTypes(...MUSIC_CHANNEL_TYPES)
      .setRequired(false)
      .setMinValues(0)
      .setMaxValues(1);
    if (setup.channelId) channel.setDefaultChannels(setup.channelId);
    const role = new RoleSelectMenuBuilder()
      .setCustomId(ROLE_FIELD_ID)
      .setRequired(false)
      .setMinValues(0)
      .setMaxValues(1);
    if (setup.roleId) role.setDefaultRoles(setup.roleId);
    const p = this.#prefix;

    return new ModalBuilder()
      .setCustomId(formId)
      .setTitle('BillyTube setup')
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Music channel')
          .setDescription(
            `Where ${p}play and ${p}skip work. Empty: a channel named ${DEFAULT_MUSIC_CHANNEL_NAME}.`,
          )
          .setChannelSelectMenuComponent(channel),
        new LabelBuilder()
          .setLabel('DJ role')
          .setDescription(
            `Who may use ${p}play and ${p}skip. Empty: a role named ${DEFAULT_DJ_ROLE_NAME}. @everyone: anyone.`,
          )
          .setRoleSelectMenuComponent(role),
      );
  }

  // "Saved", plus a warning if the bot cannot work in the chosen channel.
  #savedNote({ musicChannelId }) {
    const channel = musicChannelId && this.#guild.channels.cache.get(musicChannelId);
    const permissions = channel?.permissionsFor(this.#guild.members.me);
    if (channel && !permissions?.has(CHANNEL_PERMISSIONS)) {
      return (
        `✅ Saved. ⚠️ I can't read or answer messages in <#${channel.id}> yet: give me View ` +
        'Channel, Send Messages and Embed Links there.'
      );
    }
    return '✅ Saved.';
  }

  async #close() {
    if (this.#closed) return;
    this.#closed = true;
    await edit(this.#message, this.#render());
  }

  // The panel message: the current settings, a note from the last change, and the button while
  // the panel is open.
  #render(note = null) {
    const setup = musicSetup(this.#guild, this.#client.settingsStore);
    const channelText = setup.channelId
      ? `<#${setup.channelId}>`
      : `#${DEFAULT_MUSIC_CHANNEL_NAME} (default: any channel with that name)`;
    let roleText;
    if (!setup.roleId) roleText = `@${DEFAULT_DJ_ROLE_NAME} (default: any role with that name)`;
    else if (setup.roleId === this.#guild.id) roleText = '@everyone (anyone)';
    else roleText = `<@&${setup.roleId}>`;
    const p = this.#prefix;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('⚙️ BillyTube setup')
      .setDescription(
        [
          note,
          `${p}play and ${p}skip work only in the music channel, for members with the DJ role. ` +
            `${p}queue works for everyone; ${p}leave and ${p}setup for the server owner and ` +
            'members with Manage Server.',
        ]
          .filter(Boolean)
          .join('\n\n'),
      )
      .addFields(
        { name: 'Music channel', value: channelText, inline: true },
        { name: 'DJ role', value: roleText, inline: true },
      )
      .setFooter({
        text: this.#closed
          ? `Setup closed. Run ${p}setup to change it again.`
          : `Only ${this.#user.username} can use this panel. It closes after 14 minutes without a click.`,
      });
    const components = this.#closed
      ? []
      : [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(CHANGE_BUTTON_ID)
              .setLabel('Change settings')
              .setStyle(ButtonStyle.Primary),
          ),
        ];
    return { embeds: [embed], components, allowedMentions: NO_MENTIONS };
  }

  get #prefix() {
    return this.#client.settings.prefix;
  }

  async #private(interaction, content) {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}

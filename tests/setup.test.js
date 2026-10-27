import { EventEmitter } from 'node:events';
import { Collection, MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import setup from '../src/commands/setup.js';
import { SETUP_SAVE_FAILED, notAdminSetup, setupNotYours } from '../src/lib/replies.js';
import {
  CHANGE_BUTTON_ID,
  CHANNEL_FIELD_ID,
  PANEL_IDLE_MS,
  ROLE_FIELD_ID,
} from '../src/setup/panel.js';
import {
  GUILD_ID,
  OWNER_ID,
  USER_ID,
  fakeGuild,
  fakeGuildMessage,
  fakeMember,
  fakeTextChannel,
  flush,
} from './helpers/fakes.js';

const JUKEBOX = { id: '200000000000000050', name: 'jukebox' };
const MUSIC_ROLE = { id: '500000000000000050', name: 'Music' };

// The panel message the bot posts: its collector is an EventEmitter the test drives.
function fakePanelMessage() {
  const collector = new EventEmitter();
  const panel = {
    id: '400000000000000050',
    collector,
    collectorOptions: null,
    createMessageComponentCollector: vi.fn((options) => {
      panel.collectorOptions = options;
      return collector;
    }),
    edit: vi.fn(() => Promise.resolve(panel)),
    delete: vi.fn(),
  };
  return panel;
}

// `canWork` is whether the bot may read and answer in the jukebox channel.
function setUp({ member = fakeMember({ manageServer: true }), canWork = true } = {}) {
  const jukebox = { ...JUKEBOX, permissionsFor: () => ({ has: () => canWork }) };
  const guild = fakeGuild({ channels: [jukebox], roles: [MUSIC_ROLE] });
  member.guild = guild;
  // In memory only: the real store's saving is tested in settingsStore.test.js.
  const stored = new Map();
  const settingsStore = {
    get: (guildId) => stored.get(guildId) ?? { musicChannelId: null, djRoleId: null },
    set: vi.fn(async (guildId, choice) => {
      stored.set(guildId, choice);
    }),
  };

  const panel = fakePanelMessage();
  const channel = fakeTextChannel({ name: 'general' });
  channel.send = vi.fn(() => Promise.resolve(panel));
  const message = fakeGuildMessage({
    content: '!setup',
    member,
    channel,
    client: { settingsStore },
  });
  message.guild = guild;
  return { message, panel, settingsStore, stored, guild };
}

// A click on the panel's button. `submit` is the form submission it gets, or undefined for a form
// that was closed.
function click({ userId = USER_ID, member = fakeMember({ manageServer: true }), submit } = {}) {
  return {
    id: '600000000000000001',
    customId: CHANGE_BUTTON_ID,
    user: { id: userId },
    member,
    showModal: vi.fn(() => Promise.resolve()),
    awaitModalSubmit: vi.fn(() =>
      submit ? Promise.resolve(submit) : Promise.reject(new Error('time')),
    ),
    reply: vi.fn(() => Promise.resolve()),
  };
}

function submission({ channel = null, role = null, member = fakeMember({ manageServer: true }) }) {
  const picked = (item) => (item ? new Collection([[item.id, item]]) : new Collection());
  return {
    member,
    fields: {
      getSelectedChannels: (id) => (id === CHANNEL_FIELD_ID ? picked(channel) : undefined),
      getSelectedRoles: (id) => (id === ROLE_FIELD_ID ? picked(role) : undefined),
    },
    update: vi.fn(() => Promise.resolve()),
    reply: vi.fn(() => Promise.resolve()),
  };
}

const panelEmbed = (options) => options.embeds[0].data;
const fieldValues = (options) => panelEmbed(options).fields.map((field) => field.value);

async function openPanel(options) {
  const setupState = setUp(options);
  await setup.execute(setupState.message, []);
  return setupState;
}

async function press(panel, component) {
  panel.collector.emit('collect', component);
  await flush();
  await flush();
}

describe('!setup', () => {
  it('refuses members without Manage Server who do not own the server', async () => {
    const { message } = setUp({ member: fakeMember({ roles: ['DJ'] }) });
    await setup.execute(message, []);
    expect(message.channel.send).toHaveBeenCalledWith(notAdminSetup('!'));
  });

  it('posts the panel for the server owner, showing the defaults', async () => {
    const { message, panel } = await openPanel({ member: fakeMember({ id: OWNER_ID }) });

    const [[options]] = message.channel.send.mock.calls;
    expect(panelEmbed(options).title).toBe('⚙️ BillyTube setup');
    expect(fieldValues(options)).toEqual([
      '#music_bot (default: any channel with that name)',
      '@DJ (default: any role with that name)',
    ]);
    expect(options.components[0].components[0].data.custom_id).toBe(CHANGE_BUTTON_ID);
    expect(options.allowedMentions).toEqual({ parse: [] });
    expect(panel.collectorOptions).toEqual({ idle: PANEL_IDLE_MS });
  });

  it('works in any channel', async () => {
    const { message } = await openPanel();
    expect(message.channel.name).toBe('general');
    expect(message.channel.send).toHaveBeenCalledOnce();
  });
});

describe('setup panel', () => {
  it('tells anyone else the panel is not theirs', async () => {
    const { panel } = await openPanel();
    const other = click({ userId: '399999999999999999' });
    await press(panel, other);
    expect(other.reply).toHaveBeenCalledWith({
      content: setupNotYours('!'),
      flags: MessageFlags.Ephemeral,
    });
    expect(other.showModal).not.toHaveBeenCalled();
  });

  it('refuses a click from someone who lost Manage Server since !setup', async () => {
    const { panel } = await openPanel();
    const component = click({ member: fakeMember({ roles: [] }) });
    await press(panel, component);
    expect(component.reply.mock.calls[0][0].content).toBe(notAdminSetup('!'));
    expect(component.showModal).not.toHaveBeenCalled();
  });

  it('opens a form with the current channel and role picked', async () => {
    const { panel, stored } = await openPanel();
    stored.set(GUILD_ID, { musicChannelId: JUKEBOX.id, djRoleId: MUSIC_ROLE.id });
    const component = click();
    await press(panel, component);

    const modal = component.showModal.mock.calls[0][0].toJSON();
    expect(modal.title).toBe('BillyTube setup');
    const [channelLabel, roleLabel] = modal.components;
    expect(channelLabel.component.custom_id).toBe(CHANNEL_FIELD_ID);
    expect(channelLabel.component.default_values).toEqual([{ id: JUKEBOX.id, type: 'channel' }]);
    expect(roleLabel.component.custom_id).toBe(ROLE_FIELD_ID);
    expect(roleLabel.component.default_values).toEqual([{ id: MUSIC_ROLE.id, type: 'role' }]);
  });

  it('saves the picked channel and role and shows them on the panel', async () => {
    const { panel, settingsStore } = await openPanel();
    const submit = submission({ channel: JUKEBOX, role: MUSIC_ROLE });
    await press(panel, click({ submit }));

    expect(settingsStore.set).toHaveBeenCalledWith(
      GUILD_ID,
      { musicChannelId: JUKEBOX.id, djRoleId: MUSIC_ROLE.id },
      USER_ID,
    );
    const [[options]] = submit.update.mock.calls;
    expect(fieldValues(options)).toEqual([`<#${JUKEBOX.id}>`, `<@&${MUSIC_ROLE.id}>`]);
    expect(panelEmbed(options).description).toMatch(/^✅ Saved\./);
  });

  it('goes back to the defaults when the pickers are emptied', async () => {
    const { panel, settingsStore, stored } = await openPanel();
    stored.set(GUILD_ID, { musicChannelId: JUKEBOX.id, djRoleId: MUSIC_ROLE.id });
    const submit = submission({});
    await press(panel, click({ submit }));

    expect(settingsStore.set).toHaveBeenCalledWith(
      GUILD_ID,
      { musicChannelId: null, djRoleId: null },
      USER_ID,
    );
    expect(fieldValues(submit.update.mock.calls[0][0])[0]).toMatch(/default/);
  });

  it('shows @everyone as anyone', async () => {
    const { panel, guild } = await openPanel();
    guild.roles.cache.set(GUILD_ID, { id: GUILD_ID, name: '@everyone' });
    const submit = submission({ role: { id: GUILD_ID } });
    await press(panel, click({ submit }));
    expect(fieldValues(submit.update.mock.calls[0][0])[1]).toBe('@everyone (anyone)');
  });

  it('warns when the bot cannot work in the chosen channel', async () => {
    const { panel } = await openPanel({ canWork: false });
    const submit = submission({ channel: JUKEBOX });
    await press(panel, click({ submit }));
    expect(panelEmbed(submit.update.mock.calls[0][0]).description).toMatch(
      /can't read or answer messages/,
    );
  });

  it('saves nothing when the form is closed', async () => {
    const { panel, settingsStore } = await openPanel();
    await press(panel, click());
    expect(settingsStore.set).not.toHaveBeenCalled();
  });

  it('refuses the form from someone who lost Manage Server while it was open', async () => {
    const { panel, settingsStore } = await openPanel();
    const submit = submission({ channel: JUKEBOX, member: fakeMember({ roles: [] }) });
    await press(panel, click({ submit }));
    expect(settingsStore.set).not.toHaveBeenCalled();
    expect(submit.reply.mock.calls[0][0].content).toBe(notAdminSetup('!'));
  });

  it('says so privately when the settings cannot be saved', async () => {
    const { panel, settingsStore } = await openPanel();
    settingsStore.set.mockRejectedValueOnce(new Error('disk full'));
    const submit = submission({ channel: JUKEBOX });
    await press(panel, click({ submit }));
    expect(submit.reply).toHaveBeenCalledWith({
      content: SETUP_SAVE_FAILED,
      flags: MessageFlags.Ephemeral,
    });
    expect(submit.update).not.toHaveBeenCalled();
  });

  it('removes the button when it closes after going idle', async () => {
    const { panel } = await openPanel();
    panel.collector.emit('end');
    await flush();

    const [[options]] = panel.edit.mock.calls;
    expect(options.components).toEqual([]);
    expect(panelEmbed(options).footer.text).toBe('Setup closed. Run !setup to change it again.');
  });
});

import { notAdminSetup } from '../lib/replies.js';
import { send } from '../lib/send.js';
import { isAdmin } from '../music/access.js';
import { openSetupPanel } from '../setup/panel.js';

// Admins only, from any channel (so it works before a music channel exists). Opens the setup
// panel for choosing the server's music channel and DJ role.
export default {
  name: 'setup',
  async execute(message) {
    if (!isAdmin(message.member)) {
      await send(message.channel, notAdminSetup(message.client.settings.prefix));
      return;
    }
    await openSetupPanel(message);
  },
};

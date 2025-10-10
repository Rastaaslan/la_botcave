// deploy-commands.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TOKEN = process.env.DISCORD_TOKEN;

const slashPath = path.join(__dirname, 'slash');
const commands = [];
const files = fs.readdirSync(slashPath).filter(f => f.endsWith('.js'));
for (const file of files) {
  const cmd = require(path.join(slashPath, file));
  if (cmd?.data) commands.push(cmd.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log('Slash commands enregistrées (guild).');
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log('Slash commands enregistrées (global).');
    }
  } catch (e) {
    console.error('Erreur de déploiement:', e);
  }
})();

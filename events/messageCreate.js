// events/messageCreate.js
const { buildEmbed } = require('../utils/embedHelper');

let PREFIX = process.env.PREFIX || '!';
try {
  const cfg = require('../config.json');
  if (cfg && typeof cfg.prefix === 'string' && cfg.prefix.trim().length > 0) {
    PREFIX = cfg.prefix.trim();
  }
} catch {}

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    if (message.author.bot) return;
    const content = message.content || '';
    if (!content.startsWith(PREFIX)) return;
    if (!message.guild) return;

    const args = content.slice(PREFIX.length).trim().split(/ +/);
    const commandName = args.shift()?.toLowerCase();
    const command = client.commands.get(commandName);
    if (!command) return;

    try {
      await command.execute(message, args, client);
    } catch (error) {
      console.error(error);
      return message.reply({
        embeds: [
          buildEmbed(message.guild.id, {
            type: 'error',
            title: 'Erreur',
            description: 'Une erreur est survenue lors de l’exécution de la commande.',
          }),
        ],
      });
    }
  },
};

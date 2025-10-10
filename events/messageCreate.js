// events/messageCreate.js
const { buildEmbed } = require('../utils/embedHelper');

// Préfixe: ENV > config.json (optionnel) > défaut '!'
let PREFIX = process.env.PREFIX || '!';
try {
  // Optionnel: si un config.json existe au root avec { "prefix": "!" }, on l'utilise
  // Ne jette pas d'erreur si absent
  // eslint-disable-next-line import/no-unresolved, global-require
  const cfg = require('../config.json');
  if (cfg && typeof cfg.prefix === 'string' && cfg.prefix.trim().length > 0) {
    PREFIX = cfg.prefix.trim();
  }
} catch {
  // pas de config.json, on garde ENV/défaut
}

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    // Ignorer bots et messages sans préfixe
    if (message.author.bot) return;
    const content = message.content || '';
    if (!content.startsWith(PREFIX)) return;

    // Pas de gestion en DM si le helper dépend du guildId
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

// events/messageCreate.js
const { buildEmbed } = require('../utils/embedHelper');
const config = require('../config.json');

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    const prefix = config.prefix;
    if (message.author.bot || !message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
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

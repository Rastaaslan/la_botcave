module.exports = {
  name: 'messageCreate',
  execute(message, client) {
    const config = require('../config.json');
    const prefix = config.prefix;
    
    if (message.author.bot || !message.content.startsWith(prefix)) return;
    
    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();
    
    const command = client.commands.get(commandName);
    if (!command) return;
    
    try {
      command.execute(message, args, client);
    } catch (error) {
      console.error(error);
      message.reply('Une erreur est survenue lors de l\'exécution de la commande.');
    }
  },
};

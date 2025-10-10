const { EmbedBuilder } = require('discord.js');
const { getTheme } = require('../utils/themeStore');

module.exports = {
  name: 'queue',
  description: 'Affiche la file d\'attente actuelle',
  execute(message, args, client) {
    const player = client.manager.players.get(message.guild.id);
    if (!player) {
      return message.reply({ content: '❌ Rien ne joue actuellement !' });
    }
    const theme = getTheme(message.guild.id);
    const embed = new EmbedBuilder().setTitle('🎵 File d\'attente').setColor(theme.color);

    if (player.current) {
      embed.setDescription(`**En lecture :**\n${player.current.title}`);
    }
    if (player.queue.size > 0) {
      const tracks = player.queue.tracks.slice(0, 10).map((t, i) => `${i + 1}. ${t.title}`).join('\n');
      embed.addFields({ name: `À suivre (${player.queue.size} piste(s))`, value: tracks || 'Aucune piste' });
    }
    return message.reply({ embeds: [embed] });
  },
};

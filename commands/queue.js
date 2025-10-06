const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'queue',
  description: 'Affiche la file d\'attente actuelle',
  execute(message, args, client) {
    const player = client.manager.players.get(message.guild.id);
    
    if (!player) {
      return message.reply('❌ Rien ne joue actuellement !');
    }
    
    const embed = new EmbedBuilder()
      .setTitle('🎵 File d\'attente')
      .setColor('#0099ff');
    
    if (player.current) {
      embed.setDescription(`**En lecture :**\n${player.current.title}`);
    }
    
    if (player.queue.size > 0) {
      const tracks = player.queue.tracks
        .slice(0, 10)
        .map((track, i) => `${i + 1}. ${track.title}`)
        .join('\n');
      
      embed.addFields({
        name: `À suivre (${player.queue.size} piste(s))`,
        value: tracks || 'Aucune piste',
      });
    }
    
    message.reply({ embeds: [embed] });
  },
};

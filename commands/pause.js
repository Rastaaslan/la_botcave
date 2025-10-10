const { buildEmbed } = require('../utils/embedHelper');

module.exports = {
  name: 'pause',
  description: 'Met la lecture en pause',
  execute(message, args, client) {
    const guildId = message.guild.id;
    const player = client.manager.players.get(guildId);
    if (!player) {
      return message.reply({ embeds: [buildEmbed(guildId, { type: 'error', title: 'Aucune musique', description: 'Rien ne joue actuellement.' })]});
    }
    if (message.member.voice.channel?.id !== player.voiceChannelId) {
      return message.reply({ embeds: [buildEmbed(guildId, { type: 'error', title: 'Salon vocal', description: 'Être dans le même salon que le bot.' })]});
    }
    if (player.paused) {
      return message.reply({ embeds: [buildEmbed(guildId, { title: 'Déjà en pause', description: 'La lecture est déjà en pause.' })]});
    }
    player.pause();
    return message.reply({ embeds: [buildEmbed(guildId, { type: 'success', title: 'Pause', description: 'Lecture mise en pause.' })]});
  },
};

const { buildEmbed } = require('../utils/embedHelper');

module.exports = {
  name: 'resume',
  description: 'Reprend la lecture',
  execute(message, args, client) {
    const guildId = message.guild.id;
    const player = client.manager.players.get(guildId);
    if (!player) {
      return message.reply({ embeds: [buildEmbed(guildId, { type: 'error', title: 'Aucune musique', description: 'Rien ne joue actuellement.' })]});
    }
    if (message.member.voice.channel?.id !== player.voiceChannelId) {
      return message.reply({ embeds: [buildEmbed(guildId, { type: 'error', title: 'Salon vocal', description: 'Être dans le même salon que le bot.' })]});
    }
    if (!player.paused) {
      return message.reply({ embeds: [buildEmbed(guildId, { title: 'Déjà en lecture', description: 'La lecture n’est pas en pause.' })]});
    }
    player.resume();
    return message.reply({ embeds: [buildEmbed(guildId, { type: 'success', title: 'Lecture reprise', description: 'La musique continue.' })]});
  },
};

const { buildEmbed } = require('../utils/embedHelper');

module.exports = {
  name: 'stop',
  description: 'Arrête la lecture et vide la file',
  execute(message, args, client) {
    const guildId = message.guild.id;
    const player = client.manager.players.get(guildId);
    if (!player) {
      return message.reply({ embeds: [buildEmbed(guildId, { type: 'error', title: 'Aucune musique', description: 'Rien ne joue actuellement.' })]});
    }
    if (message.member.voice.channel?.id !== player.voiceChannelId) {
      return message.reply({ embeds: [buildEmbed(guildId, { type: 'error', title: 'Salon vocal', description: 'Être dans le même salon que le bot.' })]});
    }
    player.destroy();
    return message.reply({ embeds: [buildEmbed(guildId, { type: 'success', title: 'Arrêt', description: 'Lecture arrêtée et file vidée.' })]});
  },
};

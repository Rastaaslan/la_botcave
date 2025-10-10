const { buildEmbed } = require('../utils/embedHelper');

module.exports = {
  name: 'mute',
  description: 'Coupe le son du bot',
  async execute(message, args, client) {
    const guildId = message.guild.id;
    try {
      const player = client.manager.players.get(guildId);
      if (!player || !player.connected) {
        return message.reply({ embeds: [buildEmbed(guildId, { type: 'error', title: 'Aucune musique', description: 'Aucune musique en cours.' })]});
      }
      const vc = message.member.voice.channel;
      if (!vc || vc.id !== player.voiceChannelId) {
        return message.reply({ embeds: [buildEmbed(guildId, { type: 'error', title: 'Salon vocal', description: 'Être dans le même salon que le bot.' })]});
      }
      player.setVolume(0);
      return message.reply({ embeds: [buildEmbed(guildId, { type: 'success', title: 'Muet', description: '🔇 Son coupé.' })]});
    } catch (e) {
      console.error('Erreur mute:', e);
      return message.reply({ embeds: [buildEmbed(guildId, { type: 'error', title: 'Erreur', description: 'Une erreur est survenue.' })]});
    }
  },
};

const { buildEmbed } = require('../utils/embedHelper');

module.exports = {
  name: 'unmute',
  description: 'Remet le son du bot à 100%',
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
      player.setVolume(100);
      return message.reply({ embeds: [buildEmbed(guildId, { type: 'success', title: 'Volume rétabli', description: '🔊 Volume à 100%.' })]});
    } catch (e) {
      console.error('Erreur unmute:', e);
      return message.reply({ embeds: [buildEmbed(guildId, { type: 'error', title: 'Erreur', description: 'Une erreur est survenue.' })]});
    }
  },
};

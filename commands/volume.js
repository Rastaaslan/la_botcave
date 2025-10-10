const { buildEmbed } = require('../utils/embedHelper');

module.exports = {
  name: 'volume',
  description: 'Ajuste le volume du bot (0-200)',
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
      if (!args[0]) {
        return message.reply({ embeds: [buildEmbed(guildId, { title: 'Volume actuel', description: `🔊 ${player.volume}%` })]});
      }
      const newVolume = parseInt(args[0], 10);
      if (isNaN(newVolume) || newVolume < 0 || newVolume > 200) {
        return message.reply({ embeds: [buildEmbed(guildId, { type: 'error', title: 'Volume invalide', description: 'Utiliser !volume <0-200>.' })]});
      }
      player.setVolume(newVolume);
      return message.reply({ embeds: [buildEmbed(guildId, { type: 'success', title: 'Volume réglé', description: `Nouveau volume: ${newVolume}%` })]});
    } catch (e) {
      console.error('Erreur volume:', e);
      return message.reply({ embeds: [buildEmbed(guildId, { type: 'error', title: 'Erreur', description: 'Une erreur est survenue.' })]});
    }
  },
};

const { buildEmbed } = require('../utils/embedHelper');

module.exports = {
  name: 'skip',
  description: 'Passe à la piste suivante',
  execute(message, args, client) {
    const guildId = message.guild.id;
    const player = client.manager.players.get(guildId);
    if (!player) {
      return message.reply({ embeds: [buildEmbed(guildId, { type: 'error', title: 'Aucune musique', description: 'Rien ne joue actuellement.' })]});
    }
    if (message.member.voice.channel?.id !== player.voiceChannelId) {
      return message.reply({ embeds: [buildEmbed(guildId, { type: 'error', title: 'Salon vocal', description: 'Être dans le même salon que le bot.' })]});
    }
    if (!player.queue.size && !player.current) {
      return message.reply({ embeds: [buildEmbed(guildId, { type: 'error', title: 'File vide', description: 'Aucune piste à passer.' })]});
    }
    const currentTitle = player.current?.title || 'Piste';
    player.skip();
    return message.reply({ embeds: [buildEmbed(guildId, { type: 'success', title: 'Piste passée', description: `⏭️ ${currentTitle}` })]});
  },
};

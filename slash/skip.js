const { SlashCommandBuilder: SCB3 } = require('discord.js');
const { buildEmbed: BE3 } = require('../utils/embedHelper');
const { PlayerManager: PM3 } = require('../utils/playerManager');

module.exports = {
  data: new SCB3().setName('skip').setDescription('Passer à la piste suivante'),
  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const voiceChannel = interaction.member?.voice?.channel;
    
    if (!voiceChannel) {
      return interaction.reply({ ephemeral: true, embeds: [BE3(gid, { type: 'error', title: 'Salon vocal requis', description: 'Vous devez être dans un salon vocal.' })]});
    }
    
    const player = PM3.getPlayerForUser(client, gid, voiceChannel.id);
    
    if (!player) {
      return interaction.reply({ ephemeral: true, embeds: [BE3(gid, { type: 'error', title: 'Aucune musique', description: `Aucune instance active dans **${voiceChannel.name}**.` })]});
    }
    
    if (player.queue.size === 0 && !player.currentTrack) {
      return interaction.reply({ ephemeral: true, embeds: [BE3(gid, { type: 'error', title: 'File vide', description: `Aucune piste à passer.\n\n💿 Instance: **${player.metadata?.sessionName}**` })]});
    }
    
    const title = player.currentTrack?.info?.title || 'Piste';
    player.skip();
    PM3.updateActivity(player);
    
    return interaction.reply({ embeds: [BE3(gid, { type: 'success', title: 'Piste passée', description: `⏭️ ${title}\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**` })]});
  }
};
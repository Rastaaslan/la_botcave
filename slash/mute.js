const { SlashCommandBuilder: SCB6 } = require('discord.js');
const { buildEmbed: BE6 } = require('../utils/embedHelper');
const { PlayerManager: PM6 } = require('../utils/playerManager');

module.exports = {
  data: new SCB6().setName('mute').setDescription('Couper le son du bot'),
  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const voiceChannel = interaction.member?.voice?.channel;
    
    if (!voiceChannel) {
      return interaction.reply({ ephemeral: true, embeds: [BE6(gid, { type: 'error', title: 'Salon vocal requis', description: 'Vous devez être dans un salon vocal.' })]});
    }
    
    const player = PM6.getPlayerForUser(client, gid, voiceChannel.id);
    
    if (!player || !player.isConnected) {
      return interaction.reply({ ephemeral: true, embeds: [BE6(gid, { type: 'error', title: 'Aucune musique', description: `Aucune instance active dans **${voiceChannel.name}**.` })]});
    }
    
    player.filters.setVolume(0);
    PM6.updateActivity(player);
    
    return interaction.reply({ embeds: [BE6(gid, { type: 'success', title: 'Muet', description: `🔇 Son coupé.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**` })]});
  }
};
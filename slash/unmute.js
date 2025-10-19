const { SlashCommandBuilder: SCB7 } = require('discord.js');
const { buildEmbed: BE7 } = require('../utils/embedHelper');
const { PlayerManager: PM7 } = require('../utils/playerManager');

module.exports = {
  data: new SCB7().setName('unmute').setDescription('Rétablir le son du bot à 100%'),
  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const voiceChannel = interaction.member?.voice?.channel;
    
    if (!voiceChannel) {
      return interaction.reply({ ephemeral: true, embeds: [BE7(gid, { type: 'error', title: 'Salon vocal requis', description: 'Vous devez être dans un salon vocal.' })]});
    }
    
    const player = PM7.getPlayerForUser(client, gid, voiceChannel.id);
    
    if (!player || !player.isConnected) {
      return interaction.reply({ ephemeral: true, embeds: [BE7(gid, { type: 'error', title: 'Aucune musique', description: `Aucune instance active dans **${voiceChannel.name}**.` })]});
    }
    
    player.filters.setVolume(1.0);
    PM7.updateActivity(player);
    
    return interaction.reply({ embeds: [BE7(gid, { type: 'success', title: 'Volume rétabli', description: `🔊 Volume à 100%.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**` })]});
  }
};
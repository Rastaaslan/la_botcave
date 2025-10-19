const { SlashCommandBuilder: SCB4 } = require('discord.js');
const { buildEmbed: BE4 } = require('../utils/embedHelper');
const { PlayerManager: PM4 } = require('../utils/playerManager');

module.exports = {
  data: new SCB4().setName('stop').setDescription('Arrêter la lecture et vider la file'),
  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const voiceChannel = interaction.member?.voice?.channel;
    
    if (!voiceChannel) {
      return interaction.reply({ ephemeral: true, embeds: [BE4(gid, { type: 'error', title: 'Salon vocal requis', description: 'Vous devez être dans un salon vocal.' })]});
    }
    
    const player = PM4.getPlayerForUser(client, gid, voiceChannel.id);
    
    if (!player) {
      return interaction.reply({ ephemeral: true, embeds: [BE4(gid, { type: 'error', title: 'Aucune musique', description: `Aucune instance active dans **${voiceChannel.name}**.` })]});
    }
    
    const sessionName = player.metadata?.sessionName || 'Session';
    player.destroy();
    
    return interaction.reply({ embeds: [BE4(gid, { type: 'success', title: 'Arrêt', description: `Instance **${sessionName}** arrêtée et file vidée.\n\nSalon: **${voiceChannel.name}**` })]});
  }
};
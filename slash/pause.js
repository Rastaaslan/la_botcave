const { SlashCommandBuilder } = require('discord.js');
const { buildEmbed } = require('../utils/embedHelper');
const { PlayerManager } = require('../utils/playerManager');

module.exports = {
  data: new SlashCommandBuilder().setName('pause').setDescription('Mettre en pause la lecture'),
  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const voiceChannel = interaction.member?.voice?.channel;
    
    if (!voiceChannel) {
      return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, { type: 'error', title: 'Salon vocal requis', description: 'Vous devez être dans un salon vocal.' })]});
    }
    
    const player = PlayerManager.getPlayerForUser(client, gid, voiceChannel.id);
    
    if (!player) {
      return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, { type: 'error', title: 'Aucune musique', description: `Aucune instance active dans **${voiceChannel.name}**.` })]});
    }
    
    if (player.isPaused) {
      return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, { title: 'Déjà en pause', description: `La lecture est déjà en pause.\n\n💿 Instance: **${player.metadata?.sessionName}**` })]});
    }
    
    player.pause(true);
    PlayerManager.updateActivity(player);
    
    return interaction.reply({ embeds: [buildEmbed(gid, { type: 'success', title: 'Pause', description: `Lecture en pause.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**` })]});
  }
};
// slash/mute.js - SMART MODE
const { SlashCommandBuilder } = require('discord.js');
const { buildEmbed } = require('../utils/embedHelper');
const { PlayerManager } = require('../utils/playerManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Couper le son du bot'),
    
  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const voiceChannel = interaction.member?.voice?.channel;
    
    if (!voiceChannel) {
      return interaction.reply({ 
        ephemeral: true, 
        embeds: [buildEmbed(gid, { 
          type: 'error', 
          title: 'Salon vocal requis', 
          description: 'Vous devez être dans un salon vocal.' 
        })]
      });
    }
    
    const player = PlayerManager.getPlayerForUser(client, gid, voiceChannel.id);
    
    if (!player || !player.connected) {
      return interaction.reply({ 
        ephemeral: true, 
        embeds: [buildEmbed(gid, { 
          type: 'error', 
          title: 'Aucune musique', 
          description: `Aucune instance active dans **${voiceChannel.name}**.` 
        })]
      });
    }
    
    player.setVolume(0);
    PlayerManager.updateActivity(player);
    
    return interaction.reply({ 
      embeds: [buildEmbed(gid, { 
        type: 'success', 
        title: 'Muet', 
        description: `🔇 Son coupé.\n\n🎵 Instance: **${player.metadata?.sessionName || 'Session'}** dans **${voiceChannel.name}**` 
      })]
    });
  }
};
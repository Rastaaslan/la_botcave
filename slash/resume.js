const { SlashCommandBuilder: SlashCommandBuilder2 } = require('discord.js');
const { buildEmbed: buildEmbed2 } = require('../utils/embedHelper');
const { PlayerManager: PlayerManager2 } = require('../utils/playerManager');

module.exports = {
  data: new SlashCommandBuilder2().setName('resume').setDescription('Reprendre la lecture'),
  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const voiceChannel = interaction.member?.voice?.channel;
    
    if (!voiceChannel) {
      return interaction.reply({ 
        ephemeral: true, 
        embeds: [buildEmbed2(gid, { 
          type: 'error', 
          title: 'Salon vocal requis', 
          description: 'Vous devez être dans un salon vocal.' 
        })]
      });
    }
    
    const player = PlayerManager2.getPlayerForUser(client, gid, voiceChannel.id);
    
    if (!player) {
      return interaction.reply({ 
        ephemeral: true, 
        embeds: [buildEmbed2(gid, { 
          type: 'error', 
          title: 'Aucune musique', 
          description: `Aucune instance active dans **${voiceChannel.name}**.` 
        })]
      });
    }
    
    if (!player.paused) {
      return interaction.reply({ 
        ephemeral: true, 
        embeds: [buildEmbed2(gid, { 
          title: 'Déjà en lecture', 
          description: `La lecture n'est pas en pause.\n\n🎵 Instance: **${player.metadata?.sessionName || 'Session'}**` 
        })]
      });
    }
    
    player.resume();
    PlayerManager2.updateActivity(player);
    
    return interaction.reply({ 
      embeds: [buildEmbed2(gid, { 
        type: 'success', 
        title: 'Lecture reprise', 
        description: `La musique continue.\n\n🎵 Instance: **${player.metadata?.sessionName || 'Session'}** dans **${voiceChannel.name}**` 
      })]
    });
  }
};
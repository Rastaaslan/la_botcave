const { SlashCommandBuilder: SlashCommandBuilder3 } = require('discord.js');
const { buildEmbed: buildEmbed3 } = require('../utils/embedHelper');
const { PlayerManager: PlayerManager3 } = require('../utils/playerManager');

module.exports = {
  data: new SlashCommandBuilder3().setName('skip').setDescription('Passer à la piste suivante'),
  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const voiceChannel = interaction.member?.voice?.channel;
    
    if (!voiceChannel) {
      return interaction.reply({ 
        ephemeral: true, 
        embeds: [buildEmbed3(gid, { 
          type: 'error', 
          title: 'Salon vocal requis', 
          description: 'Vous devez être dans un salon vocal.' 
        })]
      });
    }
    
    const player = PlayerManager3.getPlayerForUser(client, gid, voiceChannel.id);
    
    if (!player) {
      return interaction.reply({ 
        ephemeral: true, 
        embeds: [buildEmbed3(gid, { 
          type: 'error', 
          title: 'Aucune musique', 
          description: `Aucune instance active dans **${voiceChannel.name}**.` 
        })]
      });
    }
    
    if (!player.queue.size && !player.current) {
      return interaction.reply({ 
        ephemeral: true, 
        embeds: [buildEmbed3(gid, { 
          type: 'error', 
          title: 'File vide', 
          description: `Aucune piste à passer.\n\n🎵 Instance: **${player.metadata?.sessionName || 'Session'}**` 
        })]
      });
    }
    
    const title = player.current?.title || 'Piste';
    player.skip();
    PlayerManager3.updateActivity(player);
    
    return interaction.reply({ 
      embeds: [buildEmbed3(gid, { 
        type: 'success', 
        title: 'Piste passée', 
        description: `⏭️ ${title}\n\n🎵 Instance: **${player.metadata?.sessionName || 'Session'}** dans **${voiceChannel.name}**` 
      })]
    });
  }
};
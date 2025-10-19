const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getTheme } = require('../utils/themeStore');
const { PlayerManager } = require('../utils/playerManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Afficher la file d\'attente'),
    
  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const voiceChannel = interaction.member?.voice?.channel;
    
    if (!voiceChannel) {
      return interaction.reply({ 
        ephemeral: true, 
        content: '❌ Vous devez être dans un salon vocal !' 
      });
    }
    
    const player = PlayerManager.getPlayerForUser(client, gid, voiceChannel.id);
    
    if (!player) {
      return interaction.reply({ 
        ephemeral: true, 
        content: `❌ Aucune instance active dans **${voiceChannel.name}** !` 
      });
    }

    const theme = getTheme(gid);
    const embed = new EmbedBuilder()
      .setTitle('🎵 File d\'attente')
      .setColor(theme.color)
      .setFooter({ 
        text: `Instance: ${player.metadata?.sessionName || 'Session'} • Salon: ${voiceChannel.name}` 
      });
    
    if (player.currentTrack) {
      embed.setDescription(`**🎶 En lecture :**\n${player.currentTrack.info.title}`);
    }
    
    if (player.queue.size > 0) {
      const tracks = player.queue
        .slice(0, 10)
        .map((t, i) => `${i + 1}. ${t.info.title}`)
        .join('\n');
      
      embed.addFields({ 
        name: `À suivre (${player.queue.size} piste(s))`, 
        value: tracks || 'Aucune piste' 
      });
      
      if (player.queue.size > 10) {
        embed.addFields({ 
          name: '\u200b', 
          value: `... et ${player.queue.size - 10} autre(s) piste(s)` 
        });
      }
    } else {
      embed.addFields({ 
        name: 'À suivre', 
        value: 'Aucune piste en attente' 
      });
    }
    
    return interaction.reply({ embeds: [embed] });
  }
};
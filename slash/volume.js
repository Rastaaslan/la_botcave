const { SlashCommandBuilder: SlashCommandBuilder5 } = require('discord.js');
const { buildEmbed: buildEmbed5 } = require('../utils/embedHelper');
const { PlayerManager: PlayerManager5 } = require('../utils/playerManager');

module.exports = {
  data: new SlashCommandBuilder5()
    .setName('volume')
    .setDescription('Afficher ou régler le volume')
    .addIntegerOption(o =>
      o.setName('niveau').setDescription('0 à 200').setMinValue(0).setMaxValue(200).setRequired(false)
    ),
  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const voiceChannel = interaction.member?.voice?.channel;
    
    if (!voiceChannel) {
      return interaction.reply({ 
        ephemeral: true, 
        embeds: [buildEmbed5(gid, { 
          type: 'error', 
          title: 'Salon vocal requis', 
          description: 'Vous devez être dans un salon vocal.' 
        })]
      });
    }
    
    const player = PlayerManager5.getPlayerForUser(client, gid, voiceChannel.id);
    
    if (!player || !player.connected) {
      return interaction.reply({ 
        embeds: [buildEmbed5(gid, { 
          type: 'error', 
          title: 'Aucune musique', 
          description: `Aucune instance active dans **${voiceChannel.name}**.` 
        })], 
        ephemeral: true 
      });
    }
    
    const val = interaction.options.getInteger('niveau');
    
    if (val == null) {
      return interaction.reply({ 
        embeds: [buildEmbed5(gid, { 
          title: 'Volume actuel', 
          description: `🔊 ${player.volume}%\n\n🎵 Instance: **${player.metadata?.sessionName || 'Session'}** dans **${voiceChannel.name}**` 
        })]
      });
    }
    
    player.setVolume(val);
    PlayerManager5.updateActivity(player);
    
    return interaction.reply({ 
      embeds: [buildEmbed5(gid, { 
        type: 'success', 
        title: 'Volume réglé', 
        description: `Nouveau volume: ${val}%\n\n🎵 Instance: **${player.metadata?.sessionName || 'Session'}** dans **${voiceChannel.name}**` 
      })]
    });
  }
};
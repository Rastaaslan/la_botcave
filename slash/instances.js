const { SlashCommandBuilder: SCB2, EmbedBuilder: EB2 } = require('discord.js');
const { getTheme: GT2 } = require('../utils/themeStore');
const { PlayerManager: PM2 } = require('../utils/playerManager');

module.exports = {
  data: new SCB2()
    .setName('instances')
    .setDescription('Afficher toutes les instances musicales actives sur le serveur'),
    
  async execute(interaction, client) {
    const gid = interaction.guild.id;
    
    // Récupérer tous les players du serveur
    const guildPlayers = PM2.listGuildPlayers(client, gid);
    
    const theme = GT2(gid);
    const embed = new EB2()
      .setTitle('🎵 Instances musicales actives')
      .setColor(theme.color)
      .setTimestamp();
    
    if (guildPlayers.length === 0) {
      embed.setDescription('❌ Aucune instance musicale active sur ce serveur.');
      return interaction.reply({ embeds: [embed] });
    }
    
    // Construire la liste des instances
    const lines = guildPlayers.map((player, index) => {
      const voiceChannel = client.channels.cache.get(player.voiceChannel);
      const voiceChannelName = voiceChannel?.name || player.metadata?.voiceChannelName || 'Salon inconnu';
      
      // Statut du player
      let status = '⏹️';
      if (player.isPlaying) status = '▶️';
      else if (player.isPaused) status = '⏸️';
      
      // Informations de la piste en cours
      const currentTrack = player.currentTrack?.info?.title || 'Aucune piste';
      const queueSize = player.queue.size;
      
      // Métadonnées
      const sessionName = player.metadata?.sessionName || `Session ${index + 1}`;
      
      // Durée d'activité
      const createdAt = player.metadata?.createdAt || Date.now();
      const uptime = Math.floor((Date.now() - createdAt) / 1000 / 60); // minutes
      
      // Volume
      const volume = Math.round((player.filters?.volume || 1) * 100);
      
      return [
        `**${index + 1}. ${status} ${sessionName}**`,
        `📍 Salon: **${voiceChannelName}**`,
        `🎵 ${currentTrack}`,
        `📋 File: ${queueSize} piste(s)`,
        `⏱️ Actif depuis: ${uptime}min`,
        `🔊 Volume: ${volume}%`
      ].join('\n');
    });
    
    embed.setDescription(lines.join('\n\n'));
    embed.setFooter({ text: `Total: ${guildPlayers.length} instance(s) active(s)` });
    
    return interaction.reply({ embeds: [embed] });
  }
};
// slash/instances.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getTheme } = require('../utils/themeStore');
const { PlayerManager } = require('../utils/playerManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('instances')
    .setDescription('Afficher toutes les instances musicales actives sur le serveur'),
    
  async execute(interaction, client) {
    const gid = interaction.guild.id;
    
    // Récupérer tous les players du serveur
    const guildPlayers = PlayerManager.listGuildPlayers(client, gid);
    
    const theme = getTheme(gid);
    const embed = new EmbedBuilder()
      .setTitle('🎵 Instances musicales actives')
      .setColor(theme.color)
      .setTimestamp();
    
    if (guildPlayers.length === 0) {
      embed.setDescription('❌ Aucune instance musicale active sur ce serveur.');
      return interaction.reply({ embeds: [embed] });
    }
    
    // Construire la liste des instances
    const lines = guildPlayers.map((player, index) => {
      const voiceChannel = client.channels.cache.get(player.voiceChannelId);
      const voiceChannelName = voiceChannel?.name || 'Salon inconnu';
      
      // Statut du player
      let status = '⏹️';
      if (player.playing) status = '▶️';
      else if (player.paused) status = '⏸️';
      
      // Informations de la piste en cours
      const currentTrack = player.current?.title || 'Aucune piste';
      const queueSize = player.queue.size;
      
      // Métadonnées
      const sessionName = player.metadata?.sessionName || `Session ${index + 1}`;
      const createdBy = player.metadata?.createdBy;
      
      // Durée d'activité
      const createdAt = player.metadata?.createdAt || Date.now();
      const uptime = Math.floor((Date.now() - createdAt) / 1000 / 60); // minutes
      
      return [
        `**${index + 1}. ${status} ${sessionName}**`,
        `📍 Salon: **${voiceChannelName}**`,
        `🎵 ${currentTrack}`,
        `📋 File: ${queueSize} piste(s)`,
        `⏱️ Actif depuis: ${uptime}min`,
        `🔊 Volume: ${player.volume}%`
      ].join('\n');
    });
    
    embed.setDescription(lines.join('\n\n'));
    embed.setFooter({ text: `Total: ${guildPlayers.length} instance(s) active(s)` });
    
    return interaction.reply({ embeds: [embed] });
  }
};
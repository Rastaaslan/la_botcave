// slash/queue.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getTheme } = require('../utils/themeStore');

module.exports = {
  data: new SlashCommandBuilder().setName('queue').setDescription('Afficher la file d’attente'),
  async execute(interaction, client) {
    const gid = interaction.guild.id;
    const player = client.manager.players.get(gid);
    if (!player) return interaction.reply({ ephemeral: true, content: '❌ Rien ne joue actuellement !' });

    const theme = getTheme(gid);
    const embed = new EmbedBuilder().setTitle('🎵 File d’attente').setColor(theme.color);
    if (player.current) embed.setDescription(`**En lecture :**\n${player.current.title}`);
    if (player.queue.size > 0) {
      const tracks = player.queue.tracks.slice(0, 10).map((t, i) => `${i + 1}. ${t.title}`).join('\n');
      embed.addFields({ name: `À suivre (${player.queue.size} piste(s))`, value: tracks || 'Aucune piste' });
    }
    return interaction.reply({ embeds: [embed] });
  }
};

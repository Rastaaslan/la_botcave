// utils/embedHelper.js
const { EmbedBuilder } = require('discord.js');
const { getTheme } = require('../utils/themeStore');

function buildEmbed(guildId, { title, description, thumbnail, type = 'info', footer }) {
  const theme = getTheme(guildId);
  const color = (type === 'success' && theme.successColor)
    ? theme.successColor
    : (type === 'error' && theme.errorColor)
      ? theme.errorColor
      : theme.color;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title || '')
    .setDescription(description || '')
    .setTimestamp();

  if (theme.iconURL) embed.setAuthor({ name: theme.authorName || 'Player', iconURL: theme.iconURL });
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (footer) embed.setFooter({ text: footer });

  return embed;
}

module.exports = { buildEmbed };

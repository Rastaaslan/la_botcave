// utils/embedHelper.js
const { EmbedBuilder } = require('discord.js');
const { getTheme } = require('./themeStore');

function normalizeType(type) {
  const t = (type || 'info').toLowerCase();
  return ['info', 'success', 'warning', 'error'].includes(t) ? t : 'info';
}

function buildEmbed(guildId, { title, description, thumbnail, type = 'info', footer, url }) {
  const theme = getTheme(guildId);
  const t = normalizeType(type);
  const style = theme.types?.[t] || {};
  const color = style.color || theme.color || '#0099ff';
  const emoji = style.emoji || '';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${emoji ? `${emoji} ` : ''}${title || ''}`.trim())
    .setDescription(description || '')
    .setTimestamp();

  if (url) embed.setURL(url);
  if (theme.iconURL) embed.setAuthor({ name: theme.authorName || 'Player', iconURL: theme.iconURL });
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (footer) embed.setFooter({ text: footer });

  return embed;
}

module.exports = { buildEmbed };

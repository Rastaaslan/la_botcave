// commands/theme.js
const { buildEmbed } = require('../utils/embedHelper');
const { setTheme, getTheme } = require('../utils/themeStore');

module.exports = {
  name: 'theme',
  description: 'Configurer le thème des embeds',
  async execute(message, args) {
    const sub = (args[0] || '').toLowerCase();
    const guildId = message.guild.id;

    const canManage = message.member.permissions.has('ManageGuild');
    if (!canManage && ['set','reset'].includes(sub)) {
      return message.reply({ embeds: [buildEmbed(guildId, {
        type: 'error',
        title: 'Permissions insuffisantes',
        description: 'Permission Manage Server requise.'
      })]});
    }

    if (sub === 'set' && args[1] === 'color') {
      const hex = (args[2] || '').trim();
      if (!/^#?[0-9a-fA-F]{6}$/.test(hex)) {
        return message.reply({ embeds: [buildEmbed(guildId, {
          type: 'error',
          title: 'Couleur invalide',
          description: 'Utiliser un HEX comme #1abc9c.'
        })]});
      }
      const color = hex.startsWith('#') ? hex : `#${hex}`;
      setTheme(guildId, { color });
      return message.reply({ embeds: [buildEmbed(guildId, {
        type: 'success',
        title: 'Thème mis à jour',
        description: `Couleur définie sur ${color}.`
      })]});
    }

    if (sub === 'set' && args[1] === 'icon') {
      const iconURL = (args[2] || '').trim();
      try { new URL(iconURL); } catch { 
        return message.reply({ embeds: [buildEmbed(guildId, {
          type: 'error',
          title: 'URL invalide',
          description: 'Fournir une URL d’image accessible.'
        })]});
      }
      setTheme(guildId, { iconURL });
      return message.reply({ embeds: [buildEmbed(guildId, {
        type: 'success',
        title: 'Thème mis à jour',
        description: 'Icône d’embed modifiée.'
      })]});
    }

    if (sub === 'reset') {
      setTheme(guildId, { color: undefined, iconURL: '', successColor: undefined, errorColor: undefined });
      return message.reply({ embeds: [buildEmbed(guildId, {
        type: 'success',
        title: 'Thème réinitialisé',
        description: 'Valeurs par défaut restaurées.'
      })]});
    }

    const curr = getTheme(guildId);
    return message.reply({ embeds: [buildEmbed(guildId, {
      title: 'Thème actuel',
      description: `Couleur: ${curr.color}\nIcône: ${curr.iconURL || '—'}`
    })]});
  }
};

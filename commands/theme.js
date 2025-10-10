// commands/theme.js
const { PermissionsBitField } = require('discord.js');
const { buildEmbed } = require('../utils/embedHelper');
const { getTheme, setTheme, resetTheme, defaultTheme } = require('../utils/themeStore');

const TYPES = ['info', 'success', 'warning', 'error'];

function isHex6(v) { return /^#?[0-9a-fA-F]{6}$/.test(v || ''); }
function normHex(v) { return v.startsWith('#') ? v : `#${v}`; }
function isEmojiLike(v) {
  // unicode emoji or custom <:name:id> / <a:name:id>
  return /<a?:\w+:\d+>/.test(v) || /\p{Emoji}/u.test(v || '');
}

module.exports = {
  name: 'theme',
  description: 'Configurer le thème des embeds (couleurs et émojis par type)',
  async execute(message, args) {
    const guildId = message.guild.id;
    const sub = (args[0] || '').toLowerCase();

    const needManage = ['set', 'reset'].includes(sub);
    const hasPerm = message.member.permissions.has(PermissionsBitField.Flags.ManageGuild);
    if (needManage && !hasPerm) {
      return message.reply({ embeds: [buildEmbed(guildId, {
        type: 'error', title: 'Permissions insuffisantes', description: 'Permission Gérer le serveur requise.'
      })]});
    }

    // theme show [type]
    if (sub === 'show') {
      const typeArg = (args[1] || '').toLowerCase();
      const theme = getTheme(guildId);
      if (TYPES.includes(typeArg)) {
        const t = theme.types[typeArg];
        return message.reply({ embeds: [buildEmbed(guildId, {
          type: typeArg,
          title: `Thème: ${typeArg}`,
          description: `Couleur: ${t.color}\nEmoji: ${t.emoji || '—'}`
        })]});
      }
      const lines = TYPES.map(t => `• ${t}: ${theme.types[t].color} ${theme.types[t].emoji || ''}`).join('\n');
      return message.reply({ embeds: [buildEmbed(guildId, {
        title: 'Thème actuel',
        description: `Couleur par défaut: ${theme.color}\nIcône: ${theme.iconURL || '—'}\n\nTypes:\n${lines}`
      })]});
    }

    // theme set color <type> <#hex>
    if (sub === 'set' && args[1] === 'color') {
      const typeArg = (args[2] || '').toLowerCase();
      const hex = args[3];
      if (!TYPES.includes(typeArg)) {
        return message.reply({ embeds: [buildEmbed(guildId, {
          type: 'error', title: 'Type inconnu', description: `Types: ${TYPES.join(', ')}`
        })]});
      }
      if (!isHex6(hex)) {
        return message.reply({ embeds: [buildEmbed(guildId, {
          type: 'error', title: 'Couleur invalide', description: 'Utiliser un HEX comme #1abc9c.'
        })]});
      }
      setTheme(guildId, { types: { [typeArg]: { color: normHex(hex) } } });
      return message.reply({ embeds: [buildEmbed(guildId, {
        type: typeArg, title: 'Couleur mise à jour', description: `Nouveau ${typeArg}.color: ${normHex(hex)}`
      })]});
    }

    // theme set emoji <type> <emoji>
    if (sub === 'set' && args[1] === 'emoji') {
      const typeArg = (args[2] || '').toLowerCase();
      const emoji = args[3];
      if (!TYPES.includes(typeArg)) {
        return message.reply({ embeds: [buildEmbed(guildId, {
          type: 'error', title: 'Type inconnu', description: `Types: ${TYPES.join(', ')}`
        })]});
      }
      if (!emoji || !isEmojiLike(emoji)) {
        return message.reply({ embeds: [buildEmbed(guildId, {
          type: 'error', title: 'Emoji invalide', description: 'Fournir un emoji Unicode ou <:name:id>.'
        })]});
      }
      setTheme(guildId, { types: { [typeArg]: { emoji } } });
      return message.reply({ embeds: [buildEmbed(guildId, {
        type: typeArg, title: 'Emoji mis à jour', description: `Nouveau ${typeArg}.emoji: ${emoji}`
      })]});
    }

    // theme set default-color <#hex>
    if (sub === 'set' && args[1] === 'default-color') {
      const hex = args[2];
      if (!isHex6(hex)) {
        return message.reply({ embeds: [buildEmbed(guildId, {
          type: 'error', title: 'Couleur invalide', description: 'Utiliser un HEX comme #1abc9c.'
        })]});
      }
      setTheme(guildId, { color: normHex(hex) });
      return message.reply({ embeds: [buildEmbed(guildId, {
        type: 'success', title: 'Couleur par défaut', description: `Définie: ${normHex(hex)}`
      })]});
    }

    // theme set icon <url>
    if (sub === 'set' && args[1] === 'icon') {
      const iconURL = (args[2] || '').trim();
      try { new URL(iconURL); } catch {
        return message.reply({ embeds: [buildEmbed(guildId, {
          type: 'error', title: 'URL invalide', description: 'Fournir une URL d’image publique.'
        })]});
      }
      setTheme(guildId, { iconURL });
      return message.reply({ embeds: [buildEmbed(guildId, {
        type: 'success', title: 'Icône mise à jour', description: 'Icône d’embed modifiée.'
      })]});
    }

    // theme reset [type]
    if (sub === 'reset') {
      const typeArg = (args[1] || '').toLowerCase();
      if (typeArg && !TYPES.includes(typeArg)) {
        return message.reply({ embeds: [buildEmbed(guildId, {
          type: 'error', title: 'Type inconnu', description: `Types: ${TYPES.join(', ')}`
        })]});
      }
      const updated = resetTheme(guildId, typeArg || null);
      const msg = typeArg ? `Type ${typeArg} réinitialisé.` : 'Thème intégral réinitialisé.';
      return message.reply({ embeds: [buildEmbed(guildId, {
        type: typeArg || 'success', title: 'Réinitialisation', description: msg
      })]});
    }

    // help
    return message.reply({ embeds: [buildEmbed(guildId, {
      title: 'Theme help',
      description:
        'theme show [type]\n' +
        'theme set color <type> <#hex>\n' +
        'theme set emoji <type> <emoji>\n' +
        'theme set default-color <#hex>\n' +
        'theme set icon <url>\n' +
        'theme reset [type]'
    })]});
  },
};

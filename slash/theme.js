// slash/theme.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { buildEmbed } = require('../utils/embedHelper');
const { getTheme, setTheme, resetTheme } = require('../utils/themeStore');
const TYPES = ['info','success','warning','error'];

function isHex6(v){return /^#?[0-9a-fA-F]{6}$/.test(v||'')}
function normHex(v){return v.startsWith('#')?v:`#${v}`}
function isEmojiLike(v){ return /<a?:\w+:\d+>/.test(v)||/\p{Emoji}/u.test(v||'') }

module.exports = {
  data: new SlashCommandBuilder()
    .setName('theme')
    .setDescription('Configurer le thème des embeds')
    // Limite l’utilisation aux admins au niveau permissions par défaut
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sc =>
      sc.setName('show').setDescription('Afficher le thème')
        .addStringOption(o => o.setName('type').setDescription('Type').addChoices(
          ...TYPES.map(t => ({ name: t, value: t }))
        ))
    )
    .addSubcommand(sc =>
      sc.setName('set-color').setDescription('Définir une couleur par type')
        .addStringOption(o => o.setName('type').setDescription('Type').setRequired(true).addChoices(...TYPES.map(t => ({ name:t, value:t }))))
        .addStringOption(o => o.setName('hex').setDescription('#RRGGBB').setRequired(true))
    )
    .addSubcommand(sc =>
      sc.setName('set-emoji').setDescription('Définir un emoji par type')
        .addStringOption(o => o.setName('type').setDescription('Type').setRequired(true).addChoices(...TYPES.map(t => ({ name:t, value:t }))))
        .addStringOption(o => o.setName('emoji').setDescription('Emoji unicode ou <:name:id>').setRequired(true))
    )
    .addSubcommand(sc =>
      sc.setName('set-default-color').setDescription('Définir la couleur par défaut')
        .addStringOption(o => o.setName('hex').setDescription('#RRGGBB').setRequired(true))
    )
    .addSubcommand(sc =>
      sc.setName('set-icon').setDescription('Définir l’icône d’auteur')
        .addStringOption(o => o.setName('url').setDescription('URL de l’image').setRequired(true))
    )
    .addSubcommand(sc =>
      sc.setName('reset').setDescription('Réinitialiser le thème ou un type')
        .addStringOption(o => o.setName('type').setDescription('Type à réinitialiser').addChoices(...TYPES.map(t => ({ name:t, value:t }))))
    ),
  async execute(interaction) {
    const gid = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    // Vérification stricte côté runtime
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, {
        type: 'error',
        title: 'Permissions insuffisantes',
        description: 'Seuls les administrateurs peuvent utiliser /theme.'
      })]});
    }

    if (sub === 'show') {
      const type = interaction.options.getString('type');
      const theme = getTheme(gid);
      if (type) {
        const t = theme.types[type];
        return interaction.reply({ embeds: [buildEmbed(gid, {
          type, title: `Thème: ${type}`, description: `Couleur: ${t.color}\nEmoji: ${t.emoji || '—'}`
        })]});
      }
      const lines = Object.entries(theme.types).map(([k,v]) => `• ${k}: ${v.color} ${v.emoji || ''}`).join('\n');
      return interaction.reply({ embeds: [buildEmbed(gid, {
        title: 'Thème actuel',
        description: `Couleur par défaut: ${theme.color}\nIcône: ${theme.iconURL || '—'}\n\nTypes:\n${lines}`
      })]});
    }

    if (sub === 'set-color') {
      const type = interaction.options.getString('type', true);
      const hex = interaction.options.getString('hex', true);
      if (!isHex6(hex)) return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, { type: 'error', title: 'Couleur invalide', description: 'Utiliser #RRGGBB.' })]});
      setTheme(gid, { types: { [type]: { color: normHex(hex) } } });
      return interaction.reply({ embeds: [buildEmbed(gid, { type, title: 'Couleur mise à jour', description: `${type}.color = ${normHex(hex)}` })]});
    }

    if (sub === 'set-emoji') {
      const type = interaction.options.getString('type', true);
      const emoji = interaction.options.getString('emoji', true);
      if (!isEmojiLike(emoji)) return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, { type: 'error', title: 'Emoji invalide', description: 'Emoji unicode ou <:name:id>.' })]});
      setTheme(gid, { types: { [type]: { emoji } } });
      return interaction.reply({ embeds: [buildEmbed(gid, { type, title: 'Emoji mis à jour', description: `${type}.emoji = ${emoji}` })]});
    }

    if (sub === 'set-default-color') {
      const hex = interaction.options.getString('hex', true);
      if (!isHex6(hex)) return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, { type: 'error', title: 'Couleur invalide', description: 'Utiliser #RRGGBB.' })]});
      setTheme(gid, { color: normHex(hex) });
      return interaction.reply({ embeds: [buildEmbed(gid, { type: 'success', title: 'Couleur par défaut', description: `Définie: ${normHex(hex)}` })]});
    }

    if (sub === 'set-icon') {
      const url = interaction.options.getString('url', true);
      try { new URL(url); } catch { return interaction.reply({ ephemeral: true, embeds: [buildEmbed(gid, { type: 'error', title: 'URL invalide', description: 'Fournir une URL image publique.' })]}); }
      setTheme(gid, { iconURL: url });
      return interaction.reply({ embeds: [buildEmbed(gid, { type: 'success', title: 'Icône mise à jour', description: 'Icône d’embed modifiée.' })]});
    }

    if (sub === 'reset') {
      const type = interaction.options.getString('type');
      resetTheme(gid, type || null);
      const msg = type ? `Type ${type} réinitialisé.` : 'Thème intégral réinitialisé.';
      return interaction.reply({ embeds: [buildEmbed(gid, { type: type || 'success', title: 'Réinitialisation', description: msg })]});
    }
  }
};

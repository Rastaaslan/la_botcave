// index.js - VERSION PORU
require('dotenv').config();

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { Poru } = require('poru');
const fs = require('fs');
const path = require('path');
const { buildEmbed } = require('./utils/embedHelper');
const { PlayerManager } = require('./utils/playerManager');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// Espace pour les slash commands
client.slashCommands = new Collection();

// Chargement des slash commands
const slashPath = path.join(__dirname, 'slash');
if (fs.existsSync(slashPath)) {
  const files = fs.readdirSync(slashPath).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    const cmd = require(path.join(slashPath, file));
    if (cmd?.data && cmd?.execute) {
      client.slashCommands.set(cmd.data.name, cmd);
    }
  }
}

// Chargement des événements
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
  const eventFiles = fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'));
  for (const file of eventFiles) {
    const evt = require(path.join(eventsPath, file));
    if (!evt?.name || typeof evt.execute !== 'function') continue;
    if (evt.once) client.once(evt.name, (...args) => evt.execute(...args, client));
    else client.on(evt.name, (...args) => evt.execute(...args, client));
  }
}

// ✨ PORU MANAGER
client.poru = new Poru(client, [{
  name: 'main',
  host: process.env.LAVALINK_HOST || 'localhost',
  port: parseInt(process.env.LAVALINK_PORT || '2333', 10),
  password: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
  secure: process.env.LAVALINK_SECURE === 'true'
}], {
  library: 'discord.js',
  defaultPlatform: 'scsearch'  // SoundCloud par défaut
});

// Logs node
client.poru.on('nodeConnect', (node) => {
  console.log(`✅ Node ${node.name} connecté`);
});

client.poru.on('nodeError', (node, error) => {
  console.error(`❌ Erreur node ${node.name}:`, error);
});

client.poru.on('nodeDisconnect', (node) => {
  console.warn(`⚠️ Node ${node.name} déconnecté`);
});

// Événements musique avec multi-instance
client.poru.on('trackStart', (player, track) => {
  const channel = client.channels.cache.get(player.textChannel);
  if (!channel) return;
  
  const guildId = PlayerManager.extractGuildId(player);
  if (!guildId) return;
  
  channel.send({
    embeds: [
      buildEmbed(guildId, {
        title: 'Lecture',
        description: `🎵 ${track.info.title}\n\n💿 Instance: **${player.metadata?.sessionName || 'Session'}**`,
        url: track.info.uri || null,
        thumbnail: track.info.image || null,
      }),
    ],
  });
  
  PlayerManager.updateActivity(player);
});

client.poru.on('trackEnd', (player, track) => {
  PlayerManager.updateActivity(player);
});

client.poru.on('trackError', (player, track, error) => {
  console.error(`❌ Erreur lecture: ${track?.info?.title}`, error);
  
  const channel = client.channels.cache.get(player.textChannel);
  const guildId = PlayerManager.extractGuildId(player);
  
  if (channel && guildId) {
    channel.send({
      embeds: [
        buildEmbed(guildId, {
          type: 'error',
          title: 'Erreur de lecture',
          description: `Impossible de lire ${track?.info?.title || 'la piste'}.\n\n💿 Instance: **${player.metadata?.sessionName || 'Session'}**`,
        }),
      ],
    });
  }
});

client.poru.on('queueEnd', (player) => {
  const channel = client.channels.cache.get(player.textChannel);
  if (!channel) return;
  
  const guildId = PlayerManager.extractGuildId(player);
  if (!guildId) return;
  
  channel.send({
    embeds: [
      buildEmbed(guildId, {
        title: 'File terminée',
        description: `Plus de pistes dans la file.\n\n💿 Instance: **${player.metadata?.sessionName || 'Session'}**`,
      }),
    ],
  });
});

client.poru.on('playerDisconnect', (player) => {
  console.log(`🔌 Player ${player.guildId} déconnecté`);
});

// Event ready
client.on('ready', () => {
  console.log(`✅ Connecté: ${client.user.tag}`);
  client.poru.init(client);
  console.log('✅ Poru initialisé avec support multi-instance');
});

// Nettoyage périodique
setInterval(() => {
  const cleaned = PlayerManager.cleanupInactivePlayers(client, 5 * 60 * 1000);
  if (cleaned > 0) {
    console.log(`🧹 ${cleaned} player(s) inactif(s) nettoyé(s)`);
  }
}, 60000);

// Connexion
client.login(process.env.DISCORD_TOKEN);
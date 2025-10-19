// index.js - VERSION SMART MODE
require('dotenv').config();

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { Manager } = require('moonlink.js');
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

// Chargement des slash commands (./slash/*.js exportant { data, execute })
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

// Chargement des événements (./events/*.js exportant { name, execute, once? })
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

// Moonlink Manager
client.manager = new Manager({
  nodes: [
    {
      host: process.env.LAVALINK_HOST || 'localhost',
      port: parseInt(process.env.LAVALINK_PORT || '2333', 10),
      password: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
      secure: process.env.LAVALINK_SECURE === 'true',
    },
  ],
  sendPayload: (guildId, payload) => {
    // Le guildId ici est déjà le vrai guildId Discord (pas le composite)
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    try {
      const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
      guild.shard.send(data);
    } catch (e) {
      console.error('sendPayload JSON parse error:', e);
    }
  },
  autoPlay: true,
});

// Logs node
client.manager.on('nodeConnect', (node) => {
  console.log(`✅ Node ${node.host} connecté`);
});

client.manager.on('nodeError', (node, error) => {
  console.error(`❌ Erreur sur le node ${node.host}:`, error);
});

// Événements musique → embeds avec support multi-instance
client.manager.on('trackStart', (player, track) => {
  const ch = client.channels.cache.get(player.textChannelId);
  if (!ch) return;
  
  // Extraire le vrai guildId
  const realGuildId = PlayerManager.extractGuildId(player.guildId);
  if (!realGuildId) return;
  
  ch.send({
    embeds: [
      buildEmbed(realGuildId, {
        title: 'Lecture',
        description: `🎵 ${track.title}\n\n🎵 Instance: **${player.metadata?.sessionName || 'Session'}**`,
        url: track.uri || null,
        thumbnail: track.artworkUrl || null,
      }),
    ],
  });
  
  // Mettre à jour l'activité
  PlayerManager.updateActivity(player);
});

client.manager.on('trackError', (player, track) => {
  const ch = client.channels.cache.get(player.textChannelId);
  const realGuildId = PlayerManager.extractGuildId(player.guildId);
  
  if (ch && realGuildId) {
    ch.send({
      embeds: [
        buildEmbed(realGuildId, {
          type: 'error',
          title: 'Erreur de lecture',
          description: `Impossible de lire ${track?.title || 'la piste'}.\n\n🎵 Instance: **${player.metadata?.sessionName || 'Session'}**`,
        }),
      ],
    });
  }
  
  if (player.queue.size > 0) player.play();
});

client.manager.on('queueEnd', (player) => {
  const ch = client.channels.cache.get(player.textChannelId);
  if (!ch) return;
  
  const realGuildId = PlayerManager.extractGuildId(player.guildId);
  if (!realGuildId) return;
  
  ch.send({
    embeds: [
      buildEmbed(realGuildId, {
        title: 'File terminée',
        description: `Plus de pistes dans la file.\n\n🎵 Instance: **${player.metadata?.sessionName || 'Session'}**`,
      }),
    ],
  });
});

// Événement de déconnexion du player
client.manager.on('playerDisconnect', (player) => {
  console.log(`🔌 Player ${player.guildId} déconnecté`);
});

// Pont voix Discord → Moonlink
client.on('raw', (data) => client.manager?.packetUpdate(data));

// Nettoyage périodique des players inactifs
setInterval(() => {
  const cleaned = PlayerManager.cleanupInactivePlayers(client, 5 * 60 * 1000); // 5 minutes d'inactivité
  if (cleaned > 0) {
    console.log(`🧹 Nettoyage: ${cleaned} player(s) inactif(s) supprimé(s)`);
  }
}, 60000); // Vérification toutes les minutes

// Connexion
client.login(process.env.DISCORD_TOKEN);
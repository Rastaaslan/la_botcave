// index.js
require('dotenv').config();

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { Manager } = require('moonlink.js');
const fs = require('fs');
const path = require('path');
const { buildEmbed } = require('./utils/embedHelper');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.commands = new Collection();

// Chargement des commandes
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));
  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command?.name) client.commands.set(command.name, command);
  }
}

// Chargement des événements (ready, messageCreate, etc.)
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
  const eventFiles = fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'));
  for (const file of eventFiles) {
    const evt = require(path.join(eventsPath, file));
    if (!evt?.name || typeof evt.execute !== 'function') continue;
    if (evt.once) {
      client.once(evt.name, (...args) => evt.execute(...args, client));
    } else {
      client.on(evt.name, (...args) => evt.execute(...args, client));
    }
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
    const guild = client.guilds.cache.get(guildId);
    if (guild) guild.shard.send(payload);
  },
  autoPlay: true,
});

// Logs de node
client.manager.on('nodeConnect', (node) => {
  console.log(`✅ Node ${node.host} connecté`);
});

client.manager.on('nodeError', (node, error) => {
  console.error(`❌ Erreur sur le node ${node.host}:`, error);
});

// Événements de lecture avec embeds
client.manager.on('trackStart', (player, track) => {
  const ch = client.channels.cache.get(player.textChannelId);
  if (!ch) return;
  ch.send({
    embeds: [
      buildEmbed(player.guildId, {
        title: 'Lecture',
        description: `🎵 ${track.title}`,
        url: track.uri || null,
        thumbnail: track.artworkUrl || null,
      }),
    ],
  });
});

client.manager.on('trackError', (player, track) => {
  const ch = client.channels.cache.get(player.textChannelId);
  if (ch) {
    ch.send({
      embeds: [
        buildEmbed(player.guildId, {
          type: 'error',
          title: 'Erreur de lecture',
          description: `Impossible de lire ${track?.title || 'la piste'}.`,
        }),
      ],
    });
  }
  if (player.queue.size > 0) player.play();
});

client.manager.on('queueEnd', (player) => {
  const ch = client.channels.cache.get(player.textChannelId);
  if (!ch) return;
  ch.send({
    embeds: [
      buildEmbed(player.guildId, {
        title: 'File terminée',
        description: 'Plus de pistes dans la file.',
      }),
    ],
  });
});

// Pont d’événements bas-niveau
client.on('raw', (data) => {
  client.manager?.packetUpdate(data);
});

// Connexion
client.login(process.env.DISCORD_TOKEN);

require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { Manager } = require('moonlink.js');
const fs = require('fs');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

client.commands = new Collection();

const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.name, command);
}

client.manager = new Manager({
    nodes: [{
        host: process.env.LAVALINK_HOST || 'localhost',
        port: parseInt(process.env.LAVALINK_PORT) || 2333,
        password: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
        secure: process.env.LAVALINK_SECURE === 'true',
    }],
    sendPayload: (guildId, payload) => {
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
            guild.shard.send(JSON.parse(payload));
        }
    },
    autoPlay: true,
});

client.on('ready', () => {
    console.log(`Connecté en tant que ${client.user.tag}`);
    client.manager.init(client.user.id);
    console.log('Moonlink Manager initialisé');
});

client.manager.on('nodeConnect', (node) => {
    console.log(`✅ Node ${node.host} connecté`);
});

client.manager.on('nodeError', (node, error) => {
    console.error(`❌ Erreur sur le node ${node.host}:`, error);
});

client.manager.on('trackEnd', (player, track, payload) => {
    console.log(`Track terminé: ${track.title}`);
    
    if (payload.reason === 'loadFailed') {
        const channel = client.channels.cache.get(player.textChannelId);
        
        if (player.queue.size > 0) {
            console.log(`Essai de la vidéo suivante...`);
            if (channel) {
                channel.send(`⏭️ Vidéo bloquée, essai de la suivante...`);
            }
            player.play();
        } else {
            if (channel) {
                channel.send(`❌ Aucune vidéo disponible.`);
            }
        }
    }
});

client.manager.on('trackStart', (player, track) => {
    console.log(`🎵 Lecture : ${track.title}`);
    const channel = client.channels.cache.get(player.textChannelId);
    if (channel) {
        channel.send(`🎵 **${track.title}**`);
    }
});

client.manager.on('trackError', (player, track, payload) => {
    console.error(`❌ Erreur lecture: ${track.title}`);
    const channel = client.channels.cache.get(player.textChannelId);
    if (channel) {
        channel.send(`❌ Impossible de lire **${track.title}**.`);
    }
    
    if (player.queue.size > 0) {
        player.play();
    }
});

client.manager.on('queueEnd', (player) => {
    console.log('Queue terminée');
    const channel = client.channels.cache.get(player.textChannelId);
    if (channel) {
        channel.send('✅ File d\'attente terminée !');
    }
});

client.on('raw', (data) => {
    if (client.manager) {
        client.manager.packetUpdate(data);
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command = client.commands.get(commandName);
    if (!command) return;

    try {
        await command.execute(message, args, client);
    } catch (error) {
        console.error('Erreur commande:', error);
        message.reply('❌ Une erreur est survenue.');
    }
});

client.login(process.env.DISCORD_TOKEN);

require('dotenv').config();
const axios = require('axios');

// ✅ Variables d'environnement
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
let spotifyToken = null;
let spotifyTokenExpiry = 0;

async function getSpotifyToken() {
    if (spotifyToken && Date.now() < spotifyTokenExpiry) {
        return spotifyToken;
    }

    try {
        const response = await axios.post('https://accounts.spotify.com/api/token',
            'grant_type=client_credentials',
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
                }
            }
        );

        spotifyToken = response.data.access_token;
        spotifyTokenExpiry = Date.now() + (response.data.expires_in * 1000);
        return spotifyToken;
    } catch (error) {
        console.error('Erreur token Spotify:', error);
        throw error;
    }
}

async function getSpotifyTrack(trackId) {
    try {
        const token = await getSpotifyToken();
        const response = await axios.get(`https://api.spotify.com/v1/tracks/${trackId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        return response.data;
    } catch (error) {
        console.error('Erreur track Spotify:', error);
        throw error;
    }
}

function isValidVideo(title, artistName, trackName) {
    const titleLower = title.toLowerCase();
    const artistLower = artistName.toLowerCase();
    const trackLower = trackName.toLowerCase();

    const invalidKeywords = [
        'cover', 'karaoke', 'instrumental', 'piano', 'acoustic',
        'guitar', 'tutorial', 'lesson', 'reaction', 'review',
        'parody', 'minecraft', 'fortnite', 'roblox', 'nightcore'
    ];

    for (const keyword of invalidKeywords) {
        if (titleLower.includes(keyword) && 
            !titleLower.includes('official') && 
            !titleLower.includes(trackLower)) {
            return false;
        }
    }

    const hasArtist = titleLower.includes(artistLower) || 
                      titleLower.includes(artistLower.split(' ')[0]);
    const hasTrack = titleLower.includes(trackLower);

    return hasArtist || hasTrack;
}

module.exports = {
    name: 'play',
    description: 'Joue une musique',
    
    async execute(message, args, client) {
        try {
            const query = args.join(' ');
            
            if (!query) {
                return message.reply('❌ Utilisation: `!play <URL ou recherche>`');
            }

            console.log('Query originale:', query);

            const voiceChannel = message.member.voice.channel;
            if (!voiceChannel) {
                return message.reply('❌ Tu dois être dans un salon vocal !');
            }

            const permissions = voiceChannel.permissionsFor(message.client.user);
            if (!permissions.has('Connect') || !permissions.has('Speak')) {
                return message.reply('❌ Je n\'ai pas les permissions !');
            }

            let player = client.manager.players.get(message.guild.id);

            if (!player) {
                player = client.manager.createPlayer({
                    guildId: message.guild.id,
                    voiceChannelId: voiceChannel.id,
                    textChannelId: message.channel.id,
                    autoPlay: true,
                    volume: 100
                });
                
                console.log('Player créé pour guild:', message.guild.id);
                
                if (!player) {
                    console.error('❌ createPlayer a retourné undefined');
                    return message.reply('❌ Erreur de création du player');
                }
                
                try {
                    await player.connect({ setDeaf: true, setMute: false });
                    console.log('✅ Connecté au salon vocal');
                    
                    // Attends que la connexion soit stable
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (error) {
                    console.error('❌ Erreur de connexion:', error);
                    return message.reply('❌ Impossible de se connecter au salon vocal');
                }
            }


            let searchQuery = query;
            let spotifyInfo = null;

            const spotifyTrackMatch = query.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
            if (spotifyTrackMatch) {
                console.log('Lien Spotify détecté');
                const trackId = spotifyTrackMatch[1];

                try {
                    const trackData = await getSpotifyTrack(trackId);
                    const artistName = trackData.artists[0].name;
                    const trackName = trackData.name;
                    const isrc = trackData.external_ids?.isrc;

                    spotifyInfo = { artistName, trackName, isrc };
                    
                    console.log(`🎵 Spotify: "${trackName}" - "${artistName}"`);
                    if (isrc) {
                        console.log(`🔑 ISRC: ${isrc}`);
                    }

                    searchQuery = `${artistName} ${trackName}`;
                    console.log(`🔍 Recherche:`, searchQuery);
                    
                } catch (error) {
                    console.error('Erreur Spotify:', error);
                    return message.reply('❌ Erreur Spotify');
                }
            }

            const res = await client.manager.search({
                query: searchQuery,
                source: 'soundcloud',
                requester: message.author
            });

            console.log('Recherche SoundCloud, loadType:', res.loadType);
            console.log('Nombre de tracks:', res.tracks?.length || 0);

            if (!res || !res.tracks || res.tracks.length === 0 || res.loadType === 'empty') {
                return message.reply('❌ Aucun résultat sur SoundCloud');
            }

            if (res.loadType === 'error') {
                console.error('Erreur de recherche:', res.error);
                return message.reply(`❌ Erreur: ${res.error}`);
            }

            const wasPlaying = player.playing;

            if (spotifyInfo) {
                const { artistName, trackName } = spotifyInfo;

                console.log(`\nTrouvé ${res.tracks.length} résultats`);

                const validTracks = [];
                for (let i = 0; i < Math.min(res.tracks.length, 5); i++) {
                    const track = res.tracks[i];
                    const isValid = isValidVideo(track.title, artistName, trackName);

                    console.log(`${i + 1}. ${track.title}`);
                    console.log(`   → ${isValid ? '✓ VALIDE' : '✗ REJETÉ'}`);

                    if (isValid) {
                        validTracks.push(track);
                    }
                }

                if (validTracks.length === 0) {
                    return message.reply('❌ Aucune vidéo valide');
                }

                console.log(`\n✓ ${validTracks.length} track(s) valide(s)`);

                for (const track of validTracks) {
                    player.queue.add(track);
                }

                if (!wasPlaying) {
                    console.log('🎬 Démarrage de la lecture...');
                    player.play();
                }
                
                return message.reply(`✅ ${validTracks.length} track(s) SoundCloud ajouté(s)`);

            } else {
                const track = res.tracks[0];
                player.queue.add(track);

                console.log(`📝 Track ajouté: ${track.title}`);
                console.log(`📊 Queue size: ${player.queue.size}`);
                console.log(`🔊 Player playing: ${player.playing}`);

                if (!wasPlaying) {
                    console.log('🎬 Démarrage de la lecture...');
                    player.play();
                }
                
                return message.reply(`✅ Ajouté (SoundCloud): **${track.title}**`);
            }

        } catch (error) {
            console.error('Erreur play:', error);
            console.error('Stack:', error.stack);
            return message.reply('❌ Erreur lecture');
        }
    }
};

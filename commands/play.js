// commands/play.js
require('dotenv').config();
const axios = require('axios');
const { PermissionsBitField } = require('discord.js');
const { buildEmbed } = require('../utils/embedHelper');

// Variables d'environnement Spotify
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

let spotifyToken = null;
let spotifyTokenExpiry = 0;

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < spotifyTokenExpiry) return spotifyToken;

  const body = 'grant_type=client_credentials';
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Authorization':
      'Basic ' +
      Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
  };

  const response = await axios.post('https://accounts.spotify.com/api/token', body, { headers });
  spotifyToken = response.data.access_token;
  spotifyTokenExpiry = Date.now() + response.data.expires_in * 1000;
  return spotifyToken;
}

async function getSpotifyTrack(trackId) {
  const token = await getSpotifyToken();
  const response = await axios.get(`https://api.spotify.com/v1/tracks/${trackId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data;
}

// Filtre simple pour éviter des vidéos non officielles
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

  const hasArtist =
    titleLower.includes(artistLower) ||
    titleLower.includes(artistLower.split(' ')[0]);
  const hasTrack = titleLower.includes(trackLower);

  return hasArtist || hasTrack;
}

module.exports = {
  name: 'play',
  description: 'Joue une musique',
  async execute(message, args, client) {
    const guildId = message.guild.id;

    try {
      const query = args.join(' ').trim();
      if (!query) {
        return message.reply({
          embeds: [
            buildEmbed(guildId, {
              type: 'error',
              title: 'Utilisation',
              description: 'Utiliser: !play <recherche | url Spotify | url SoundCloud>',
            }),
          ],
        });
      }

      // Vérifier le salon vocal et permissions
      const voiceChannel = message.member.voice.channel;
      if (!voiceChannel) {
        return message.reply({
          embeds: [
            buildEmbed(guildId, {
              type: 'error',
              title: 'Salon vocal requis',
              description: 'Se connecter à un salon vocal pour lancer la lecture.',
            }),
          ],
        });
      }

      const perms = voiceChannel.permissionsFor(message.client.user);
      if (
        !perms?.has(PermissionsBitField.Flags.Connect) ||
        !perms?.has(PermissionsBitField.Flags.Speak)
      ) {
        return message.reply({
          embeds: [
            buildEmbed(guildId, {
              type: 'error',
              title: 'Permissions manquantes',
              description: 'Il faut les permissions Connect et Speak dans ce salon.',
            }),
          ],
        });
      }

      // Récupérer/créer le player
      let player = client.manager.players.get(guildId);
        if (!player) {
            player = client.manager.createPlayer({
                guildId: guildId,
                voiceChannelId: voiceChannel.id,
                textChannelId: message.channel.id,
                autoPlay: true,
                volume: 35,
            });

            if (!player) {
                return message.reply({
                embeds: [
                    buildEmbed(guildId, {
                    type: 'error',
                    title: 'Erreur lecteur',
                    description: 'Impossible de créer le player.',
                    }),
                ],
                });
            }
        }

            // Connexion vocale si non connectée
        try {
            if (!player.connected) {
                await player.connect(); // pas d’options, conforme aux exemples Moonlink
                await new Promise((r) => setTimeout(r, 500)); // stabilisation
            }
        } catch (e) {
            console.error('Connexion vocal échouée:', e);
            return message.reply({
                embeds: [
                buildEmbed(guildId, {
                    type: 'error',
                    title: 'Connexion impossible',
                    description: 'Impossible de se connecter au salon vocal.',
                }),
                ],
            });
        }

      // Préparer la requête de recherche
      let searchQuery = query;
      let spotifyInfo = null;

      // Lien piste Spotify
      const spotifyTrackMatch = query.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
      if (spotifyTrackMatch) {
        const trackId = spotifyTrackMatch[1];
        try {
          const trackData = await getSpotifyTrack(trackId);
          const artistName = trackData.artists?.[0]?.name || '';
          const trackName = trackData.name || '';
          const isrc = trackData.external_ids?.isrc || null;

          spotifyInfo = { artistName, trackName, isrc };
          searchQuery = `${artistName} ${trackName}`.trim();
        } catch (e) {
          console.error('Erreur Spotify:', e);
          return message.reply({
            embeds: [
              buildEmbed(guildId, {
                type: 'error',
                title: 'Spotify',
                description: 'Erreur lors de la récupération de la piste.',
              }),
            ],
          });
        }
      }

      // Recherche (SoundCloud dans votre implémentation actuelle)
      const res = await client.manager.search({
        query: searchQuery,
        source: 'soundcloud',
        requester: message.author,
      });

      if (
        !res ||
        !res.tracks ||
        res.tracks.length === 0 ||
        res.loadType === 'empty'
      ) {
        return message.reply({
          embeds: [
            buildEmbed(guildId, {
              type: 'error',
              title: 'Aucun résultat',
              description: 'Aucun résultat trouvé pour cette recherche.',
            }),
          ],
        });
      }

      if (res.loadType === 'error') {
        const errMsg = res.error?.message || 'Erreur de recherche.';
        return message.reply({
          embeds: [
            buildEmbed(guildId, {
              type: 'error',
              title: 'Erreur de recherche',
              description: errMsg,
            }),
          ],
        });
      }

      const wasPlaying = player.playing;

      // Si lien Spotify → filtrer les meilleurs résultats
      if (spotifyInfo) {
        const { artistName, trackName } = spotifyInfo;
        const top = res.tracks.slice(0, 5);
        const validTracks = top.filter((t) =>
          isValidVideo(t.title, artistName, trackName)
        );

        if (validTracks.length === 0) {
          return message.reply({
            embeds: [
              buildEmbed(guildId, {
                type: 'error',
                title: 'Non trouvé',
                description: 'Aucune vidéo valable correspondant au titre/artiste.',
              }),
            ],
          });
        }

        for (const t of validTracks) player.queue.add(t);
        if (!wasPlaying) player.play();

        return message.reply({
          embeds: [
            buildEmbed(guildId, {
              type: 'success',
              title: 'Ajouté à la file',
              description: `${validTracks.length} piste(s) ajoutée(s) depuis SoundCloud.`,
            }),
          ],
        });
      }

      // Cas standard: ajouter la première piste
      const track = res.tracks[0];
      player.queue.add(track);
      if (!wasPlaying) player.play();

      return message.reply({
        embeds: [
          buildEmbed(guildId, {
            type: 'success',
            title: 'Ajouté (SoundCloud)',
            description: track.title || 'Piste',
            url: track.uri || null,
          }),
        ],
      });
    } catch (error) {
      console.error('Erreur play:', error);
      return message.reply({
        embeds: [
          buildEmbed(message.guild.id, {
            type: 'error',
            title: 'Erreur',
            description: 'Une erreur est survenue pendant la lecture.',
          }),
        ],
      });
    }
  },
};

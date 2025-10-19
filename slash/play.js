// slash/play.js - VERSION PORU MULTI-INSTANCE
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { buildEmbed } = require('../utils/embedHelper');
const { PlayerManager } = require('../utils/playerManager');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const LOG_PREFIX = '[PLAY]';

// Regex patterns (inchangé)
const PATTERNS = {
  SC_PLAYLIST: /soundcloud\.com\/[^/]+\/sets\/[^/?]+/i,
  SC_TRACK: /soundcloud\.com\/[^/]+\/[^/?]+/i,
  YT_PLAYLIST: /(?:youtube\.com\/(?:watch\?.*?list=|playlist\?list=)|youtu\.be\/.*?\?list=)([a-zA-Z0-9_-]+)/i,
  YT_VIDEO: /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/i,
  YT_RADIO: /[?&]start_radio=1/i,
  YT_MIX: /[?&]list=RD/i,
  SP_PLAYLIST: /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?playlist\/([a-zA-Z0-9]+)/i,
  SP_ALBUM: /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?album\/([a-zA-Z0-9]+)/i,
  SP_TRACK: /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([a-zA-Z0-9]+)/i,
  AM_TRACK: /music\.apple\.com\/[a-z]{2}\/album\/[^/]+\/\d+\?i=\d+/i
};

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';

let spotifyAccessToken = null;
let tokenExpiry = 0;

// Logging helpers (inchangé)
const logInfo = (id, tag, payload = '') => {
  console.log(`${LOG_PREFIX} [${id}] ${tag}`, typeof payload === 'object' ? JSON.stringify(payload) : payload);
};

const logWarn = (id, tag, payload = '') => {
  console.warn(`${LOG_PREFIX} [${id}] ⚠️  ${tag}`, typeof payload === 'object' ? JSON.stringify(payload) : payload);
};

const logError = (id, tag, payload = '') => {
  console.error(`${LOG_PREFIX} [${id}] ❌ ${tag}`, typeof payload === 'object' ? JSON.stringify(payload) : payload);
};

// Fonctions utilitaires (inchangées - normalize, stripTitleNoise, etc.)
function normalize(s) {
  if (!s) return '';
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripTitleNoise(title) {
  if (!title) return '';
  let t = title;
  t = t.replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '');
  t = t.replace(/\b(?:official|audio|video|music|lyric|lyrics|visuali?zer?|mv|hd|hq|4k|remaster(?:ed)?|explicit|clean|radio|edit|extended|version|ft\.?|feat(?:uring)?\.?)\b/ig, '');
  t = t.replace(/\bf[*u]ck(?:ed|ing)?\b/ig, '');
  t = t.replace(/[_\-—–·]+/g, ' ');
  t = t.split('|')[0];
  return t.trim();
}

function stripArtistNoise(artist) {
  if (!artist) return '';
  return artist.replace(/-\s*topic$/i, '').trim();
}

function tokenSet(s) {
  return new Set(normalize(s).split(/\s+/).filter(Boolean));
}

function coreTokens(s) {
  return [...tokenSet(s)].filter(w => w.length >= 2);
}

function jaccard(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  const inter = [...A].filter(x => B.has(x)).length;
  const union = A.size + B.size - inter;
  return union > 0 ? inter / union : 0;
}

function isYouTubeUri(uri) {
  return typeof uri === 'string' && /youtu\.be|youtube\.com/i.test(uri);
}

// SoundCloud search avec Poru
async function scSearch(client, requester, q, limit, reqId) {
  try {
    logInfo(reqId, 'scSearch', { query: q, limit });
    const res = await client.poru.resolve({ 
      query: `scsearch:${q}`, 
      source: 'soundcloud',
      requester 
    });
    const tracks = (res?.tracks || [])
      .slice(0, limit)
      .filter(t => t && !isYouTubeUri(t.info.uri));
    logInfo(reqId, 'scSearch:results', { count: tracks.length });
    return tracks;
  } catch (err) {
    logError(reqId, 'scSearch:error', err.message);
    return [];
  }
}

// Spotify token (inchangé)
async function getSpotifyAccessToken(reqId) {
  try {
    if (spotifyAccessToken && Date.now() < tokenExpiry) return spotifyAccessToken;
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) throw new Error('Spotify credentials not configured');
    logInfo(reqId, 'spotify:token:refresh');
    const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
    const resp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      timeout: 10000
    });
    if (!resp.ok) throw new Error(`Spotify Auth failed: ${resp.status}`);
    const data = await resp.json();
    spotifyAccessToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;
    logInfo(reqId, 'spotify:token:success');
    return spotifyAccessToken;
  } catch (err) {
    logError(reqId, 'spotify:token:error', err.message);
    throw err;
  }
}

// Les fonctions extractYouTubePlaylistTracks, extractSpotifyPlaylistTracks,
// fetchYouTubeOEmbed, fetchSpotifyOG, fetchAppleMusicOG restent IDENTIQUES
// (Je les skip pour gagner de la place, copiez-les depuis votre play.js actuel)

// Matching sur SoundCloud adapté pour Poru
async function matchTrackOnSoundCloud(client, requester, track, reqId) {
  try {
    const query = track.query || `${track.author} ${track.title}`.trim();
    logInfo(reqId, 'sc:match:start', { query });

    const strategies = [
      { name: 'exact', query: `"${track.author}" "${track.title}"`, limit: 5 },
      { name: 'standard', query: `${track.author} ${track.title}`, limit: 8 },
      { name: 'title-only', query: track.title, limit: 10 }
    ];
    
    let allResults = [];
    
    for (const strategy of strategies) {
      if (!strategy.query.trim()) continue;
      logInfo(reqId, 'sc:match:strategy', { name: strategy.name });
      const results = await scSearch(client, requester, strategy.query, strategy.limit, reqId);
      if (results && results.length > 0) {
        allResults = allResults.concat(results);
        if (strategy.name === 'exact' && results.length >= 3) break;
      }
    }
    
    if (allResults.length === 0) {
      logWarn(reqId, 'sc:match:noResults');
      return null;
    }
    
    // Dédupliquer
    const uniqueResults = [];
    const seenUris = new Set();
    for (const result of allResults) {
      const uri = result.info?.uri || result.uri;
      if (!seenUris.has(uri)) {
        seenUris.add(uri);
        uniqueResults.push(result);
      }
    }
    
    logInfo(reqId, 'sc:match:candidates', { total: uniqueResults.length });

    // Scoring
    const wantTitleTokens = coreTokens(track.title);
    const normalizedWantAuthor = normalize(track.author);
    let bestMatch = null;
    let bestScore = 0;

    for (const result of uniqueResults) {
      const resultTitle = result.info.title || '';
      const resultAuthor = result.info.author || '';
      const normalizedResultAuthor = normalize(resultAuthor);
      const resultTitleTokens = tokenSet(resultTitle);
      const authorInAuthor = normalizedResultAuthor.includes(normalizedWantAuthor) || normalizedWantAuthor.includes(normalizedResultAuthor);
      const titleOverlap = wantTitleTokens.filter(t => resultTitleTokens.has(t)).length;
      const titleMatchRatio = wantTitleTokens.length > 0 ? titleOverlap / wantTitleTokens.length : 0;
      if (!authorInAuthor && titleMatchRatio < 0.5) continue;
      const titleScore = jaccard(track.title, resultTitle);
      const authorScore = jaccard(track.author, resultAuthor);
      let score = titleScore * 0.5 + authorScore * 0.25 + titleMatchRatio * 0.1;
      if (authorInAuthor) score += 0.15;
      if (titleMatchRatio === 1.0 && wantTitleTokens.length > 0) score += 0.05;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = result;
      }
    }

    const threshold = 0.38;
    if (bestMatch && bestScore >= threshold) {
      logInfo(reqId, 'sc:match:found', { score: bestScore.toFixed(2), title: bestMatch.info.title });
      return bestMatch;
    }

    logWarn(reqId, 'sc:match:lowScore', { bestScore: bestScore ? bestScore.toFixed(2) : 'N/A', threshold });
    return null;
  } catch (err) {
    logError(reqId, 'sc:match:error', err.message);
    return null;
  }
}

// COMMANDE PRINCIPALE - VOIR PARTIE 2
module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Jouer une musique ou une playlist')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('URL ou recherche')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  async execute(interaction) {
    const reqId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const query = interaction.options.getString('query');
    const voiceChannel = interaction.member?.voice?.channel;
    const gid = interaction.guildId;

    logInfo(reqId, 'execute:start', { query, guild: gid });

    if (!voiceChannel) {
      return interaction.reply({ 
        embeds: [buildEmbed(gid, {
          type: 'error',
          title: 'Erreur',
          description: 'Vous devez être dans un salon vocal!'
        })],
        ephemeral: true 
      });
    }

    await interaction.deferReply();

    try {
      const client = interaction.client;
      
      // ✨ SMART MODE: Récupération ou création automatique multi-instance
      const { player, isNew } = PlayerManager.getOrCreatePlayer(client, {
        guildId: gid,
        voiceChannelId: voiceChannel.id,
        textChannelId: interaction.channelId,
        userId: interaction.user.id,
        voiceChannelName: voiceChannel.name
      });

      logInfo(reqId, 'player:status', { 
        playerId: player.guildId,
        isNew,
        voiceChannel: voiceChannel.name 
      });

      // Connexion si besoin
      if (!player.isConnected) {
        logInfo(reqId, 'player:connect');
        await player.connect();
      }

      PlayerManager.updateActivity(player);

      // ===== PLAYLIST YOUTUBE =====
      if (PATTERNS.YT_PLAYLIST.test(query)) {
        if (PATTERNS.YT_RADIO.test(query) || PATTERNS.YT_MIX.test(query)) {
          logWarn(reqId, 'type:ytRadio');
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'warning',
              title: 'YouTube Radio/Mix',
              description: `❌ Les playlists générées dynamiquement ne sont pas supportées.\n\n💿 Instance: **${player.metadata?.sessionName || 'Session'}** dans **${voiceChannel.name}**`
            })]
          });
        }
        
        logInfo(reqId, 'type:ytPlaylist');
        const result = await extractYouTubePlaylistTracks(query, reqId);
        
        if (!Array.isArray(result)) {
          if (result && result.error) {
            const errorMessages = {
              not_found: '❌ Playlist introuvable.',
              private: '🔒 Cette playlist est privée.',
              no_contents: '❌ Impossible de récupérer le contenu.',
              no_videos: '📭 Aucune vidéo trouvée.',
              parse_failed: '⚠️ Structure YouTube non reconnue.',
              extract_failed: '❌ Erreur lors de l\'extraction.'
            };
            return interaction.editReply({
              embeds: [buildEmbed(gid, { 
                type: 'error', 
                title: '🔍 YouTube → SoundCloud', 
                description: `${errorMessages[result.error] || '❌ Erreur inconnue.'}\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
              })]
            });
          }
          return interaction.editReply({
            embeds: [buildEmbed(gid, { 
              type: 'error', 
              title: '🔍 YouTube → SoundCloud', 
              description: `❌ Erreur inattendue.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
            })]
          });
        }
        
        if (result.length === 0) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, { 
              type: 'error', 
              title: '🔍 YouTube → SoundCloud', 
              description: `❌ Aucune piste récupérée.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
            })]
          });
        }

        await interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'info',
            title: '🔍 Conversion YouTube → SoundCloud',
            description: `Recherche de ${result.length} piste(s) sur SoundCloud...\n\n⏳ Cela peut prendre quelques secondes.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
          })]
        });

        let added = 0;
        let failed = 0;

        for (const track of result) {
          const scTrack = await matchTrackOnSoundCloud(client, interaction.user, track, reqId);
          if (scTrack) {
            player.queue.add(scTrack);
            added++;
          } else {
            failed++;
          }
        }

        PlayerManager.updateActivity(player);

        if (!player.isPlaying && !player.isPaused && added > 0) {
          await player.play();
        }

        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: added > 0 ? 'success' : 'warning',
            title: '✅ Playlist YouTube → SoundCloud',
            description: `**${added}** piste(s) trouvée(s)` + 
              (failed > 0 ? `\n⚠️ **${failed}** piste(s) non trouvée(s)` : '') +
              `\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
          })]
        });
      }

      // ===== PLAYLIST SPOTIFY =====
      if (PATTERNS.SP_PLAYLIST.test(query) || PATTERNS.SP_ALBUM.test(query)) {
        const isAlbum = PATTERNS.SP_ALBUM.test(query);
        logInfo(reqId, `type:sp${isAlbum ? 'Album' : 'Playlist'}`);
        
        const tracks = await extractSpotifyPlaylistTracks(query, reqId);
        
        if (tracks.length === 0) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: '🔍 Spotify → SoundCloud',
              description: `❌ Impossible de récupérer les pistes.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
            })]
          });
        }

        await interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'info',
            title: '🔍 Conversion Spotify → SoundCloud',
            description: `Recherche de ${tracks.length} piste(s) sur SoundCloud...\n\n⏳ Cela peut prendre quelques secondes.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
          })]
        });

        let added = 0;
        let failed = 0;

        for (const track of tracks) {
          const scTrack = await matchTrackOnSoundCloud(client, interaction.user, track, reqId);
          if (scTrack) {
            player.queue.add(scTrack);
            added++;
          } else {
            failed++;
          }
        }

        PlayerManager.updateActivity(player);

        if (!player.isPlaying && !player.isPaused && added > 0) {
          await player.play();
        }

        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: added > 0 ? 'success' : 'warning',
            title: `✅ ${isAlbum ? 'Album' : 'Playlist'} Spotify → SoundCloud`,
            description: `**${added}** piste(s) trouvée(s)` +
              (failed > 0 ? `\n⚠️ **${failed}** piste(s) non trouvée(s)` : '') +
              `\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
          })]
        });
      }

      // ===== PLAYLIST SOUNDCLOUD =====
      if (PATTERNS.SC_PLAYLIST.test(query)) {
        logInfo(reqId, 'type:scPlaylist');
        
        const res = await client.poru.resolve({
          query,
          source: 'soundcloud',
          requester: interaction.user
        });

        if (!res?.tracks || res.tracks.length === 0) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: '🔊 Playlist SoundCloud',
              description: `Aucune piste trouvée dans cette playlist.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
            })]
          });
        }

        for (const track of res.tracks) {
          player.queue.add(track);
        }

        PlayerManager.updateActivity(player);

        if (!player.isPlaying && !player.isPaused) {
          await player.play();
        }

        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'success',
            title: '✅ Playlist SoundCloud',
            description: `**${res.tracks.length}** piste(s) ajoutée(s)\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
          })]
        });
      }

      // ===== TRACK YOUTUBE =====
      if (PATTERNS.YT_VIDEO.test(query) && !PATTERNS.YT_PLAYLIST.test(query)) {
        logInfo(reqId, 'type:ytTrack');
        
        const meta = await fetchYouTubeOEmbed(query, reqId);
        
        if (!meta || !meta.title) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: '🔍 YouTube → SoundCloud',
              description: `Impossible de récupérer les informations de la vidéo.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
            })]
          });
        }
        
        const scTrack = await matchTrackOnSoundCloud(client, interaction.user, meta, reqId);
        
        if (scTrack) {
          player.queue.add(scTrack);
          PlayerManager.updateActivity(player);
          
          if (!player.isPlaying && !player.isPaused) {
            await player.play();
          }
          
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'success',
              title: '✅ YouTube → SoundCloud',
              description: `**${scTrack.info.title}**\npar ${scTrack.info.author || 'Artiste inconnu'}\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
            })]
          });
        }
        
        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'error',
            title: '🔍 YouTube → SoundCloud',
            description: `❌ Piste non trouvée sur SoundCloud:\n**${meta.title}**${meta.author ? `\npar ${meta.author}` : ''}\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
          })]
        });
      }

      // ===== TRACK SPOTIFY =====
      if (PATTERNS.SP_TRACK.test(query)) {
        logInfo(reqId, 'type:spTrack');
        
        const meta = await fetchSpotifyOG(query, reqId);
        
        if (!meta || !meta.title) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: '🔍 Spotify → SoundCloud',
              description: `Impossible de récupérer les informations de la piste.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
            })]
          });
        }
        
        const scTrack = await matchTrackOnSoundCloud(client, interaction.user, meta, reqId);
        
        if (scTrack) {
          player.queue.add(scTrack);
          PlayerManager.updateActivity(player);
          
          if (!player.isPlaying && !player.isPaused) {
            await player.play();
          }
          
          const titleScore = jaccard(meta.title, scTrack.info.title);
          const authorScore = meta.author ? jaccard(meta.author, scTrack.info.author || '') : 0;
          const confidence = Math.round((titleScore * 0.6 + authorScore * 0.4) * 100);
          
          const embedType = confidence >= 70 ? 'success' : 'warning';
          const confidenceText = confidence >= 70 ? '' : `\n⚠️ Correspondance: ${confidence}%`;
          
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: embedType,
              title: '✅ Spotify → SoundCloud',
              description: `**${scTrack.info.title}**\npar ${scTrack.info.author || 'Artiste inconnu'}${confidenceText}\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
            })]
          });
        }
        
        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'error',
            title: '🔍 Spotify → SoundCloud',
            description: `❌ Piste non trouvée sur SoundCloud:\n**${meta.title}**${meta.author ? `\npar ${meta.author}` : ''}\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
          })]
        });
      }

      // ===== TRACK APPLE MUSIC =====
      if (PATTERNS.AM_TRACK.test(query)) {
        logInfo(reqId, 'type:amTrack');
        
        const meta = await fetchAppleMusicOG(query, reqId);
        
        if (!meta || !meta.title) {
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'error',
              title: '🔍 Apple Music → SoundCloud',
              description: `Impossible de récupérer les informations de la piste.\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
            })]
          });
        }
        
        const scTrack = await matchTrackOnSoundCloud(client, interaction.user, meta, reqId);
        
        if (scTrack) {
          player.queue.add(scTrack);
          PlayerManager.updateActivity(player);
          
          if (!player.isPlaying && !player.isPaused) {
            await player.play();
          }
          
          return interaction.editReply({
            embeds: [buildEmbed(gid, {
              type: 'success',
              title: '✅ Apple Music → SoundCloud',
              description: `**${scTrack.info.title}**\npar ${scTrack.info.author || 'Artiste inconnu'}\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
            })]
          });
        }
        
        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'error',
            title: '🔍 Apple Music → SoundCloud',
            description: `❌ Piste non trouvée sur SoundCloud:\n**${meta.title}**${meta.author ? `\npar ${meta.author}` : ''}\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
          })]
        });
      }

      // ===== TRACK SOUNDCLOUD OU RECHERCHE =====
      logInfo(reqId, 'type:scDirectSearch');
      
      const res = await client.poru.resolve({
        query: `scsearch:${query}`,
        source: 'soundcloud',
        requester: interaction.user
      });

      if (!res?.tracks || res.tracks.length === 0) {
        return interaction.editReply({
          embeds: [buildEmbed(gid, {
            type: 'error',
            title: '🔊 Recherche SoundCloud',
            description: `Aucune piste trouvée pour: **${query}**\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
          })]
        });
      }

      player.queue.add(res.tracks[0]);
      PlayerManager.updateActivity(player);

      if (!player.isPlaying && !player.isPaused) {
        await player.play();
      }

      return interaction.editReply({
        embeds: [buildEmbed(gid, {
          type: 'success',
          title: '✅ SoundCloud',
          description: `**${res.tracks[0].info.title}**\npar ${res.tracks[0].info.author || 'Artiste inconnu'}\n\n💿 Instance: **${player.metadata?.sessionName}** dans **${voiceChannel.name}**`
        })]
      });

    } catch (err) {
      logError(reqId, 'execute:criticalError', err.message);
      console.error(`[${reqId}] Stack trace:`, err.stack);
      
      return interaction.editReply({
        embeds: [buildEmbed(gid, {
          type: 'error',
          title: 'Erreur critique',
          description: 'Une erreur inattendue s\'est produite.'
        })]
      }).catch(() => {
        logError(reqId, 'execute:replyFailed', 'Interaction expired');
      });
    }
  }
};
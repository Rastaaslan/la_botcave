// utils/playerManager.js - VERSION PORU
const crypto = require('crypto');

class PlayerManager {
  /**
   * Récupère ou crée intelligemment un player basé sur le salon vocal
   * @param {Client} client - Client Discord.js
   * @param {Object} options - { guildId, voiceChannelId, textChannelId, userId, voiceChannelName }
   * @returns {Object} { player, isNew }
   */
  static getOrCreatePlayer(client, options) {
    const { guildId, voiceChannelId, textChannelId, userId, voiceChannelName } = options;
    
    // 1️⃣ Créer un playerId unique pour ce salon vocal
    const playerId = `${guildId}-${voiceChannelId}`;
    
    // 2️⃣ Chercher un player existant avec ce playerId
    let player = client.poru.players.get(playerId);
    
    if (player) {
      console.log(`[PlayerManager] ♻️ Réutilisation player: ${playerId}`);
      return { player, isNew: false };
    }
    
    // 3️⃣ Créer un nouveau player
    const uniqueId = crypto.randomBytes(4).toString('hex');
    
    console.log(`[PlayerManager] ✨ Création player: ${playerId}`);
    
    player = client.poru.createConnection({
      guildId: playerId,  // ✅ Poru accepte un ID custom
      voiceChannel: voiceChannelId,
      textChannel: textChannelId,
      deaf: true,
      mute: false
    });
    
    // Métadonnées personnalisées
    player.metadata = {
      createdBy: userId,
      createdAt: Date.now(),
      sessionId: uniqueId,
      sessionName: `Session-${uniqueId.substring(0, 4).toUpperCase()}`,
      voiceChannelName: voiceChannelName || 'Salon inconnu',
      voiceChannelId: voiceChannelId,
      realGuildId: guildId,
      playerId: playerId
    };
    
    return { player, isNew: true };
  }
  
  /**
   * Récupère le player pour un utilisateur dans son salon vocal
   * @param {Client} client
   * @param {string} guildId
   * @param {string} voiceChannelId
   * @returns {Player|null}
   */
  static getPlayerForUser(client, guildId, voiceChannelId) {
    if (!voiceChannelId) return null;
    
    const playerId = `${guildId}-${voiceChannelId}`;
    return client.poru.players.get(playerId) || null;
  }
  
  /**
   * Liste tous les players d'un serveur
   * @param {Client} client
   * @param {string} guildId
   * @returns {Array<Player>}
   */
  static listGuildPlayers(client, guildId) {
    return Array.from(client.poru.players.values())
      .filter(p => p.guildId && p.guildId.startsWith(`${guildId}-`))
      .sort((a, b) => (a.metadata?.createdAt || 0) - (b.metadata?.createdAt || 0));
  }
  
  /**
   * Extrait le vrai guildId depuis un playerId ou player
   * @param {string|Player} playerIdOrPlayer
   * @returns {string}
   */
  static extractGuildId(playerIdOrPlayer) {
    if (typeof playerIdOrPlayer === 'object' && playerIdOrPlayer?.metadata?.realGuildId) {
      return playerIdOrPlayer.metadata.realGuildId;
    }
    if (typeof playerIdOrPlayer === 'object' && playerIdOrPlayer?.guildId) {
      return playerIdOrPlayer.guildId.split('-')[0];
    }
    if (typeof playerIdOrPlayer === 'string') {
      return playerIdOrPlayer.split('-')[0];
    }
    return null;
  }
  
  /**
   * Nettoie les players inactifs
   * @param {Client} client
   * @param {number} inactiveThresholdMs
   * @returns {number}
   */
  static cleanupInactivePlayers(client, inactiveThresholdMs = 5 * 60 * 1000) {
    let cleaned = 0;
    const now = Date.now();
    
    for (const [id, player] of client.poru.players) {
      const lastActivity = player.metadata?.lastActivity || player.metadata?.createdAt || 0;
      const inactive = now - lastActivity > inactiveThresholdMs;
      
      if (!player.isConnected && !player.isPlaying && inactive) {
        console.log(`[PlayerManager] 🧹 Nettoyage player: ${id}`);
        player.destroy();
        cleaned++;
      }
    }
    
    return cleaned;
  }
  
  /**
   * Met à jour l'activité d'un player
   * @param {Player} player
   */
  static updateActivity(player) {
    if (player.metadata) {
      player.metadata.lastActivity = Date.now();
    }
  }
}

module.exports = { PlayerManager };
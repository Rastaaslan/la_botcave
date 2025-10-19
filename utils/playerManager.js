// utils/playerManager.js
const crypto = require('crypto');

class PlayerManager {
  /**
   * Récupère ou crée intelligemment un player basé sur le salon vocal de l'utilisateur
   * @param {Client} client - Client Discord.js
   * @param {Object} options - { guildId, voiceChannelId, textChannelId, userId, voiceChannelName }
   * @returns {Object} { player, isNew }
   */
  static getOrCreatePlayer(client, options) {
    const { guildId, voiceChannelId, textChannelId, userId, voiceChannelName } = options;
    
    // 1️⃣ Chercher un player existant dans ce salon vocal
    // Moonlink.js utilise .cache au lieu de .values()
    const playersMap = client.manager.players.cache || client.manager.players;
    const existingPlayer = Array.from(playersMap.values())
      .find(p => 
        p.guildId.startsWith(`${guildId}-`) && 
        p.voiceChannelId === voiceChannelId
      );
    
    if (existingPlayer) {
      console.log(`[PlayerManager] ♻️ Réutilisation player existant: ${existingPlayer.guildId}`);
      return { player: existingPlayer, isNew: false };
    }
    
    // 2️⃣ Pas de player existant → Créer un nouveau avec ID unique
    const uniqueId = crypto.randomBytes(4).toString('hex');
    const playerId = `${guildId}-${voiceChannelId}-${uniqueId}`;
    
    console.log(`[PlayerManager] ✨ Création nouveau player: ${playerId}`);
    
    const player = client.manager.players.create({
      guildId: playerId,
      voiceChannelId: voiceChannelId,
      textChannelId: textChannelId,
      volume: 50
    });
    
    // Métadonnées personnalisées
    player.metadata = {
      createdBy: userId,
      createdAt: Date.now(),
      sessionId: uniqueId,
      sessionName: `Session-${uniqueId.substring(0, 4).toUpperCase()}`,
      voiceChannelName: voiceChannelName || 'Salon inconnu'
    };
    
    return { player, isNew: true };
  }
  
  /**
   * Récupère le player actif pour un utilisateur dans son salon vocal
   * @param {Client} client
   * @param {string} guildId
   * @param {string} voiceChannelId
   * @returns {Player|null}
   */
  static getPlayerForUser(client, guildId, voiceChannelId) {
    if (!voiceChannelId) return null;
    
    const playersMap = client.manager.players.cache || client.manager.players;
    return Array.from(playersMap.values())
      .find(p => 
        p.guildId.startsWith(`${guildId}-`) && 
        p.voiceChannelId === voiceChannelId
      );
  }
  
  /**
   * Liste tous les players actifs d'un serveur
   * @param {Client} client
   * @param {string} guildId
   * @returns {Array<Player>}
   */
  static listGuildPlayers(client, guildId) {
    const playersMap = client.manager.players.cache || client.manager.players;
    return Array.from(playersMap.values())
      .filter(p => p.guildId.startsWith(`${guildId}-`))
      .sort((a, b) => (a.metadata?.createdAt || 0) - (b.metadata?.createdAt || 0));
  }
  
  /**
   * Extrait le vrai guildId depuis un playerId composite
   * @param {string} playerId - Format: "guildId-voiceChannelId-uniqueId"
   * @returns {string}
   */
  static extractGuildId(playerId) {
    if (!playerId || typeof playerId !== 'string') return null;
    return playerId.split('-')[0];
  }
  
  /**
   * Nettoie les players inactifs (appelé périodiquement)
   * @param {Client} client
   * @param {number} inactiveThresholdMs - Temps d'inactivité avant nettoyage (défaut: 5min)
   * @returns {number} Nombre de players nettoyés
   */
  static cleanupInactivePlayers(client, inactiveThresholdMs = 5 * 60 * 1000) {
    let cleaned = 0;
    const now = Date.now();
    
    const playersMap = client.manager.players.cache || client.manager.players;
    for (const [id, player] of playersMap) {
      const lastActivity = player.metadata?.lastActivity || player.metadata?.createdAt || 0;
      const inactive = now - lastActivity > inactiveThresholdMs;
      
      if (!player.connected && !player.playing && inactive) {
        console.log(`[PlayerManager] 🧹 Nettoyage player inactif: ${id}`);
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
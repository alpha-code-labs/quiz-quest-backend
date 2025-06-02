// gameStateWebSocketController.js
const { db } = require('./config/firebase-config');

// Track active game rooms and their connected sockets
const activeGameRooms = new Map();

/**
 * Setup WebSocket handlers for game state updates
 * @param {Object} io - Socket.IO server instance
 */
const setupGameStateWebSockets = (io) => {
  const gameNamespace = io.of('/game');
  
  gameNamespace.on('connection', (socket) => {
    console.log('New client connected to game state namespace', socket.id);
    
    // Handle user joining a game room
    socket.on('join_game_room', ({ roomId, userId }) => {
      if (!roomId || !userId) return;
      
      console.log(`User ${userId} joining game state room: ${roomId} (Socket: ${socket.id})`);
      
      // Join the room
      socket.join(roomId);
      
      // Store user information
      if (!activeGameRooms.has(roomId)) {
        activeGameRooms.set(roomId, new Set());
      }
      activeGameRooms.get(roomId).add(userId);
      
      // Store socket id -> roomId mapping for disconnection handling
      socket.data.roomId = roomId;
      socket.data.userId = userId;
      
      // Notify room that user has joined
      socket.to(roomId).emit('user_joined_game', { 
        userId, 
        timestamp: new Date().toISOString()
      });
      
      // Send current game state to newly joined user
      sendGameState(gameNamespace, roomId);
    });
    
    // Handle user leaving a game room
    socket.on('leave_game_room', ({ roomId, userId }) => {
      if (!roomId || !userId) return;
      
      console.log(`User ${userId} leaving game state room: ${roomId}`);
      leaveGameRoom(socket, roomId, userId);
    });
    
    // Handle player progress updates
    socket.on('update_player_progress', async ({ roomId, userId, score, points, currentQuestion, questionTimes, totalTimeSpent }) => {
      if (!roomId || !userId) return;
      
      console.log(`Updating progress for user ${userId} in room ${roomId}: Score=${score}, Points=${points}, Question=${currentQuestion}`);
      
      // Log timing data if provided
      if (questionTimes) {
        console.log(`Timing data for user ${userId}: questionTimes=${JSON.stringify(questionTimes)}, totalTimeSpent=${totalTimeSpent}ms`);
      }
      
      try {
        // Update player in database with timing data
        await updatePlayerInDatabase(roomId, userId, score, points, currentQuestion, questionTimes, totalTimeSpent);
        
        // Broadcast the update to all users in the room
        const updatedGameState = await getGameState(roomId);
        gameNamespace.to(roomId).emit('game_state_updated', updatedGameState);
        
        // If game is over, notify all clients
        if (updatedGameState.gameState === 'completed') {
          gameNamespace.to(roomId).emit('game_completed', updatedGameState);
        }
      } catch (error) {
        console.error(`Error updating player progress via WebSocket: ${error.message}`);
        // Send error to the client
        socket.emit('game_state_error', { 
          message: 'Failed to update progress',
          error: error.message
        });
      }
    });
    
    // Handle game state updates (mainly for host)
    socket.on('update_game_state', async ({ roomId, gameState }) => {
      if (!roomId || !gameState) return;
      
      console.log(`Updating game state for room ${roomId} to ${gameState}`);
      
      try {
        // Update game state in database
        const roomRef = db.collection('game_rooms').doc(roomId);
        await roomRef.update({
          gameState: gameState,
          updatedAt: new Date().toISOString()
        });
        
        // Broadcast the update to all users in the room
        const updatedGameState = await getGameState(roomId);
        gameNamespace.to(roomId).emit('game_state_updated', updatedGameState);
        
        // If game is completed, send special event
        if (gameState === 'completed') {
          gameNamespace.to(roomId).emit('game_completed', updatedGameState);
        }
      } catch (error) {
        console.error(`Error updating game state via WebSocket: ${error.message}`);
        // Send error to the client
        socket.emit('game_state_error', { 
          message: 'Failed to update game state',
          error: error.message
        });
      }
    });
    
    // Handle disconnections
    socket.on('disconnect', () => {
      const { roomId, userId } = socket.data;
      
      if (roomId && userId) {
        console.log(`User ${userId} disconnected from game state room ${roomId}`);
        leaveGameRoom(socket, roomId, userId);
      }
    });
  });
  
  console.log('Game state WebSocket handlers initialized');
};

/**
 * Handle a user leaving a game room
 * @param {Object} socket - Socket instance
 * @param {string} roomId - Room ID
 * @param {string} userId - User ID
 */
const leaveGameRoom = (socket, roomId, userId) => {
  // Leave the Socket.IO room
  socket.leave(roomId);
  
  // Remove user from active users in room
  if (activeGameRooms.has(roomId)) {
    activeGameRooms.get(roomId).delete(userId);
    
    // Clean up empty rooms
    if (activeGameRooms.get(roomId).size === 0) {
      activeGameRooms.delete(roomId);
    }
  }
  
  // Notify room that user has left
  socket.to(roomId).emit('user_left_game', { 
    userId, 
    timestamp: new Date().toISOString()
  });
  
  // Clear socket data
  socket.data.roomId = null;
  socket.data.userId = null;
};

/**
 * Update player progress in the database
 * @param {string} roomId - Room ID
 * @param {string} userId - User ID
 * @param {number} score - Player score
 * @param {number} points - Player points
 * @param {number} currentQuestion - Current question index
 * @param {Array<number>} questionTimes - Array of time spent on each question in milliseconds
 * @param {number} totalTimeSpent - Total time spent on all questions in milliseconds
 */
const updatePlayerInDatabase = async (roomId, userId, score, points, currentQuestion, questionTimes = [], totalTimeSpent = 0) => {
 try {
   // Get current room data
   const roomRef = db.collection('game_rooms').doc(roomId);
   const roomDoc = await roomRef.get();
   
   if (!roomDoc.exists) {
     throw new Error(`Room ${roomId} not found`);
   }
   
   const roomData = roomDoc.data();
   
   // Find player in the players array
   const players = roomData.players || [];
   const playerIndex = players.findIndex(p => p.id === userId);
   
   if (playerIndex === -1) {
     throw new Error(`Player ${userId} not found in room ${roomId}`);
   }
   
   // Update player data with timing information
   const updatedPlayer = {
     ...players[playerIndex],
     score: points, // Use points for the score value
     currentQuestion: currentQuestion,
     questionTimes: questionTimes, // Add timing data
     totalTimeSpent: totalTimeSpent // Add total time spent
   };
   
   // Create updated players array
   const updatedPlayers = [...players];
   updatedPlayers[playerIndex] = updatedPlayer;
   
   // Update room state with updated players
   await roomRef.update({
     players: updatedPlayers,
     updatedAt: new Date().toISOString()
   });
   
   // NEW CODE: Check if this was the last question AND if all players have completed all questions
   if (roomData.questions && currentQuestion >= roomData.questions.length) {
     console.log(`Player ${userId} completed the game`);
     
     // Check if all players have completed the game
     const allPlayersCompleted = updatedPlayers.every(player => {
       // A player has completed if their currentQuestion is greater than or equal to the question count
       return player.currentQuestion >= roomData.questions.length;
     });
     
     if (allPlayersCompleted) {
       console.log(`All players have completed the game. Marking game as completed.`);
       
       // Update the user's total points in the users collection for ALL players
       try {
         // Process each player's points
         for (const player of updatedPlayers) {
           const userRef = db.collection('users').doc(player.id);
           const userDoc = await userRef.get();
           
           if (userDoc.exists) {
             const userData = userDoc.data();
             const currentPoints = userData.triviaPoints || 0;
             const newTotalPoints = currentPoints + player.score;
             
             console.log(`Updating user ${player.id} points from ${currentPoints} to ${newTotalPoints}`);
             
             // Update user's total points
             await userRef.update({
               triviaPoints: newTotalPoints,
               updatedAt: new Date().toISOString()
             });
           } else {
             console.error(`User ${player.id} not found in database`);
           }
         }
         
         // Recalculate rankings for all users
         console.log('Recalculating rankings for all users');
         
         // Get all users ordered by points
         const usersSnapshot = await db.collection('users')
           .orderBy('triviaPoints', 'desc')
           .get();
         
         // Batch update to efficiently update all users
         const batch = db.batch();
         let newRank = 1;
         
         // Update ranks for all users
         usersSnapshot.forEach(doc => {
           const userRef = db.collection('users').doc(doc.id);
           batch.update(userRef, { currentRank: newRank });
           newRank++;
         });
         
         // Commit all ranking updates
         await batch.commit();
         console.log(`Updated rankings for ${newRank - 1} users`);
         
         // Also update the game state to completed
         await roomRef.update({
           gameState: 'completed',
           updatedAt: new Date().toISOString()
         });

         // NEW: Update league member scores if this is a league game
         if (roomData.gameType === 'league' && roomData.leagueId) {
           console.log(`Updating league member scores for league: ${roomData.leagueId}`);
           
           try {
             const leagueRef = db.collection('leagues').doc(roomData.leagueId);
             const leagueDoc = await leagueRef.get();
             
             if (leagueDoc.exists) {
               const leagueData = leagueDoc.data();
               const leagueMembers = leagueData.members || [];
               
               // Update each player's league score
               const updatedMembers = leagueMembers.map(member => {
                 const gamePlayer = updatedPlayers.find(p => p.id === member.id);
                 if (gamePlayer) {
                   return {
                     ...member,
                     score: (member.score || 0) + gamePlayer.score
                   };
                 }
                 return member;
               });
               
               // Sort members by score (highest first) and assign ranks
               updatedMembers.sort((a, b) => b.score - a.score);
               updatedMembers.forEach((member, index) => {
                 member.rank = index + 1;
               });
               
               // Update league document
               await leagueRef.update({
                 members: updatedMembers,
                 lastActivity: new Date().toISOString()
               });
               
               console.log(`Updated league ${roomData.leagueId} member scores`);
             }
           } catch (leagueError) {
             console.error(`Error updating league member scores: ${leagueError.message}`);
           }
         }
       } catch (userUpdateError) {
         console.error(`Error updating user points: ${userUpdateError.message}`);
         // Still mark game as completed even if user update fails
         await roomRef.update({
           gameState: 'completed',
           updatedAt: new Date().toISOString()
         });
       }
     } else {
       console.log(`Not all players have completed the game yet. Waiting for others to finish.`);
     }
   }
   
   return updatedPlayers;
 } catch (error) {
   console.error(`Error updating player in database: ${error.message}`);
   throw error;
 }
};

/**
 * Get current game state from the database
 * @param {string} roomId - Room ID
 * @returns {Object} Game state data
 */
const getGameState = async (roomId) => {
  try {
    const roomRef = db.collection('game_rooms').doc(roomId);
    const roomDoc = await roomRef.get();
    
    if (!roomDoc.exists) {
      throw new Error(`Room ${roomId} not found`);
    }
    
    return roomDoc.data();
  } catch (error) {
    console.error(`Error getting game state: ${error.message}`);
    throw error;
  }
};

/**
 * Broadcast current game state to all clients in a room
 * @param {Object} namespace - Socket.IO namespace
 * @param {string} roomId - Room ID
 */
const sendGameState = async (namespace, roomId) => {
  try {
    const gameState = await getGameState(roomId);
    namespace.to(roomId).emit('game_state_updated', gameState);
  } catch (error) {
    console.error(`Error sending game state: ${error.message}`);
  }
};

/**
 * Manually trigger a game state update (for use in REST API endpoints)
 * @param {Object} io - Socket.IO server instance
 * @param {string} roomId - Room ID
 */
const triggerGameStateUpdate = async (io, roomId) => {
  try {
    const gameNamespace = io.of('/game');
    await sendGameState(gameNamespace, roomId);
  } catch (error) {
    console.error(`Error triggering game state update: ${error.message}`);
  }
};

module.exports = {
  setupGameStateWebSockets,
  triggerGameStateUpdate
};
const { db, realtime, auth } = require('../config/firebase-config');
const { updateOnlineUsersCount } = require('../webSocketControllers');
const { triggerGameStateUpdate } = require('../gameStateWebSocketController');
const { sendGameInvitation } = require('../webSocketControllers');
const {sendLeagueGameInvitation } = require('../webSocketControllers'); 
const admin = require('firebase-admin');

// In your controllers file, add this at the top:
const { getUserLevel } = require('../utils/userLevels');

// Add this new controller function:
const getUserLevelInfo = async (req, res) => {
 
 try {
   const { userId } = req.params;
   let points = 0;
   
   // Get points from query parameter if provided
   if (req.query.points) {
     points = parseInt(req.query.points, 10);
   } else {
     // Otherwise try to get points from the user's record
     const userDoc = await db.collection('users').doc(userId).get();
     
     if (!userDoc.exists) {
       return res.status(404).json({ message: 'User not found' });
     }
     
     points = userDoc.data().triviaPoints || 0;
   }
   
   // Get level information based on points
   const levelInfo = getUserLevel(points);
   
   // Return the level information to the frontend
   res.status(200).json(levelInfo);
   
 } catch (error) {
   console.error('Error in getUserLevelInfo:', error);
   res.status(500).json({ error: error.message });
 }
};

// Generate a unique user ID
const generateUserId = async (req, res) => {

try {
  // Get the counter document from Firestore
  const counterRef = db.collection('counters').doc('userIdCounter');
  
  // Use a transaction to ensure we get a unique incremented value
  const result = await db.runTransaction(async (transaction) => {
    const counterDoc = await transaction.get(counterRef);
    
    // Initialize the counter if it doesn't exist
    let nextId = 1;
    if (counterDoc.exists) {
      nextId = counterDoc.data().currentValue + 1;
    }
    
    // Update the counter in the database
    transaction.set(counterRef, { currentValue: nextId });
    
    // Format the user ID with leading zeros (QQ0000001, QQ0000002, etc.)
    const formattedId = `QQ${String(nextId).padStart(7, '0')}`;
    
    return formattedId;
  });
  
  // Get total number of users to assign the new user's rank
  const totalUsersQuery = await db.collection('users').get();
  const newUserRank = totalUsersQuery.size + 1;
  
  // Create a basic user entry with the generated ID
  // Initialize with 100 trivia points as per requirements
  await db.collection('users').doc(result).set({
    userId: result,
    displayName: `Player_${result}`, // Default display name
    triviaPoints: 100, // Starting with 100 points as required
    currentRank: newUserRank, // Assign rank at the bottom of the leaderboard
    createdAt: new Date().toISOString()
  });
  
  // Return the generated user ID and trivia points to the frontend
  res.status(200).json({ 
    userId: result,
    triviaPoints: 100,
    currentRank: newUserRank,
    message: 'User ID generated successfully with 100 trivia points' 
  });
  
} catch (error) {
  console.error('Error in generateUserId:', error);
  res.status(500).json({ error: error.message });
}
};

// Get user by ID
const getUserById = async (req, res) => {

try {
  const { userId } = req.params;
  
  // Get user from Firestore
  const userDoc = await db.collection('users').doc(userId).get();
  
  if (!userDoc.exists) {
    return res.status(404).json({ message: 'User not found' });
  }
  
  // Check if currentRank exists, if not, calculate and add it
  const userData = userDoc.data();
  if (userData.currentRank === undefined) {
    
    // Count users with more points than this user
    const higherPointsQuery = await db.collection('users')
      .where('triviaPoints', '>', userData.triviaPoints)
      .get();
    
    // Count total number of users for new user calculation
    const totalUsersQuery = await db.collection('users').get();
    const totalUsers = totalUsersQuery.size;
    
    // Rank is the number of users with higher points + 1
    // For existing users with no rank yet
    let newRank = higherPointsQuery.size + 1;
    
    // For brand new users, they get placed at the bottom
    if (userDoc.createTime.toMillis() === userDoc.updateTime.toMillis()) {
      newRank = totalUsers;
    }
    
    // Update the user with the calculated rank
    await db.collection('users').doc(userId).update({
      currentRank: newRank,
      updatedAt: new Date().toISOString()
    });
    
    userData.currentRank = newRank;
  }
  
  res.status(200).json(userData);
} catch (error) {
  console.error('Error in getUserById:', error);
  res.status(500).json({ error: error.message });
}
};

// Update user display name
const updateUserName = async (req, res) => {
 
 try {
   const { userId } = req.params;
   const { displayName } = req.body;
   
   // Validate input
   if (!displayName || displayName.trim().length === 0) {
     return res.status(400).json({ message: 'Valid display name is required' });
   }
   
   if (displayName.length > 16) {
     return res.status(400).json({ message: 'Display name cannot exceed 16 characters' });
   }
   
   // Reference to the user document
   const userRef = db.collection('users').doc(userId);
   
   // Check if user exists
   const userDoc = await userRef.get();
   
   if (!userDoc.exists) {
     return res.status(404).json({ message: 'User not found' });
   }
   
   // Update only the display name field in users collection
   await userRef.update({
     displayName: displayName,
     updatedAt: new Date().toISOString()
   });
   
   // NEW: Update the user's name in all leagues where they are a member
   try {
     console.log(`Updating league member names for user ${userId} with new name: ${displayName}`);
     
     // Get all leagues where this user is a member
     const leaguesRef = db.collection('leagues');
     const leaguesSnapshot = await leaguesRef.get();
     
     // Batch update for efficient database operations
     const batch = db.batch();
     let leaguesUpdated = 0;
     
     leaguesSnapshot.forEach(leagueDoc => {
       const leagueData = leagueDoc.data();
       
       // Check if user is in this league's members array
       if (leagueData.members && Array.isArray(leagueData.members)) {
         const memberIndex = leagueData.members.findIndex(member => member.id === userId);
         
         if (memberIndex !== -1) {
           // User found in this league - update their name
           const updatedMembers = [...leagueData.members];
           updatedMembers[memberIndex] = {
             ...updatedMembers[memberIndex],
             name: displayName
           };
           
           // Add this league update to the batch
           const leagueRef = db.collection('leagues').doc(leagueDoc.id);
           batch.update(leagueRef, {
             members: updatedMembers,
             lastActivity: new Date().toISOString()
           });
           
           leaguesUpdated++;
           console.log(`Added league ${leagueDoc.id} to batch update`);
         }
       }
     });
     
     // Commit all league updates
     if (leaguesUpdated > 0) {
       await batch.commit();
       console.log(`Successfully updated ${leaguesUpdated} leagues with new display name`);
     } else {
       console.log('No leagues found for this user');
     }
     
   } catch (leagueUpdateError) {
     console.error('Error updating leagues with new display name:', leagueUpdateError);
     // Don't fail the entire request if league updates fail
     // The user's name is still updated in the users collection
   }
   
   // Return success response
   res.status(200).json({ 
     message: 'Display name updated successfully',
     userId: userId,
     displayName: displayName
   });
   
 } catch (error) {
   console.error('Error in updateUserName:', error);
   res.status(500).json({ error: error.message });
 }
};
// Add this new controller function to update user's trivia points
const updateUserPoints = async (req, res) => {

try {
  const { userId } = req.params;
  const { triviaPoints } = req.body;
  
  // Validate input
  if (triviaPoints === undefined || isNaN(triviaPoints)) {
    return res.status(400).json({ message: 'Valid triviaPoints value is required' });
  }
  
  // Reference to the user document
  const userRef = db.collection('users').doc(userId);
  
  // Check if user exists
  const userDoc = await userRef.get();
  
  if (!userDoc.exists) {
    return res.status(404).json({ message: 'User not found' });
  }
  
  // Update only the triviaPoints field
  await userRef.update({
    triviaPoints: triviaPoints,
    updatedAt: new Date().toISOString()
  });
  
  // After updating points, recalculate rankings for all users
  
  // Get all users ordered by points
  const usersSnapshot = await db.collection('users')
    .orderBy('triviaPoints', 'desc')
    .get();
  
  // Batch update to efficiently update all users
  const batch = db.batch();
  let newRank = 1;
  let updatedUserRank = 0;
  
  // Update ranks for all users
  usersSnapshot.forEach(doc => {
    const userRef = db.collection('users').doc(doc.id);
    batch.update(userRef, { currentRank: newRank });
    
    // If this is the user we just updated, store their new rank
    if (doc.id === userId) {
      updatedUserRank = newRank;
    }
    
    newRank++;
  });
  
  // Commit all ranking updates
  await batch.commit();
  
  // Get top 10 users for leaderboard
  const top10Snapshot = await db.collection('users')
    .orderBy('currentRank', 'asc') // Order by rank
    .limit(10) // Get only top 10
    .get();
  
  // Create array with top 10 user data
  const top10Users = [];
  top10Snapshot.forEach(doc => {
    const userData = doc.data();
    top10Users.push({
      rank: userData.currentRank,
      userId: userData.userId,
      displayName: userData.displayName || `Player_${userData.userId}`,
      triviaPoints: userData.triviaPoints || 0
    });
  });
  
  // Return success response with the new rank and top 10 leaderboard
  res.status(200).json({
    message: 'Trivia points updated successfully',
    userId: userId,
    triviaPoints: triviaPoints,
    currentRank: updatedUserRank,
    leaderboard: top10Users
  });
  
} catch (error) {
  console.error('Error in updateUserPoints:', error);
  res.status(500).json({ error: error.message });
}
};

const getLeaderboard = async (req, res) => {

try {
  // TRACK LEADERBOARD CLICK - Fire and forget (don't block main functionality)
  try {
    const { userId } = req.query; // Get userId from query params if provided
    
    // Reference to the counter document for leaderboard clicks
    const counterRef = db.collection('counters').doc('leaderboardClicks');
    
    // Use a transaction to ensure atomic increment
    db.runTransaction(async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      
      let currentCount = 0;
      if (counterDoc.exists) {
        currentCount = counterDoc.data().totalClicks || 0;
      }
      
      // Increment the counter
      const newCount = currentCount + 1;
      
      // Update the counter document
      transaction.set(counterRef, {
        totalClicks: newCount,
        label: 'LeaderboardClicks',
        lastUpdated: new Date().toISOString(),
        lastClickedBy: userId || 'unknown'
      });
    }).then(() => {
      console.log('Leaderboard click tracked successfully');
    }).catch(trackingError => {
      console.error('Error tracking leaderboard click:', trackingError);
      // Continue with main function even if tracking fails
    });
    
  } catch (trackingError) {
    console.error('Error in leaderboard click tracking:', trackingError);
    // Continue with main function even if tracking fails
  }

  // ORIGINAL LEADERBOARD FUNCTIONALITY (unchanged)
  // Default limit of users to return, can be overridden with query parameter
  let limit = 50;
  if (req.query.limit && !isNaN(req.query.limit)) {
    limit = parseInt(req.query.limit, 10);
    limit = Math.min(limit, 100); // Cap at 100 to prevent excessive data retrieval
  }
  
  // Query the users collection, order by currentRank instead of triviaPoints
  const usersRef = db.collection('users');
  const snapshot = await usersRef
    .orderBy('currentRank', 'asc') // Order by rank low to high
    .limit(limit)
    .get();
  
  // Transform the data to include only what's needed for the leaderboard
  const leaderboardData = [];
  
  snapshot.forEach(doc => {
    const userData = doc.data();
    leaderboardData.push({
      rank: userData.currentRank || 0, // Use stored rank instead of calculating
      userId: userData.userId,
      displayName: userData.displayName || `Player_${userData.userId}`,
      triviaPoints: userData.triviaPoints || 0
    });
  });
  
  // Return the leaderboard data
  res.status(200).json({
    leaderboard: leaderboardData,
    timestamp: new Date().toISOString()
  });
  
} catch (error) {
  console.error('Error in getLeaderboard:', error);
  res.status(500).json({ error: error.message });
}
};

// Simple user retrieval without rank calculations
const getUser = async (req, res) => {
  
  try {
    const { userId } = req.params;
    
    // Get user from Firestore
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Get the user data
    const userData = userDoc.data();
    
    // Calculate the user's level based on their points
    const triviaPoints = userData.triviaPoints || 0;
    const levelInfo = getUserLevel(triviaPoints);
    
    // Add level info to the response
    const responseData = {
      ...userData,
      levelInfo: levelInfo
    };
    
    res.status(200).json(responseData);
  } catch (error) {
    console.error('Error in getUser:', error);
    res.status(500).json({ error: error.message });
  }
};

// Track user connections and provide the count of online users
const trackUserConnection = async (req, res) => {
 
 try {
   const { userId } = req.params;
   
   // Set the user's online status in the Realtime Database
   const userStatusRef = realtime.ref(`online_users/${userId}`);
   
   // Write to the database that user is online with last active timestamp
   await userStatusRef.set({
     status: 'online',
     lastActive: new Date().toISOString(),
     connectionMethod: 'rest' // Mark this as a REST API connection
   });
   
   // Use the Firebase onDisconnect feature to update when user disconnects
   userStatusRef.onDisconnect().update({
     status: 'offline',
     lastActive: new Date().toISOString()
   });
   
   // Get the Socket.IO instance from the Express app
   const io = req.app.get('socketio');
   const connectedUsers = io ? (io.connectedUsers || req.app.get('connectedUsers')) : new Map();

   
   // Broadcast the updated online users count via WebSockets
   if (io) {
     updateOnlineUsersCount(io);
   } else {
     console.warn('Socket.IO instance not found; cannot broadcast online users update');
   }
   
   res.status(200).json({ 
     message: 'Connection tracked successfully',
     userId: userId
   });
   
 } catch (error) {
   console.error('Error in trackUserConnection:', error);
   res.status(500).json({ error: error.message });
 }
};

// Get the count of online users - Keep for backward compatibility
const getOnlineUsersCount = async (req, res) => {
 
 try {
   // Reference to the online users in Realtime Database
   const onlineUsersRef = realtime.ref('online_users');
   
   // Get all users with 'online' status
   const snapshot = await onlineUsersRef.orderByChild('status').equalTo('online').once('value');
   
   // Count the online users
   const onlineCount = snapshot.numChildren();
   
   // Return the count of online users
   res.status(200).json({
     onlineCount: onlineCount,
     timestamp: new Date().toISOString()
   });
   
 } catch (error) {
   console.error('Error in getOnlineUsersCount:', error);
   res.status(500).json({ error: error.message });
 }
};

// Create a multiplayer room
const createRoom = async (req, res) => {
 
 try {
   const { category, creatorId, playerCount, maxPlayers, questions } = req.body;
   
   // Validate input
   if (!category || !creatorId || !questions) {
     return res.status(400).json({ message: 'Category, creatorId, and questions are required' });
   }
   
   // Generate a unique room ID
   const roomId = `R${Date.now().toString(36)}${Math.random().toString(36).substr(2, 5)}`.toUpperCase();
   
   // Create room in Firestore
   const roomRef = db.collection('game_rooms').doc(roomId);
   
   // Set room data including questions and initialize chat activity fields
   await roomRef.set({
     roomId,
     category,
     creatorId,
     playerCount: playerCount || 1,
     maxPlayers: maxPlayers || 5,
     players: [{
       id: creatorId,
       joinedAt: new Date().toISOString(),
       score: 0,
       currentQuestion: 0,
       isHost: true,
       questionTimes: [], // Initialize empty array for question times
       totalTimeSpent: 0  // Initialize total time spent
     }],
     questions, // Store the full question data
     currentQuestionIndex: 0,
     gameState: 'waiting',
     createdAt: new Date().toISOString(),
     chatActivityCounter: 0, // Initialize chat activity counter
     lastChatActivity: null, // Initialize chat activity timestamp as null
     hasMessages: false // New simple flag indicating if room has messages
   });
   
   // Return room details to the frontend
   res.status(201).json({ 
     roomId,
     category,
     creatorId,
     message: 'Room created successfully with questions' 
   });
   
 } catch (error) {
   console.error('Error in createRoom:', error);
   res.status(500).json({ error: error.message });
 }
};

// Join a multiplayer room
const joinRoom = async (req, res) => {
 
 try {
   const { roomId } = req.params;
   const { userId, displayName } = req.body;
   
   // Validate input
   if (!roomId || !userId) {
     return res.status(400).json({ 
       success: false, 
       message: 'Room ID and user ID are required' 
     });
   }
   
   // Get the room from Firestore
   const roomRef = db.collection('game_rooms').doc(roomId);
   const roomDoc = await roomRef.get();
   
   if (!roomDoc.exists) {
     return res.status(404).json({ 
       success: false, 
       message: 'Room not found' 
     });
   }
   
   const roomData = roomDoc.data();
   
   // Check if room is full
   if (roomData.playerCount >= roomData.maxPlayers) {
     return res.status(403).json({ 
       success: false, 
       message: 'Room is full' 
     });
   }
   
   // Check if user is already in the room
   const isAlreadyInRoom = roomData.players.some(player => player.id === userId);
   
   if (isAlreadyInRoom) {
     return res.status(200).json({ 
       success: true, 
       message: 'Already in room',
       room: roomData
     });
   }
   
   // Add user to room with all required fields
   const updatedPlayerCount = roomData.playerCount + 1;
   const updatedPlayers = [...roomData.players, {
     id: userId,
     displayName: displayName || `Player_${userId}`,
     joinedAt: new Date().toISOString(),
     score: 0,
     currentQuestion: 0,
     isHost: false, // Only the creator is the host
     questionTimes: [], // Initialize empty array for question times
     totalTimeSpent: 0  // Initialize total time spent
   }];
   
   // Update the room in Firestore
   await roomRef.update({
     playerCount: updatedPlayerCount,
     players: updatedPlayers
   });
   
   // Return updated room data
   return res.status(200).json({
     success: true,
     message: 'Successfully joined room',
     room: {
       ...roomData,
       playerCount: updatedPlayerCount,
       players: updatedPlayers
     }
   });
   
 } catch (error) {
   console.error('Error in joinRoom:', error);
   res.status(500).json({ 
     success: false, 
     error: error.message 
   });
 }
};

// Get room details
const getRoomById = async (req, res) => {
 
 try {
   const { roomId } = req.params;
   
   // Validate input
   if (!roomId) {
     return res.status(400).json({ message: 'Room ID is required' });
   }
   
   // Get the room from Firestore
   const roomRef = db.collection('game_rooms').doc(roomId);
   const roomDoc = await roomRef.get();
   
   if (!roomDoc.exists) {
     return res.status(404).json({ message: 'Room not found' });
   }
   
   // Return room data
   return res.status(200).json(roomDoc.data());
   
 } catch (error) {
   console.error('Error in getRoomById:', error);
   res.status(500).json({ error: error.message });
 }
};

// Update room game state
const updateRoomState = async (req, res) => {

 try {
   const { roomId } = req.params;
   const { gameState, players } = req.body;
   
   // Validate input
   if (!roomId || !gameState) {
     return res.status(400).json({ message: 'Room ID and game state are required' });
   }
   
   // Get the room from Firestore
   const roomRef = db.collection('game_rooms').doc(roomId);
   const roomDoc = await roomRef.get();
   
   if (!roomDoc.exists) {
     return res.status(404).json({ message: 'Room not found' });
   }
   
   const roomData = roomDoc.data();
   
   // Special handling for 'completed' game state
   if (gameState === 'completed') {
     
     // Get the players from the request or the current room data
     const currentPlayers = players || roomData.players || [];
     
     // Check if all players have completed all questions
     if (roomData.questions && Array.isArray(roomData.questions)) {
       const questionCount = roomData.questions.length;
       const allPlayersCompleted = currentPlayers.every(player => 
         player.currentQuestion >= questionCount
       );
       
       if (!allPlayersCompleted) {
         return res.status(200).json({ 
           success: false, 
           message: 'Cannot mark game as completed until all players finish',
           room: roomData
         });
       }
     }
   }
   
   // Create update object
   const updateData = {
     gameState: gameState,
     updatedAt: new Date().toISOString()
   };
   
   // If players are provided, update players as well
   if (players) {
     updateData.players = players;
   }
   
   // Update the room
   await roomRef.update(updateData);
   
   // If game is being marked as completed, update each player's points
   if (gameState === 'completed' && roomData.players && Array.isArray(roomData.players)) {
     
     // Use the provided players array or the existing one from the room
     const playersToUpdate = players || roomData.players;
     
     // Process each player
     for (const player of playersToUpdate) {
       // Skip if player has no ID or score
       if (!player.id || player.score === undefined) continue;
       
       try {
         const userId = player.id;
         const earnedPoints = player.score;
         
         // Update the user's total points
         const userRef = db.collection('users').doc(userId);
         const userDoc = await userRef.get();
         
         if (userDoc.exists) {
           const userData = userDoc.data();
           const currentPoints = userData.triviaPoints || 0;
           const newTotalPoints = currentPoints + earnedPoints;
           
           await userRef.update({
             triviaPoints: newTotalPoints,
             updatedAt: new Date().toISOString()
           });
         } else {
           console.error(`User ${userId} not found, skipping points update`);
         }
       } catch (userUpdateError) {
         console.error(`Error updating points for user ${player.id}: ${userUpdateError.message}`);
         // Continue with other players if one fails
       }
     }
     
     // Recalculate rankings for all users after all points are updated
     try {
       
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

       // NEW: Update league member scores if this is a league game
       if (roomData.gameType === 'league' && roomData.leagueId) {
         
         try {
           const leagueRef = db.collection('leagues').doc(roomData.leagueId);
           const leagueDoc = await leagueRef.get();
           
           if (leagueDoc.exists) {
             const leagueData = leagueDoc.data();
             const leagueMembers = leagueData.members || [];
             
             // Update each player's league score
             const updatedMembers = leagueMembers.map(member => {
               const gamePlayer = playersToUpdate.find(p => p.id === member.id);
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
           }
         } catch (leagueError) {
           console.error(`Error updating league member scores: ${leagueError.message}`);
         }
       }
     } catch (rankUpdateError) {
       console.error(`Error updating user rankings: ${rankUpdateError.message}`);
       // Continue execution even if ranking update fails
     }
   }
   
   // Get the Socket.IO instance from the Express app
   const io = req.app.get('socketio');
   
   // Trigger WebSocket update if io is available
   if (io) {
     await triggerGameStateUpdate(io, roomId);
   } else {
     console.warn('Socket.IO instance not found; cannot broadcast game state update');
   }
   
   // Return success with the updated room data
   const updatedRoomDoc = await roomRef.get();
   
   return res.status(200).json({ 
     success: true, 
     message: 'Room state updated successfully',
     room: updatedRoomDoc.data()
   });
   
 } catch (error) {
   console.error('Error in updateRoomState:', error);
   res.status(500).json({ error: error.message });
 }
};

const updateGameStateWS = async (req, res) => {
  
  try {
    const { roomId } = req.params;
    const { gameState, players, userId, points, currentQuestion, questionTimes, totalTimeSpent } = req.body;
    
    // Validate input
    if (!roomId) {
      return res.status(400).json({ message: 'Room ID is required' });
    }
    
    // Get the Socket.IO instance from the Express app
    const io = req.app.get('socketio');
    
    if (!io) {
      console.error('Socket.IO instance not found');
      return res.status(500).json({ message: 'WebSocket server not available' });
    }
    
    // Get the game namespace
    const gameNamespace = io.of('/game');
    
    // If this is a player progress update
    if (userId && (points !== undefined || currentQuestion !== undefined)) {
      
      // Include timing data in the event if provided
      const progressUpdate = {
        roomId,
        userId,
        score: points !== undefined ? points : undefined,
        currentQuestion: currentQuestion !== undefined ? currentQuestion : undefined,
        timestamp: new Date().toISOString()
      };
      
      // Add timing data if available
      if (questionTimes) {
        progressUpdate.questionTimes = questionTimes;
        progressUpdate.totalTimeSpent = totalTimeSpent;
      }
      
      // Emit event to update player progress
      gameNamespace.to(roomId).emit('update_player_progress', progressUpdate);
    }
    
    // If this is a game state update
    if (gameState) {
      
      // Emit event to update game state
      gameNamespace.to(roomId).emit('game_state_updated', {
        roomId,
        gameState,
        timestamp: new Date().toISOString()
      });
      
      // If game is completed, send special event
      if (gameState === 'completed') {
        gameNamespace.to(roomId).emit('game_completed', {
          roomId,
          gameState,
          timestamp: new Date().toISOString()
        });
      }
    }
    
    // If players array is provided, broadcast player updates
    if (players && Array.isArray(players)) {
      
      // Emit event to update players
      gameNamespace.to(roomId).emit('players_updated', {
        roomId,
        players,
        timestamp: new Date().toISOString()
      });
    }
    
    // Return success response
    return res.status(200).json({
      success: true,
      message: 'WebSocket update triggered successfully'
    });
    
  } catch (error) {
    console.error('Error in updateGameStateWS:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get messages for a room
// Get messages for a room - MODIFIED to return an empty array with a note
const getRoomMessages = async (req, res) => {
 
 try {
   const { roomId } = req.params;
   
   // Get the room from Firestore
   const roomRef = db.collection('game_rooms').doc(roomId);
   const roomDoc = await roomRef.get();
   
   if (!roomDoc.exists) {
     return res.status(404).json({ message: 'Room not found' });
   }
   
   // Instead of returning messages from the database, return an empty array
   // Messages are now handled via WebSockets and not persisted
   const roomData = roomDoc.data();
   const activityCount = roomData.chatActivityCounter || 0;
   
   // Return empty messages array with note about WebSockets
   res.status(200).json({
     messages: [],
     note: "Chat messages are now handled via WebSockets and not persisted in the database",
     activityCount: activityCount,
     lastActivity: roomData.lastChatActivity || null
   });
   
 } catch (error) {
   console.error('Error in getRoomMessages:', error);
   res.status(500).json({ error: error.message });
 }
};

// Add a message to a room
// Add a message to a room - MODIFIED to only update activity counter, not store full messages
const addRoomMessage = async (req, res) => {
  
  try {
    const { roomId } = req.params;
    const { userId, displayName, message, timestamp } = req.body;
    
    // Validate input
    if (!roomId || !userId || !message) {
      return res.status(400).json({ message: 'Room ID, user ID, and message are required' });
    }
    
    // Skip system messages
    if (userId === 'system') {
      return res.status(200).json({ 
        message: 'System messages are not supported',
        skipped: true 
      });
    }
    
    // Get the room from Firestore
    const roomRef = db.collection('game_rooms').doc(roomId);
    const roomDoc = await roomRef.get();
    
    if (!roomDoc.exists) {
      return res.status(404).json({ message: 'Room not found' });
    }
    
    // Generate a message ID
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Update room document with message flag and activity counters
    // Use a batch to ensure all updates happen together
    const batch = db.batch();
    
    // Update hasMessages flag
    batch.update(roomRef, {
      hasMessages: true
    });
    
    // Update activity counter
    batch.update(roomRef, {
      chatActivityCounter: db.FieldValue.increment(1),
      lastChatActivity: timestamp || new Date().toISOString()
    });
    
    // Commit the batch
    await batch.commit()
      .then(() => {
      })
      .catch(error => {
        console.error(`Batch update failed: ${error.message}`);
        
        // Try one more time with direct update
        roomRef.update({
          hasMessages: true
        }).catch(err => console.error(`Direct flag update failed: ${err.message}`));
      });
    
    // Return success with generated message ID
    res.status(201).json({
      id: messageId,
      userId,
      displayName: displayName || `Player_${userId.substring(0, 5)}`,
      message,
      timestamp: timestamp || new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error in addRoomMessage:', error);
    
    // Even if there's an error, try once more to at least set the flag
    try {
      const roomRef = db.collection('game_rooms').doc(roomId);
      roomRef.update({
        hasMessages: true
      }).catch(err => {});
    } catch (finalError) {
      // Just log and continue
      console.error('Final fallback also failed');
    }
    
    res.status(500).json({ error: error.message });
  }
};
const getOnlinePlayers = async (req, res) => {
  
  try {
    // Reference to the online users in Realtime Database
    const onlineUsersRef = realtime.ref('online_users');
    
    // Get all users with 'online' status
    const snapshot = await onlineUsersRef.orderByChild('status').equalTo('online').once('value');
    
    // Count the online users
    const onlineCount = snapshot.numChildren();
    
    if (onlineCount === 0) {
      // If no online users, return a specific message
      return res.status(200).json({
        players: [],
        message: "No Online Players Available",
        timestamp: new Date().toISOString()
      });
    }
    
    // Get online user IDs from the snapshot
    const onlineUserIds = [];
    snapshot.forEach(childSnapshot => {
      const userId = childSnapshot.key;
      onlineUserIds.push(userId);
    });
    
    // Fetch user details from Firestore
    const usersRef = db.collection('users');
    const playersData = [];
    
    // Using Promise.all to fetch all users in parallel
    await Promise.all(onlineUserIds.map(async (userId) => {
      try {
        const userDoc = await usersRef.doc(userId).get();
        
        if (userDoc.exists) {
          const userData = userDoc.data();
          
          // Calculate user level if needed
          let levelInfo = userData.levelInfo;
          if (!levelInfo) {
            const triviaPoints = userData.triviaPoints || 0;
            levelInfo = getUserLevel(triviaPoints);
          }
          
          // Add user to players array with required fields
          playersData.push({
            userId: userData.userId,
            displayName: userData.displayName || `Player_${userData.userId}`,
            level: levelInfo ? levelInfo.title : 'Beginner',
            triviaPoints: userData.triviaPoints || 0,
            rank: userData.currentRank || 0,
          });
          
        } else {
        }
      } catch (userError) {
        console.error(`Error fetching user data for ${userId}:`, userError);
        // Continue with other users if one fails
      }
    }));
    
    // Sort players by rank in ascending order
    playersData.sort((a, b) => a.rank - b.rank);
    
    // Return the online players data
    return res.status(200).json({
      players: playersData,
      count: playersData.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error in getOnlinePlayers:', error);
    res.status(500).json({ error: error.message });
  }
};
// Create a multiplayer room with invites
// Create a multiplayer room with invites
// Create a multiplayer room with invites
const createRoomWithInvites = async (req, res) => {
 
  try {
    const { category, creatorId, playerCount, maxPlayers, questions, invitedPlayers } = req.body;
   
    // Validate input
    if (!category || !creatorId || !questions || !invitedPlayers) {
      return res.status(400).json({ message: 'Category, creatorId, questions, and invitedPlayers are required' });
    }
   
    if (!Array.isArray(invitedPlayers)) {
      return res.status(400).json({ message: 'invitedPlayers should be an array of user IDs' });
    }
   
    // Generate a unique room ID
    const roomId = `R${Date.now().toString(36)}${Math.random().toString(36).substr(2, 5)}`.toUpperCase();
   
    // Create room in Firestore
    const roomRef = db.collection('game_rooms').doc(roomId);
   
    // Get the creator's user info for inclusion in the invitation
    let creatorDisplayName = `Player_${creatorId}`;
    try {
      const creatorDoc = await db.collection('users').doc(creatorId).get();
      if (creatorDoc.exists) {
        creatorDisplayName = creatorDoc.data().displayName || creatorDisplayName;
      }
    } catch (creatorError) {
      console.error('Error fetching creator display name:', creatorError);
      // Continue with default name if there's an error
    }
   
    // Set room data including questions and initialize chat activity fields
    await roomRef.set({
      roomId,
      category,
      creatorId,
      creatorDisplayName,
      playerCount: playerCount || 1,
      maxPlayers: maxPlayers || 5,
      players: [{
        id: creatorId,
        displayName: creatorDisplayName,
        joinedAt: new Date().toISOString(),
        score: 0,
        currentQuestion: 0,
        isHost: true,
        questionTimes: [], // Initialize empty array for question times
        totalTimeSpent: 0  // Initialize total time spent
      }],
      invitedPlayers, // Store invited players array
      questions, // Store the full question data
      currentQuestionIndex: 0,
      gameState: 'waiting',
      createdAt: new Date().toISOString(),
      chatActivityCounter: 0, // Initialize chat activity counter
      lastChatActivity: null, // Initialize chat activity timestamp as null
      hasMessages: false // New simple flag indicating if room has messages
    });
   
    // Get Socket.IO instance from Express app
    const io = req.app.get('socketio');   
    // Check if Socket.IO is available
    if (io) {
     
      // Get the online users from Realtime Database
      const onlineUsersRef = realtime.ref('online_users');
      const onlineSnapshot = await onlineUsersRef.orderByChild('status').equalTo('online').once('value');
     
      // For each invited player, send an invitation if they're online
      let invitationsSent = 0;
      for (const invitedUserId of invitedPlayers) {
       
        // Check if the invited user is online according to Realtime Database
        const isOnline = onlineSnapshot.child(invitedUserId).exists();
       
        if (isOnline) {
         
          // Create invitation data
          const invitationData = {
            roomId,
            category,
            hostId: creatorId,
            hostName: creatorDisplayName,
            timestamp: new Date().toISOString()
          };
         
          // Use the WebSocket controller function to send the invitation
          const sent = sendGameInvitation(io, invitedUserId, invitationData);
         
          if (sent) {
            invitationsSent++;
          }
        } else {
        }
      }
     
    } else {
    }
   
    // Return room details to the frontend
    res.status(201).json({ 
      roomId,
      category,
      creatorId,
      invitedCount: invitedPlayers.length,
      message: 'Invitation room created successfully' 
    });
   
  } catch (error) {
    console.error('Error in createRoomWithInvites:', error);
    res.status(500).json({ error: error.message });
  }
};

const createLeague = async (req, res) => {
  
  try {
    const { userId, leagueName, creatorName } = req.body;
    
    // Validate input
    if (!userId || !leagueName) {
      return res.status(400).json({ message: 'UserId and leagueName are required' });
    }
    
    // Generate a unique league ID
    const leagueId = `L${Date.now().toString(36)}${Math.random().toString(36).substr(2, 5)}`.toUpperCase();
    
    // Get current date
    const createdDate = new Date();
    
    // Calculate end date (10 months from creation)
    const endDate = new Date(createdDate);
    endDate.setMonth(endDate.getMonth() + 10);
    
    // Format dates for display (DD/MM/YYYY)
    const formatDate = (date) => {
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    };
    
    const formattedCreatedDate = formatDate(createdDate);
    const formattedEndDate = formatDate(endDate);
    
    // Create the first member object (admin)
    const adminMember = {
      id: userId,
      name: creatorName || 'Unknown',
      joinedAt: createdDate.toISOString(),
      score: 0,
      isAdmin: true
    };
    
    // Create league in Firestore
    const leagueRef = db.collection('leagues').doc(leagueId);
    
    // Set league data
    await leagueRef.set({
      leagueId,
      leagueName,
      creatorId: userId,
      creatorName: creatorName || 'Unknown',
      members: [adminMember],
      rooms: [], // Array to store room IDs associated with this league
      leagueState: 'active',
      createdAt: createdDate.toISOString(),
      createdAtFormatted: formattedCreatedDate,
      endDate: endDate.toISOString(),
      endDateFormatted: formattedEndDate,
      leagueFlag: true, // Set the LeagueFlag to True as required
      lastActivity: createdDate.toISOString(),
      memberCount: 1,
      maxMembers: 50 // Optional: set a max number of members
    });
    
    // Return league details to the frontend
    res.status(201).json({
      success: true, 
      leagueId,
      leagueName,
      creatorId: userId,
      admin: {
        id: adminMember.id,
        name: adminMember.name,
        score: adminMember.score
      },
      createdDate: formattedCreatedDate,
      endDate: formattedEndDate,
      memberCount: 1,
      message: 'League created successfully'
    });
      
  } catch (error) {
    console.error('Error in createLeague:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
};
// Update your getUserLeagues function:
const getUserLeagues = async (req, res) => {
  
  try {
    const { userId } = req.params;
    
    // Validate input
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'UserId is required' 
      });
    }
    
    // TRACK LEAGUE ICON CLICK - Fire and forget (don't block main functionality)
    try {
      // Reference to the counter document for league icon clicks
      const counterRef = db.collection('counters').doc('leagueIconClicks');
      
      // Use a transaction to ensure atomic increment
      db.runTransaction(async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
        
        let currentCount = 0;
        if (counterDoc.exists) {
          currentCount = counterDoc.data().totalClicks || 0;
        }
        
        // Increment the counter
        const newCount = currentCount + 1;
        
        // Update the counter document
        transaction.set(counterRef, {
          totalClicks: newCount,
          label: 'LeagueIconClicks',
          lastUpdated: new Date().toISOString(),
          lastClickedBy: userId || 'unknown'
        });
      }).then(() => {
        console.log('League icon click tracked successfully');
      }).catch(trackingError => {
        console.error('Error tracking league icon click:', trackingError);
        // Continue with main function even if tracking fails
      });
      
    } catch (trackingError) {
      console.error('Error in league icon click tracking:', trackingError);
      // Continue with main function even if tracking fails
    }
    
    // ORIGINAL GETUSERLEAGUES FUNCTIONALITY (unchanged)
    // Let's log the structure for debugging
    
    // Modify the query to use a different approach
    const leaguesRef = db.collection('leagues');
    
    // First, get all leagues
    const snapshot = await leaguesRef.get();
    
    if (snapshot.empty) {
      return res.status(200).json({ 
        success: true,
        leagues: [] 
      });
    } else {
    }
    
    // Then filter manually to ensure we're getting the right leagues
    const leagues = [];
    snapshot.forEach(doc => {
      const leagueData = doc.data();
      
      // Check if user is in members array
      const isMember = leagueData.members && Array.isArray(leagueData.members) && 
                       leagueData.members.some(member => member.id === userId);
      
      if (isMember) {
        leagues.push({
          leagueId: leagueData.leagueId,
          leagueName: leagueData.leagueName,
          memberCount: leagueData.memberCount || 
                      (leagueData.members ? leagueData.members.length : 0),
          createdDate: leagueData.createdAtFormatted || 
                      (leagueData.createdAt ? new Date(leagueData.createdAt).toLocaleDateString() : 'Unknown'),
          endDate: leagueData.endDateFormatted || 
                  (leagueData.endDate ? new Date(leagueData.endDate).toLocaleDateString() : 'Unknown'),
          isAdmin: leagueData.creatorId === userId
        });
      }
    });
    
    // Sort by creation date (newest first)
    leagues.sort((a, b) => {
      const dateA = new Date(a.createdDate).getTime();
      const dateB = new Date(b.createdDate).getTime();
      return dateB - dateA;
    });
    
    return res.status(200).json({
      success: true,
      leagues
    });
      
  } catch (error) {
    console.error('Error in getUserLeagues:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
};
// Add this new function to your backend API file (where your other league-related functions are)

const getLeagueDetails = async (req, res) => {
  
  try {
    const { leagueId } = req.params;
    const { userId } = req.query;
    
    // Validate input
    if (!leagueId) {
      return res.status(400).json({ 
        success: false, 
        message: 'LeagueId is required' 
      });
    }
    
    // Get the league document from Firestore
    const leagueRef = db.collection('leagues').doc(leagueId);
    const leagueDoc = await leagueRef.get();
    
    if (!leagueDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        message: 'League not found' 
      });
    }
    
    const leagueData = leagueDoc.data();
    
    // Calculate member count
    const memberCount = leagueData.memberCount || 
                      (leagueData.members ? leagueData.members.length : 0);
    
    // Get start date
    const startDate = leagueData.createdAtFormatted || 
                     (leagueData.createdAt ? new Date(leagueData.createdAt).toLocaleDateString() : 'Unknown');
    
    // Get end date (if it exists) or calculate it (10 months from start)
    let endDate;
    if (leagueData.endDateFormatted) {
      endDate = leagueData.endDateFormatted;
    } else if (leagueData.endDate) {
      endDate = new Date(leagueData.endDate).toLocaleDateString();
    } else if (leagueData.createdAt) {
      // Calculate end date (10 months from creation)
      const endDateObj = new Date(leagueData.createdAt);
      endDateObj.setMonth(endDateObj.getMonth() + 10);
      // Format date as DD/MM/YYYY
      const day = String(endDateObj.getDate()).padStart(2, '0');
      const month = String(endDateObj.getMonth() + 1).padStart(2, '0');
      const year = endDateObj.getFullYear();
      endDate = `${day}/${month}/${year}`;
    } else {
      endDate = 'Unknown';
    }
    
    // Determine if the requesting user is an admin
    const isAdmin = userId ? leagueData.creatorId === userId : false;
    
    // Process members list
    const members = (leagueData.members || []).map(member => ({
      id: member.id,
      name: member.name || 'Unknown',
      score: member.score || 0,
      isAdmin: member.isAdmin || false,
      rank: 0 // Will be calculated below
    }));
    
    // Sort members by score (highest first) and assign ranks
    members.sort((a, b) => b.score - a.score);
    members.forEach((member, index) => {
      member.rank = index + 1;
    });
    
    // Create the response object
    const leagueDetails = {
      leagueId: leagueData.leagueId,
      leagueName: leagueData.leagueName,
      memberCount,
      startDate,
      endDate,
      isAdmin,
      creatorName: leagueData.creatorName || 'Unknown',
      members,
      leagueState: leagueData.leagueState || 'active'
    };
    
    return res.status(200).json({
      success: true,
      leagueDetails
    });
      
  } catch (error) {
    console.error('Error in getLeagueDetails:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
};
// Add this function to your backend API file where other league-related functions are defined

const joinLeague = async (req, res) => {
  
  try {
    const { leagueCode } = req.params; // Get the league code from URL params
    const { userId, displayName } = req.body; // Get user data from request body
    
    // Validate input
    if (!leagueCode || !userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'League code and userId are required' 
      });
    }
    
    // Find the league in Firestore by leagueId
    const leagueRef = db.collection('leagues').doc(leagueCode);
    const leagueDoc = await leagueRef.get();
    
    // Check if league exists
    if (!leagueDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        message: 'League not found. Please check the code and try again.' 
      });
    }
    
    const leagueData = leagueDoc.data();
    
    // Check if league is active
    if (leagueData.leagueState !== 'active') {
      return res.status(403).json({ 
        success: false, 
        message: 'This league is no longer active.' 
      });
    }
    
    // Check if user is already a member
    const isAlreadyMember = leagueData.members.some(member => member.id === userId);
    if (isAlreadyMember) {
      return res.status(200).json({ 
        success: true, 
        message: 'You are already a member of this league!',
        alreadyMember: true
      });
    }
    
    // Check if league has reached max members
    if (leagueData.memberCount >= leagueData.maxMembers) {
      return res.status(403).json({ 
        success: false, 
        message: 'This league has reached its maximum capacity.' 
      });
    }
    
    // Create new member object
    const newMember = {
      id: userId,
      name: displayName || `Player_${userId}`,
      joinedAt: new Date().toISOString(),
      score: 0,
      isAdmin: false
    };
    
    // Update league document - add new member and increment count
    await leagueRef.update({
      members: admin.firestore.FieldValue.arrayUnion(newMember),
      memberCount: admin.firestore.FieldValue.increment(1),
      lastActivity: new Date().toISOString()
    });
    
    // Return success response
    return res.status(200).json({
      success: true,
      message: 'You have successfully joined the league!',
      leagueId: leagueCode,
      leagueName: leagueData.leagueName
    });
    
  } catch (error) {
    console.error('Error in joinLeague:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'An error occurred while joining the league'
    });
  }
};

// Create a league game
// Create a league game
const createLeagueGame = async (req, res) => {
  
  try {
    const { leagueId } = req.params;
    const { category, creatorId, questions, leagueName } = req.body;
    
    // Validate input
    if (!leagueId || !category || !creatorId || !questions) {
      return res.status(400).json({ 
        success: false,
        message: 'LeagueId, category, creatorId, and questions are required' 
      });
    }
    
    // Generate a unique room ID
    const roomId = `LR${Date.now().toString(36)}${Math.random().toString(36).substr(2, 5)}`.toUpperCase();
    
    // Get the league document reference
    const leagueRef = db.collection('leagues').doc(leagueId);
    
    // Update the league document to add this room ID to the rooms array
    await leagueRef.update({
      rooms: admin.firestore.FieldValue.arrayUnion(roomId),
      lastActivity: new Date().toISOString()
    });
    
    // Get creator's display name
    let creatorDisplayName = `Player_${creatorId}`;
    try {
      const creatorDoc = await db.collection('users').doc(creatorId).get();
      if (creatorDoc.exists) {
        creatorDisplayName = creatorDoc.data().displayName || creatorDisplayName;
      }
    } catch (creatorError) {
      console.error('Error fetching creator display name:', creatorError);
    }
    
    // Create the game room in game_rooms collection
    const roomRef = db.collection('game_rooms').doc(roomId);
    
    await roomRef.set({
      roomId,
      category,
      creatorId,
      creatorDisplayName,
      playerCount: 1,
      maxPlayers: 10, // League games can have more players
      players: [{
        id: creatorId,
        displayName: creatorDisplayName,
        joinedAt: new Date().toISOString(),
        score: 0,
        currentQuestion: 0,
        isHost: true,
        questionTimes: [],
        totalTimeSpent: 0
      }],
      questions,
      currentQuestionIndex: 0,
      gameState: 'waiting',
      createdAt: new Date().toISOString(),
      chatActivityCounter: 0,
      lastChatActivity: null,
      hasMessages: false,
      // League-specific fields
      gameType: 'league',
      leagueId: leagueId,
      leagueName: leagueName || 'Unknown League'
    });

    const leagueDoc = await leagueRef.get();
    if (!leagueDoc.exists) {
    } else {
      const leagueData = leagueDoc.data();
      
      if (leagueData.members && Array.isArray(leagueData.members)) {
        
        // Get member IDs excluding the creator
        const memberIds = leagueData.members
          .filter(member => member.id !== creatorId)
          .map(member => member.id);
        
        // Check online status for each member
        const onlineMembers = [];
        
        for (const memberId of memberIds) {
          try {
            // Check if member is online in Realtime Database
            const userStatusRef = realtime.ref(`online_users/${memberId}`);
            const statusSnapshot = await userStatusRef.once('value');
            
            if (statusSnapshot.exists()) {
              const statusData = statusSnapshot.val();
              if (statusData.status === 'online') {
                onlineMembers.push(memberId);
              } else {
              }
            } else {
            }
          } catch (statusError) {
            console.error(`Error checking status for member ${memberId}:`, statusError);
          }
        }
        
        // Get Socket.IO instance from Express app
        const io = req.app.get('socketio');
        
        if (io && onlineMembers.length > 0) {
          
          // Send invitation to each online member
          for (const memberId of onlineMembers) {
            
            // Create invitation data specifically for league games
            const leagueInvitationData = {
              roomId: roomId,
              category: category,
              hostId: creatorId,
              hostName: creatorDisplayName,
              leagueName: leagueName || 'Unknown League',
              leagueId: leagueId,
              gameType: 'league',
              timestamp: new Date().toISOString()
            };
            
            // Send league game invitation
            sendLeagueGameInvitation(io, memberId, leagueInvitationData);
          }
          
        } else if (!io) {
        } else {
        }
      }
    }

    // Return success response - ONLY ONCE
    return res.status(201).json({
      success: true,
      roomId: roomId,
      message: 'League game room created successfully'
    });
    
  } catch (error) {
    console.error('Error in createLeagueGame:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
};

const trackSinglePlayerClick = async (req, res) => {
  try {
    const { userId } = req.body; // Optional: track which user clicked
    
    // Reference to the counter document for single player clicks
    const counterRef = db.collection('counters').doc('singlePlayerClicks');
    
    // Use a transaction to ensure atomic increment
    await db.runTransaction(async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      
      let currentCount = 0;
      if (counterDoc.exists) {
        currentCount = counterDoc.data().totalClicks || 0;
      }
      
      // Increment the counter
      const newCount = currentCount + 1;

      // Update the counter document
      transaction.set(counterRef, {
        totalClicks: newCount,
        label: 'SinglePlayerClicks',
        lastUpdated: new Date().toISOString(),
        lastClickedBy: userId || 'unknown'
      });
    });
    
    console.log('Single player click tracked successfully');
    
    // Return quick success response (don't make frontend wait)
    res.status(200).json({ 
      success: true,
      message: 'Click tracked'
    });
    
  } catch (error) {
    console.error('Error tracking single player click:', error);
    // Return success even on error to not impact frontend flow
    res.status(200).json({ 
      success: true,
      message: 'Click received'
    });
  }
};

const trackMultiplayerClick = async (req, res) => {
  try {
    const { userId } = req.body; // Optional: track which user clicked
    
    // Reference to the counter document for multiplayer clicks
    const counterRef = db.collection('counters').doc('multiplayerClicks');
    
    // Use a transaction to ensure atomic increment
    await db.runTransaction(async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      
      let currentCount = 0;
      if (counterDoc.exists) {
        currentCount = counterDoc.data().totalClicks || 0;
      }
      
      // Increment the counter
      const newCount = currentCount + 1;
      
      // Update the counter document
      transaction.set(counterRef, {
        totalClicks: newCount,
        label: 'MultiplayerClicks',
        lastUpdated: new Date().toISOString(),
        lastClickedBy: userId || 'unknown'
      });
    });
    
    console.log('Multiplayer click tracked successfully');
    
    // Return quick success response (don't make frontend wait)
    res.status(200).json({ 
      success: true,
      message: 'Click tracked'
    });
    
  } catch (error) {
    console.error('Error tracking multiplayer click:', error);
    // Return success even on error to not impact frontend flow
    res.status(200).json({ 
      success: true,
      message: 'Click received'
    });
  }
};


const trackShareClick = async (req, res) => {
  try {
    const { userId } = req.body; // Optional: track which user clicked
    
    // Reference to the counter document for share button clicks
    const counterRef = db.collection('counters').doc('shareButtonClicks');
    
    // Use a transaction to ensure atomic increment
    await db.runTransaction(async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      
      let currentCount = 0;
      if (counterDoc.exists) {
        currentCount = counterDoc.data().totalClicks || 0;
      }
      
      // Increment the counter
      const newCount = currentCount + 1;
      
      // Update the counter document
      transaction.set(counterRef, {
        totalClicks: newCount,
        label: 'ShareButtonClicks',
        lastUpdated: new Date().toISOString(),
        lastClickedBy: userId || 'unknown'
      });
    });
    
    console.log('Share button click tracked successfully');
    
    // Return quick success response (don't make frontend wait)
    res.status(200).json({ 
      success: true,
      message: 'Share click tracked'
    });
    
  } catch (error) {
    console.error('Error tracking share button click:', error);
    // Return success even on error to not impact frontend flow
    res.status(200).json({ 
      success: true,
      message: 'Click received'
    });
  }
};

const awardDailyLoginBonus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { timestamp } = req.body;
    
    // Validate input
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'UserId is required' 
      });
    }
    
    // Get today's date string (YYYY-MM-DD format for consistency)
    // const today = new Date().toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0] + '_' + new Date().getHours();

    // Reference to the user document
    const userRef = db.collection('users').doc(userId);
    
    // Check if user exists
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    
    const userData = userDoc.data();
    
    // Check if user already received bonus today
    const lastDailyBonus = userData.lastDailyBonusDate;
    
    if (lastDailyBonus === today) {
      return res.status(200).json({ 
        success: false, 
        message: 'Daily bonus already claimed today',
        alreadyClaimed: true
      });
    }
    
    // Award daily bonus points (100 points)
    const bonusPoints = 100;
    const currentPoints = userData.triviaPoints || 0;
    const newTotalPoints = currentPoints + bonusPoints;
    
    // Update user document with new points and bonus date
    await userRef.update({
      triviaPoints: newTotalPoints,
      lastDailyBonusDate: today,
      lastDailyBonusAmount: bonusPoints,
      lastDailyBonusTimestamp: timestamp || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    
    // Recalculate user rankings after points update
    try {
      // Get all users ordered by points
      const usersSnapshot = await db.collection('users')
        .orderBy('triviaPoints', 'desc')
        .get();
      
      // Batch update to efficiently update all users
      const batch = db.batch();
      let newRank = 1;
      let updatedUserRank = 0;
      
      // Update ranks for all users
      usersSnapshot.forEach(doc => {
        const userRefBatch = db.collection('users').doc(doc.id);
        batch.update(userRefBatch, { currentRank: newRank });
        
        // If this is the user we just updated, store their new rank
        if (doc.id === userId) {
          updatedUserRank = newRank;
        }
        
        newRank++;
      });
      
      // Commit all ranking updates
      await batch.commit();
      
      // TRACK DAILY BONUS AWARD - Fire and forget
      try {
        const counterRef = db.collection('counters').doc('dailyBonusAwarded');
        
        db.runTransaction(async (transaction) => {
          const counterDoc = await transaction.get(counterRef);
          
          let currentCount = 0;
          if (counterDoc.exists) {
            currentCount = counterDoc.data().totalAwarded || 0;
          }
          
          const newCount = currentCount + 1;
          
          transaction.set(counterRef, {
            totalAwarded: newCount,
            label: 'DailyBonusAwarded',
            lastUpdated: new Date().toISOString(),
            lastAwardedTo: userId,
            lastBonusAmount: bonusPoints
          });
        }).catch(trackingError => {
          console.error('Error tracking daily bonus award:', trackingError);
        });
        
      } catch (trackingError) {
        console.error('Error in daily bonus tracking:', trackingError);
      }
      
      // Return success response with updated data
      return res.status(200).json({
        success: true,
        message: 'Daily login bonus awarded successfully!',
        bonusPoints: bonusPoints,
        totalPoints: newTotalPoints,
        currentRank: updatedUserRank,
        userId: userId
      });
      
    } catch (rankUpdateError) {
      console.error('Error updating user rankings after daily bonus:', rankUpdateError);
      
      // Still return success since the points were awarded successfully
      return res.status(200).json({
        success: true,
        message: 'Daily login bonus awarded (ranking update pending)',
        bonusPoints: bonusPoints,
        totalPoints: newTotalPoints,
        userId: userId
      });
    }
    
  } catch (error) {
    console.error('Error in awardDailyLoginBonus:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
};

const checkDailyBonusAvailability = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'UserId is required' 
      });
    }
    
    // Get today's date string
    const today = new Date().toISOString().split('T')[0];
    
    // Get user document
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    
    const userData = userDoc.data();
    const lastDailyBonus = userData.lastDailyBonusDate;
    
    // Check if bonus is available today
    const isAvailable = lastDailyBonus !== today;
    
    return res.status(200).json({
      success: true,
      bonusAvailable: isAvailable,
      lastClaimedDate: lastDailyBonus || null,
      today: today
    });
    
  } catch (error) {
    console.error('Error in checkDailyBonusAvailability:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
};



module.exports = {
 generateUserId,
 getUserById,
 updateUserName,
 getUserLevelInfo,
 updateUserPoints,
 getLeaderboard,
 getUser,
 trackUserConnection,
 getOnlineUsersCount,
 createRoom,
 joinRoom,
 getRoomById,
 updateRoomState,
 getRoomMessages,
 addRoomMessage,
 updateGameStateWS,
 getOnlinePlayers,
 createRoomWithInvites,
 createLeague,
 getUserLeagues,
 getLeagueDetails,
 joinLeague,
 createLeagueGame,
 trackSinglePlayerClick,
 trackMultiplayerClick,
 trackShareClick,
 awardDailyLoginBonus,
 checkDailyBonusAvailability
};

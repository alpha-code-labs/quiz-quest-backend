// Complete file with all necessary imports and exports for chat WebSocket server
const { db, realtime } = require('./config/firebase-config');

// Track active chat rooms and their users
const activeRooms = new Map();

/**
 * Setup WebSocket handlers for chat functionality
 * @param {Object} io - Socket.IO server instance
 */
const setupChatWebSockets = (io) => {
  const chatNamespace = io.of('/chat');
  
  chatNamespace.on('connection', (socket) => {
    
    // Handle user joining a specific chat room
    socket.on('join_chat_room', ({ roomId, userId }) => {
      if (!roomId || !userId) return;
      
      
      // Join the room
      socket.join(roomId);
      
      // Store user information
      if (!activeRooms.has(roomId)) {
        activeRooms.set(roomId, new Set());
      }
      activeRooms.get(roomId).add(userId);
      
      // Store socket id -> roomId mapping for disconnection handling
      socket.data.roomId = roomId;
      socket.data.userId = userId;
      
      // Update room activity counter in Firestore
      updateRoomActivity(roomId);
      
      // Notify room that user has joined
      socket.to(roomId).emit('user_joined_chat', { 
        userId, 
        timestamp: new Date().toISOString()
      });
    });
    
    // Handle user leaving a chat room
    socket.on('leave_chat_room', ({ roomId, userId }) => {
      if (!roomId || !userId) return;
      
      leaveRoom(socket, roomId, userId);
    });
    
    // Handle new chat messages
    socket.on('send_chat_message', ({ roomId, message }) => {
      if (!roomId || !message) return;
      
      // Skip if it's a system message
      if (message.userId === 'system') {
        return;
      }
      
      
      // Generate a unique ID for the message
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Add ID to message if not already present
      const messageWithId = {
        ...message,
        id: message.id || messageId 
      };
      
      // Set timestamp if not provided
      if (!messageWithId.timestamp) {
        messageWithId.timestamp = new Date().toISOString();
      }
      
      // Broadcast the message to all users in the room
      chatNamespace.to(roomId).emit('new_chat_message', messageWithId);
      
      // Update room activity counter in Firestore (no message content)
      updateRoomActivity(roomId);
      
      // Also attempt a direct update as a backup
      try {
        const roomRef = db.collection('game_rooms').doc(roomId);
        roomRef.update({
          hasMessages: true
        }).catch(err => console.error(`Backup flag update failed: ${err.message}`));
      } catch (error) {
        console.error('Error in backup flag update:', error);
      }
    });
    
    // Handle disconnections
    socket.on('disconnect', () => {
      const { roomId, userId } = socket.data;
      
      if (roomId && userId) {
        console.log(`User ${userId} disconnected from chat room ${roomId}`);
        leaveRoom(socket, roomId, userId);
      }
    });
  });
  
  console.log('Chat WebSocket handlers initialized');
};

/**
 * Handle a user leaving a room
 * @param {Object} socket - Socket instance
 * @param {string} roomId - Room ID
 * @param {string} userId - User ID
 */
const leaveRoom = (socket, roomId, userId) => {
  // Leave the Socket.IO room
  socket.leave(roomId);
  
  // Remove user from active users in room
  if (activeRooms.has(roomId)) {
    activeRooms.get(roomId).delete(userId);
    
    // Clean up empty rooms
    if (activeRooms.get(roomId).size === 0) {
      activeRooms.delete(roomId);
    }
  }
  
  // Notify room that user has left
  socket.to(roomId).emit('user_left_chat', { 
    userId, 
    timestamp: new Date().toISOString()
  });
  
  // Clear socket data
  socket.data.roomId = null;
  socket.data.userId = null;
};

/**
 * Update room activity counter in Firestore
 * Only tracks that activity happened, not specific messages
 * @param {string} roomId - Room ID
 */
const updateRoomActivity = async (roomId) => {
  try {
    if (!roomId) {
      console.error('Invalid room ID provided to updateRoomActivity');
      return;
    }

    console.log(`Updating chat activity for room ${roomId}`);
    
    // Get reference to the room document
    const roomRef = db.collection('game_rooms').doc(roomId);
    
    // First check if the room exists
    const roomDoc = await roomRef.get();
    if (!roomDoc.exists) {
      console.error(`Room ${roomId} not found, cannot update activity`);
      return;
    }
    
    // Create update object with all fields to ensure they exist
    const updateData = {
      chatActivityCounter: db.FieldValue.increment(1),
      lastChatActivity: new Date().toISOString(),
      hasMessages: true // Simple flag that the room has messages
    };
    
    // Use a transaction to ensure atomic updates
    await db.runTransaction(async (transaction) => {
      // Get the current document in the transaction
      const doc = await transaction.get(roomRef);
      
      if (!doc.exists) {
        throw new Error(`Room ${roomId} not found in transaction`);
      }
      
      // Update the document in the transaction
      transaction.update(roomRef, updateData);
    });
    
    console.log(`Successfully updated chat activity for room ${roomId}`);
  } catch (error) {
    console.error(`Error updating chat activity for room ${roomId}:`, error);
    
    // Try a direct update as fallback if transaction fails
    try {
      console.log(`Attempting direct update for room ${roomId} as fallback`);
      const roomRef = db.collection('game_rooms').doc(roomId);
      
      await roomRef.update({
        chatActivityCounter: db.FieldValue.increment(1),
        lastChatActivity: new Date().toISOString(),
        hasMessages: true
      });
      
      console.log(`Fallback update successful for room ${roomId}`);
    } catch (fallbackError) {
      console.error(`Fallback update also failed for room ${roomId}:`, fallbackError);
    }
  }
};

module.exports = {
  setupChatWebSockets,
  updateRoomActivity
};
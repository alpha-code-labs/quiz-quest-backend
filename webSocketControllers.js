const { realtime } = require('./config/firebase-config');  

// Track connected sockets and their user IDs 
const connectedUsers = new Map();  

// Setup Socket.IO connection handling for user tracking 
const setupSocketIO = (io) => {   
  // Store the connectedUsers map on the app for use in route handlers
  if (io && io.sockets && io.sockets.adapter && io.sockets.adapter.sids) {
    // Store connectedUsers on io object itself
    io.connectedUsers = connectedUsers;
  }
  
  io.on('connection', (socket) => {     
    console.log('New client connected', socket.id);          
    
    // Handle user identification     
    socket.on('identify_user', async (userId) => {       
      if (!userId) return;              
      
      console.log(`User identified: ${userId} (Socket: ${socket.id})`);              
      
      // Store the user ID with this socket (note: we store userId by socketId)      
      connectedUsers.set(socket.id, userId);
      
      // Also store the reverse mapping for lookups by userId
      // This will help us find a socket by userId when sending invitations
      socket.data.userId = userId;              
      
      try {         
        // Mark user as online in Firebase         
        const userStatusRef = realtime.ref(`online_users/${userId}`);         
        await userStatusRef.set({           
          status: 'online',           
          lastActive: new Date().toISOString(),           
          socketId: socket.id         
        });                  
        
        // Broadcast updated count to all clients         
        broadcastOnlineCount(io);       
      } catch (error) {         
        console.error('Error updating user status:', error);       
      }     
    });          
    
    // Handle disconnection     
    socket.on('disconnect', async () => {       
      console.log(`Client disconnected: ${socket.id}`);              
      
      // Get the userId associated with this socket       
      const userId = connectedUsers.get(socket.id);              
      
      if (userId) {         
        try {           
          // Mark user as offline in Firebase           
          const userStatusRef = realtime.ref(`online_users/${userId}`);           
          await userStatusRef.update({             
            status: 'offline',             
            lastActive: new Date().toISOString()           
          });                      
          
          // Remove from our tracking Map           
          connectedUsers.delete(socket.id);                      
          
          // Broadcast updated count to all clients           
          broadcastOnlineCount(io);         
        } catch (error) {           
          console.error('Error updating user status on disconnect:', error);         
        }       
      } else {         
        // If we don't have the userId in our map, search Firebase         
        try {           
          const onlineUsersRef = realtime.ref('online_users');           
          const snapshot = await onlineUsersRef.orderByChild('socketId').equalTo(socket.id).once('value');                      
          
          // If we found a user with this socket ID           
          if (snapshot.exists()) {             
            snapshot.forEach((childSnapshot) => {               
              const userId = childSnapshot.key;               
              console.log(`Marking user ${userId} as offline`);                              
              
              // Mark user as offline               
              childSnapshot.ref.update({                 
                status: 'offline',                 
                lastActive: new Date().toISOString()               
              });             
            });                          
            
            // Broadcast updated count             
            broadcastOnlineCount(io);           
          }         
        } catch (error) {           
          console.error('Error finding user by socket ID:', error);         
        }       
      }     
    });   
  });      
  
  console.log('User tracking WebSocket handlers initialized'); 
};  

// Function to count online users and broadcast to all clients 
const broadcastOnlineCount = async (io) => {   
  try {     
    // Count online users from Firebase     
    const onlineUsersRef = realtime.ref('online_users');     
    const snapshot = await onlineUsersRef.orderByChild('status').equalTo('online').once('value');     
    const onlineCount = snapshot.numChildren();          
    
    console.log(`Broadcasting online users count: ${onlineCount}`);          
    
    // Broadcast to all connected clients     
    io.emit('online_users_count', {       
      onlineCount: onlineCount,       
      timestamp: new Date().toISOString()     
    });   
  } catch (error) {     
    console.error('Error broadcasting online count:', error);   
  } 
};  

// Function to manually trigger a broadcast (for use in REST API endpoints) 
const updateOnlineUsersCount = (io) => {   
  broadcastOnlineCount(io); 
};  

// New function to find a socket by userId
const findSocketByUserId = (userId) => {
  // Loop through each socket in connectedUsers
  for (const [socketId, connectedUserId] of connectedUsers.entries()) {
    if (connectedUserId === userId) {
      // Found the socket for this user
      return socketId;
    }
  }
  
  // No socket found for this user
  return null;
};

// New function to send game invitation to a user
const sendGameInvitation = (io, userId, invitationData) => {
  try {
    // Find the socket for this user
    const socketId = findSocketByUserId(userId);
    
    if (socketId) {
      console.log(`Sending game invitation to user ${userId} via socket ${socketId}`);
      
      // Emit the invitation event to this specific socket
      io.to(socketId).emit('game_invitation', invitationData);
      return true;
    } else {
      console.log(`No active socket found for user ${userId}, cannot send invitation`);
      return false;
    }
  } catch (error) {
    console.error(`Error sending game invitation to user ${userId}:`, error);
    return false;
  }
};

// New function to send league game invitation to a user
const sendLeagueGameInvitation = (io, userId, invitationData) => {
  try {
    // Find the socket for this user
    const socketId = findSocketByUserId(userId);
    
    if (socketId) {
      console.log(`Sending league game invitation to user ${userId} via socket ${socketId}`);
      
      // Emit the league game invitation event to this specific socket
      io.to(socketId).emit('league_game_invitation', invitationData);
      return true;
    } else {
      console.log(`No active socket found for user ${userId}, cannot send league invitation`);
      return false;
    }
  } catch (error) {
    console.error(`Error sending league game invitation to user ${userId}:`, error);
    return false;
  }
};
// Export all necessary functions and data
module.exports = {   
  setupSocketIO,   
  updateOnlineUsersCount,
  sendGameInvitation,
  sendLeagueGameInvitation,
  connectedUsers
};
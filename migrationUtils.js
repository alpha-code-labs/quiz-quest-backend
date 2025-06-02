// migrationUtils.js
const { db } = require('./config/firebase-config');

// Migrate existing rooms to add message flags
const migrateExistingRooms = async () => {
  try {
    console.log('Starting migration of existing rooms to add message flags');
    
    // Get all rooms from Firestore
    const roomsSnapshot = await db.collection('game_rooms').get();
    
    if (roomsSnapshot.empty) {
      console.log('No rooms found to migrate');
      return;
    }
    
    // Count of rooms
    console.log(`Found ${roomsSnapshot.size} rooms to check`);
    
    // Use a batched write for efficiency
    const batchSize = 500; // Firestore limit is 500 operations per batch
    let batch = db.batch();
    let operationCount = 0;
    let migratedCount = 0;
    
    // Process each room
    for (const doc of roomsSnapshot.docs) {
      const roomData = doc.data();
      const roomRef = doc.ref;
      
      // Check if message fields are missing
      const needsMigration = 
        roomData.chatActivityCounter === undefined || 
        roomData.lastChatActivity === undefined ||
        roomData.hasMessages === undefined;
      
      if (needsMigration) {
        // Determine if room likely has messages based on other data
        // This is a best guess since we're not storing the actual messages
        const hasMessages = roomData.chatActivityCounter > 0 || 
                          (roomData.lastChatActivity !== null && 
                          roomData.lastChatActivity !== undefined);
        
        // Update the document
        batch.update(roomRef, {
          chatActivityCounter: roomData.chatActivityCounter || 0,
          lastChatActivity: roomData.lastChatActivity || null,
          hasMessages: hasMessages || false
        });
        
        operationCount++;
        migratedCount++;
        
        // If we've reached the batch size limit, commit and start a new batch
        if (operationCount >= batchSize) {
          console.log(`Committing batch of ${operationCount} operations`);
          await batch.commit();
          batch = db.batch();
          operationCount = 0;
        }
      }
    }
    
    // Commit any remaining operations
    if (operationCount > 0) {
      console.log(`Committing final batch of ${operationCount} operations`);
      await batch.commit();
    }
    
    console.log(`Migration completed. Migrated ${migratedCount} rooms.`);
  } catch (error) {
    console.error('Error migrating existing rooms:', error);
  }
};

module.exports = {
  migrateExistingRooms
};
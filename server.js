const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');

// Import routes
const routes = require('./routes');

// Import WebSocket controllers with connectedUsers
const { setupSocketIO, updateOnlineUsersCount, connectedUsers } = require('./webSocketControllers');
const { setupChatWebSockets } = require('./chatWebSocketController');
const { setupGameStateWebSockets } = require('./gameStateWebSocketController');

// Import migration utility
const { migrateExistingRooms } = require('./migrationUtils');
const { db } = require('./config/firebase-config');

console.log('Server initialization started');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();

// Create HTTP server with Express
const server = http.createServer(app);

// Initialize Socket.IO with CORS configuration
const io = new Server(server, {
  cors: {
    origin: "*", // For development - restrict this in production
    methods: ["GET", "POST"]
  }
});

// Store io instance on app for use in route handlers
app.set('socketio', io);

// Store connectedUsers map on app for use in route handlers
app.set('connectedUsers', connectedUsers);

// Middleware
console.log('Adding middleware');
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Routes
console.log('Setting up routes');
app.use('/api', routes);

// Basic health check route
app.get('/', (req, res) => {
  console.log('Health check route accessed');
  res.send('QuizQuest API is running');
});

// Initialize WebSocket handlers
setupSocketIO(io, app); // User tracking
setupChatWebSockets(io); // Chat functionality
setupGameStateWebSockets(io); // Game state updates

// Run migrations
(async () => {
  try {
    console.log('Checking if migrations are needed...');
    
    // Check if migrations have been run already
    const migrationsRef = db.collection('system').doc('migrations');
    const migrationsDoc = await migrationsRef.get();
    
    if (!migrationsDoc.exists || !migrationsDoc.data().roomMessageFlagMigration) {
      console.log('Running room message flag migration...');
      await migrateExistingRooms();
      
      // Record that migration was run
      await migrationsRef.set({
        roomMessageFlagMigration: {
          completedAt: new Date().toISOString(),
          status: 'completed'
        }
      }, { merge: true });
      
      console.log('Migration completed and recorded');
    } else {
      console.log('Room message flag migration already completed, skipping');
    }
  } catch (error) {
    console.error('Error with migrations:', error);
    // Continue server startup even if migration fails
  }
})();

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error in middleware:', err.stack);
  res.status(500).send({ error: 'Something went wrong!' });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Server is accessible at http://localhost:${PORT}`);
  console.log('WebSocket server running on the same port');
});
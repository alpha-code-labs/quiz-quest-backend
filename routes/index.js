const express = require('express');
const router = express.Router();
const controllers = require('../controllers');

// Generate user ID route
router.get('/generate-user', controllers.generateUserId);

// Get user by ID route
router.get('/users/:userId', controllers.getUserById);

// Update user display name route
router.put('/users/:userId/name', controllers.updateUserName);

// Update user trivia points route
router.put('/users/:userId', controllers.updateUserPoints);

// Get user level info
router.get('/users/:userId/level', controllers.getUserLevelInfo);

router.get('/leaderboard', controllers.getLeaderboard);

router.get('/user/:userId', controllers.getUser);

// New routes for online user tracking
router.post('/users/:userId/connection', controllers.trackUserConnection);
router.get('/online-users/count', controllers.getOnlineUsersCount);

router.post('/rooms', controllers.createRoom);
router.get('/rooms/:roomId', controllers.getRoomById);
router.post('/rooms/:roomId/join', controllers.joinRoom);
router.put('/rooms/:roomId/state', controllers.updateRoomState);
router.get('/rooms/:roomId/messages', controllers.getRoomMessages);
router.post('/rooms/:roomId/messages', controllers.addRoomMessage);
router.post('/rooms/:roomId/gameState', controllers.updateGameStateWS);
router.get('/online-players', controllers.getOnlinePlayers);
// Room invitation route
router.post('/roomsInvite', controllers.createRoomWithInvites);
router.post('/createLeague', controllers.createLeague);
router.get('/userLeagues/:userId', controllers.getUserLeagues);
// Add this to your routes file where other routes are defined
router.get('/leagues/:leagueId', controllers.getLeagueDetails);
router.post('/leagues/:leagueCode/join', controllers.joinLeague);
// Add this line in your routes definition section
// Add this line with the other league routes
router.post('/leagues/:leagueId/createGame', controllers.createLeagueGame);
// Add this route
router.post('/track/single-player-click', controllers.trackSinglePlayerClick);
router.post('/track/multiplayer-click', trackMultiplayerClick);


module.exports = router;

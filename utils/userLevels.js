// File: utils/userLevels.js

/**
 * User levels based on trivia points
 * Each entry contains:
 * - threshold: minimum points required to reach this level
 * - title: the title displayed to the user
 */
const USER_LEVELS = [
    { threshold: 0, title: "Curious Cadet" },
    { threshold: 500, title: "Fact-Finder" },
    { threshold: 1000, title: "Trivia Trailblazer" },
    { threshold: 1500, title: "Riddle Rogue" },
    { threshold: 2000, title: "Knowledge Knight" },
    { threshold: 2500, title: "Brainwave Bandit" },
    { threshold: 3000, title: "Wisdom Warrior" },
    { threshold: 3500, title: "Puzzle Pirate" },
    { threshold: 4000, title: "Insight Instigator" },
    { threshold: 4500, title: "Quiz Conqueror" },
    { threshold: 5000, title: "Lore Legend" },
    { threshold: 5500, title: "Data Daredevil" },
    { threshold: 6000, title: "Enigma Empress/Emperor" },
    { threshold: 6500, title: "Cognition Commander" },
    { threshold: 7000, title: "Trivia Titan" },
    { threshold: 7500, title: "Oracle Overlord" },
    { threshold: 8000, title: "Mystery Maverick" },
    { threshold: 8500, title: "Puzzle Phenom" },
    { threshold: 9000, title: "Brainstorm Baron/Baroness" },
    { threshold: 9500, title: "Quiz Quest Champion" },
    { threshold: 10000, title: "Knowledge Kraken" },
    { threshold: 10500, title: "Synapse Supreme" },
    { threshold: 11000, title: "Riddle Renegade" },
    { threshold: 11500, title: "Lore Luminary" },
    { threshold: 12000, title: "Mastermind Monarch" }
  ];
  
  /**
   * Get the user's level based on their trivia points
   * @param {number} points - The user's current trivia points
   * @returns {object} - The user's level information { level, title, nextLevel, pointsToNextLevel }
   */
  function getUserLevel(points) {
    // Find the highest level the user has reached
    let currentLevelIndex = 0;
    
    for (let i = 0; i < USER_LEVELS.length; i++) {
      if (points >= USER_LEVELS[i].threshold) {
        currentLevelIndex = i;
      } else {
        break;
      }
    }
    
    const currentLevel = USER_LEVELS[currentLevelIndex];
    const hasNextLevel = currentLevelIndex < USER_LEVELS.length - 1;
    const nextLevel = hasNextLevel ? USER_LEVELS[currentLevelIndex + 1] : null;
    
    return {
      level: currentLevelIndex + 1, // Level number (1-indexed)
      title: currentLevel.title,
      currentPoints: points,
      nextLevelTitle: hasNextLevel ? nextLevel.title : null,
      nextLevelThreshold: hasNextLevel ? nextLevel.threshold : null,
      pointsToNextLevel: hasNextLevel ? nextLevel.threshold - points : 0,
      maxLevel: currentLevelIndex === USER_LEVELS.length - 1
    };
  }
  
  module.exports = {
    USER_LEVELS,
    getUserLevel
  };
// /**
//  * This script initializes Firebase with sample data for QuizQuest
//  * Run with: node scripts/initialize-firebase.js
//  */

// const { db } = require('../config/firebase-config');

// async function initializeFirebase() {
//   console.log('Starting Firebase initialization...');

//   try {
//     // Create categories
//     console.log('Creating trivia categories...');
//     const categories = [
//       { name: 'World Geography', description: 'Questions about countries, capitals, landmarks, and geography.' },
//       { name: 'Modern History', description: 'Questions about historical events from the last century.' },
//       { name: 'Sports', description: 'Questions about various sports, teams, and athletes.' },
//       { name: 'Science', description: 'Questions about biology, chemistry, physics, and general science.' },
//       { name: 'Movies', description: 'Questions about films, actors, directors, and cinema.' },
//       { name: 'Cryptograms', description: 'Decode encrypted messages to find the answer.' },
//       { name: 'Anagrams', description: 'Rearrange letters to find the hidden word.' },
//       { name: 'Music', description: 'Questions about songs, artists, bands, and musical instruments.' },
//       { name: 'Business and Brands', description: 'Questions about companies, logos, and business leaders.' },
//       { name: 'Math', description: 'Mathematical puzzles and problems.' }
//     ];

//     // Add each category to Firestore
//     for (const category of categories) {
//       await db.collection('categories').add(category);
//     }
//     console.log('Categories created successfully!');

//     // Add sample questions (just a few examples)
//     console.log('Creating sample questions...');
//     const sampleQuestions = [
//       {
//         category: 'World Geography',
//         question: 'Which country is known as the Land of the Rising Sun?',
//         options: ['China', 'Japan', 'Thailand', 'Vietnam'],
//         correctAnswer: 'Japan',
//         difficulty: 'easy'
//       },
//       {
//         category: 'Science',
//         question: 'What is the chemical symbol for Gold?',
//         options: ['Go', 'Gd', 'Au', 'Ag'],
//         correctAnswer: 'Au',
//         difficulty: 'easy'
//       }
//     ];

//     // Add each question to Firestore
//     for (const question of sampleQuestions) {
//       await db.collection('questions').add(question);
//     }
//     console.log('Sample questions created successfully!');
    
//     console.log('Firebase initialization completed successfully!');
//   } catch (error) {
//     console.error('Error initializing Firebase:', error);
//   }
// }

// // Run the initialization
// initializeFirebase();
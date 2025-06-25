// Emergency debug endpoint - UPDATED VERSION
app.get('/emergency-debug', async (req, res) => {
  const results = {};
  
  try {
    const dns = require('dns').promises;
    results.dns = await Promise.race([
      dns.lookup('firestore.googleapis.com'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), 5000))
    ]);
  } catch (error) {
    results.dns = { error: error.message };
  }

  try {
    const https = require('https');
    results.http = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'firestore.googleapis.com',
        port: 443,
        path: '/',
        method: 'GET',
        timeout: 5000
      }, (res) => {
        resolve(`Status: ${res.statusCode}`);
      });
      req.on('error', reject);
      req.on('timeout', () => reject(new Error('HTTP timeout')));
      req.end();
    });
  } catch (error) {
    results.http = { error: error.message };
  }

  try {
    const admin = require('firebase-admin');
    const app = admin.app();
    results.firebase = {
      projectId: app.options.projectId,
      hasCredential: !!app.options.credential
    };
  } catch (error) {
    results.firebase = { error: error.message };
  }

  // Updated environment check for your specific Firebase variables
  results.environment = {
    nodeEnv: process.env.NODE_ENV,
    hasFirebaseProjectId: !!process.env.FIREBASE_PROJECT_ID,
    hasFirebasePrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
    hasFirebaseClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
    azureWebsiteName: process.env.WEBSITE_SITE_NAME,
    timestamp: new Date().toISOString()
  };

  // Test a simple Firestore operation
  try {
    const { db } = require('./config/firebase-config');
    const testDoc = await db.collection('test').limit(1).get();
    results.firestoreTest = {
      success: true,
      canRead: !testDoc.empty,
      docCount: testDoc.size
    };
  } catch (error) {
    results.firestoreTest = {
      success: false,
      error: error.message,
      code: error.code
    };
  }

  res.json(results);
});

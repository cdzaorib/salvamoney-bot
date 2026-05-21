'use strict';

const { initializeApp } = require('firebase/app');
const { getDatabase } = require('firebase/database');

function createFirebaseDb(firebaseConfig) {
  return getDatabase(initializeApp(firebaseConfig));
}

module.exports = {
  createFirebaseDb,
};

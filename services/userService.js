const User = require('../models/User');

async function findOrCreate(userId, socketId, data) {
  const now = new Date();
  const update = {
    socketId,
    isOnline: true,
    lastOnline: now,
    updatedAt: now,
    ...(data.name && { name: data.name }),
    ...(data.email && { email: data.email }),
    ...(data.username && { username: data.username }),
  };
  const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
  return User.findByIdAndUpdate(userId, update, opts).exec();
}

async function updateOnlineStatus(userId, isOnline) {
  return User.findByIdAndUpdate(userId, {
    isOnline,
    lastOnline: new Date(),
    updatedAt: new Date(),
  }, { new: true }).exec();
}

async function getUpdatedSince(since) {
  return User.find({ updatedAt: { $gt: new Date(+since) } }).exec();
}

module.exports = { findOrCreate, updateOnlineStatus, getUpdatedSince };

const User = require('../models/User');

async function findOrCreate(userId, socketId, data) {
  const now = Date.now(); // <-- store as timestamp (long)

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

  console.log(`🔄 findOrCreate → userId: ${userId}, socketId: ${socketId}, update:`, update);

  return User.findByIdAndUpdate(userId, update, opts).exec();
}
async function findOnly(userId) {
  try {
    const user = await User.findById(userId).exec();
    console.log(`🔍 findOnly → userId: ${userId}, found: ${!!user}`);
    return user;
  } catch (err) {
    console.error(`❌ findOnly error for userId ${userId}:`, err);
    return null;
  }
}



async function updateOnlineStatus(userId, isOnline) {
  const now = Date.now();
  return User.findByIdAndUpdate(userId, {
    isOnline,
    lastOnline: now,
    updatedAt: now,
  }, { new: true }).exec();
}

async function getUpdatedSince(since) {
  // since is expected to be a long (epoch ms)
  return User.find({ updatedAt: { $gt: Number(since) } }).exec();
}

module.exports = {
  findOrCreate,
  updateOnlineStatus,
  findOnly,
  getUpdatedSince,
};

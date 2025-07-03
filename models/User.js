const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  _id: String, // use user_id as primary key
  name: String,
  email: String,
  username: { type: String, unique: true },
  socketId: String,
  isOnline: Boolean,
  lastOnline: Date,
  createdAt: Date,
  updatedAt: Date,
  fbToken: String,
}, { _id: false });

UserSchema.index({ updatedAt: 1 });

module.exports = mongoose.model('User', UserSchema);

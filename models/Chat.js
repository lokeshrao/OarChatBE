const mongoose = require('mongoose');
const ChatSchema = new mongoose.Schema({
  _id: String, // chat id
  name: String,
  type: { type: String, enum: ['individual', 'group'] },
  members: [String],
  createdAt: Number,
  updatedAt: Number,
  lastMessage: String,
}, { _id: false });

ChatSchema.index({ members: 1, updatedAt: -1 });

module.exports = mongoose.model('Chat', ChatSchema);

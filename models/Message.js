const mongoose = require('mongoose');
const MessageSchema = new mongoose.Schema({
  _id: String, // message id
  chatId: String,
  senderId: String,
  recipientId: String,
  recipientType: String,
  content: String,
  type: { type: String, default: 'TEXT' },
  status: String,
  createdAt: Date,
  updatedAt: Date,
});

MessageSchema.index({ chatId: 1, createdAt: 1 });

module.exports = mongoose.model('Message', MessageSchema);

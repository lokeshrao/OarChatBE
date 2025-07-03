const Message = require('../models/Message');

async function addMessage(data) {
  const now = new Date();
  return new Message({ ...data, createdAt: new Date(+data.createdAt), updatedAt: now }).save();
}

async function getMessagesSince(chatIds, since) {
  return Message.find({
    chatId: { $in: chatIds },
    createdAt: { $gt: new Date(+since) },
  }).sort('createdAt').exec();
}

module.exports = { addMessage, getMessagesSince };

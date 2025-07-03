const Chat = require('../models/Chat');

async function existsWithMembers(userIds) {
  return Chat.exists({ members: { $all: userIds, $size: userIds.length } });
}

async function createChat({ id, name, type, members }) {
  const now = new Date();
  const chat = new Chat({ _id: id, name, type, members, createdAt: now, updatedAt: now });
  return chat.save();
}

async function getUserChatsSince(userId, since) {
  return Chat.find({
    members: userId,
    updatedAt: { $gt: new Date(+since) },
  }).exec();
}

async function updateLastMessage(chatId, message) {
  return Chat.findByIdAndUpdate(chatId, {
    lastMessage: message,
    updatedAt: new Date(),
  }).exec();
}

module.exports = { existsWithMembers, createChat, getUserChatsSince, updateLastMessage };

const Chat = require('../models/Chat');

async function existsWithMembers(userIds) {
  return Chat.exists({ members: { $all: userIds, $size: userIds.length } });
}

async function createChat({ id, name, type, members }) {
  const now = Date.now(); // Store as Number (epoch milliseconds)
  const chat = new Chat({
    _id: id,
    name,
    type,
    members,
    createdAt: now,
    updatedAt: now,
  });
  return chat.save();
}

async function getUserChatsSince(userId, since) {
  const sinceEpoch = +since;
  const chats = await Chat.find({
    members: userId,
    updatedAt: { $gt: sinceEpoch },
  }).exec();

  console.log(`📦 getUserChatsSince → user: ${userId}, since: ${sinceEpoch} (${new Date(sinceEpoch).toLocaleString()})`);
  console.log(`🗂️  Fetched ${chats.length} chat(s):`);
  chats.forEach(chat => {
    console.log(`➡️  Chat: ${chat.name} (${chat._id}), updatedAt: ${chat.updatedAt} (${new Date(chat.updatedAt).toLocaleString()})`);
  });

  return chats;
}

async function updateLastMessage(chatId, message) {
  return Chat.findByIdAndUpdate(chatId, {
    lastMessage: message,
    updatedAt: Date.now(), 
  }, { new: true }).exec();
}

async function getChatById(chatId) {
  return Chat.findById(chatId).exec();
}

module.exports = {
  existsWithMembers,
  createChat,
  getUserChatsSince,
  updateLastMessage,
  getChatById,
};

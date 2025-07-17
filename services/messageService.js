const Message = require('../models/Message');

async function addMessage(data) {
  const now = new Date();
  return new Message({ ...data, createdAt: new Date(+data.createdAt), updatedAt: now }).save();
}

async function getMessagesSince(userId, since) {
  const query = {
    $or: [
      { senderId: userId },
      { recipientId: userId }
    ],
    updatedAt: { $gt: new Date(+since) },
  };

  console.log('🔍 Query:', JSON.stringify(query, null, 2));

  const messages = await Message.find(query)
    .sort('createdAt')
    .exec();

  console.log(`📄 Found ${messages.length} messages for userId: ${userId} since: ${new Date(+since).toISOString()}`);

  messages.forEach((msg, index) => {
    console.log(`📩 [${index + 1}] MessageId: ${msg._id}, Sender: ${msg.senderId}, Recipient: ${msg.recipientId}, Status: ${msg.status}, UpdatedAt: ${msg.updatedAt}`);
  });

  return messages;
}



async function updateMessageStatus(messageId, updateData) {
  return Message.findByIdAndUpdate(
    messageId,
    {
      ...updateData,
      updatedAt: new Date(),
    },
    { new: true }
  );
}
module.exports = { addMessage, getMessagesSince,updateMessageStatus };

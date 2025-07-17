require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const { Server } = require('socket.io');
const userSvc = require('./services/userService');
const chatSvc = require('./services/chatService');
const msgSvc = require('./services/messageService');

const app = express();
app.use(cors(), express.json(), express.urlencoded({ extended: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// ✅ MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// ✅ Socket.IO handler
io.on('connection', async socket => {
  const { user_id, is_from_service, epoch_date_users, epoch_date_chat, epoch_date_messages } = socket.handshake.query;

  if (!user_id) {
    console.warn(`❌ Missing user_id. Disconnecting socket ${socket.id}`);
    return socket.disconnect(true);
  }

  try {
    const user = await userSvc.updateIfExists(user_id, socket.id, is_from_service);

    const syncEpochUsers = Number(epoch_date_users || 0);
    const syncEpochChat = Number(epoch_date_chat || 0);
    const syncEpochMessages = Number(epoch_date_messages || 0);

    console.log(`✅ Sync request for ${user.username} (${user._id}) ${syncEpochUsers} ${syncEpochChat} ${syncEpochMessages} `);

    socket.broadcast.emit('user_data_update', user);

    // Perform ordered, chunked sync
    await performInitialSync(socket, user_id, syncEpochUsers, syncEpochChat, syncEpochMessages);

  } catch (err) {
    console.error(`❌ Error during socket init:`, err);
  }


  socket.on('edit_user', async (data, ack) => {
    try {
      const updated = await userSvc.findOrCreate(data.user_id, socket.id, data);
      io.emit('user_data_update', updated);
      console.log(`📝 User edited: ${updated.name} (${updated._id})`);
      ack({ success: true });
    } catch (e) {
      console.error(`❌ Failed to edit user:`, e);
      ack({ success: false, message: e.message });
    }
  });

  socket.on('disconnect', async () => {
    try {
      const u = await userSvc.updateOnlineStatus(user_id, false);
      io.emit('user_data_update', u);
      console.log(`❎ User disconnected: ${u.name} (${u._id})`);
    } catch (err) {
      console.error(`❌ Disconnect error:`, err);
    }
  });

  socket.on('validate_chat_and_save', async (chatJson, ack) => {
    try {
      const { members = [] } = chatJson;
      const uniqueMembers = [...new Set(members)];

      // Validate members array
      if (!Array.isArray(members) || uniqueMembers.length < 2) {
        const errorMsg = 'At least 2 distinct user IDs are required in members array';
        socket.emit('chat_validation_response', { error: errorMsg });
        console.warn(`⚠️ Invalid members array:`, members);
        if (typeof ack === 'function') ack({ success: false, error: errorMsg });
        return;
      }

      // Check if chat exists
      const exists = await chatSvc.existsWithMembers(members);

      if (exists) {
        // Chat exists: send error ack to requester
        const errorMsg = 'Chat with these members already exists';
        console.log(`💬 Chat validation (${chatJson.name}) exists: ${exists}`);
        if (typeof ack === 'function') ack({ success: false, error: errorMsg });
        return;
      }

      const newChat = await chatSvc.createChat(chatJson);
      console.log(`🆕 Chat created: ${newChat.name} (${newChat._id})`);

      if (typeof ack === 'function') ack({ success: true, chat: newChat });

      for (const uid of members) {
        const u = await userSvc.findOnly(uid);
        if (u && u.socketId) {
          io.to(u.socketId).emit('chat_created', newChat);
          console.log(`📤 Chat created notification sent to ${uid} (socketId: ${u.socketId})`);
        }
      }
    } catch (err) {
      console.error(`❌ validate_chat_and_save error:`, err);
      if (typeof ack === 'function') ack({ success: false, error: 'Internal server error' });
    }
  });

  socket.on('send_message', async (data, ack) => {
    try {
        const { chatId, content, senderId, recipientId, recipientType } = data;

        if (!chatId || !content || !senderId || !recipientType) {
            console.warn('⚠️ Invalid message payload.');
            return ack({ success: false, error: 'Missing required message fields' });
        }

        data.status = 'SENT';
        const savedMessage = await msgSvc.addMessage(data);
        console.log(`💾 Message saved: ${savedMessage._id} | Chat: ${chatId}`);

        await chatSvc.updateLastMessage(chatId, content);
        console.log(`🔄 Chat updated with last message: ${chatId}`);

        let recipients;
        if (recipientType === 'individual') {
            recipients = [recipientId];
        } else if (recipientType === 'group') {
            const chat = await chatSvc.getChatById(chatId);
            if (!chat) {
                console.warn(`⚠️ Chat not found: ${chatId}`);
                return ack({ success: false, error: 'Chat not found' });
            }
            recipients = chat.members.filter(uid => uid !== senderId);
        } else {
            console.warn('⚠️ Unknown recipientType.');
            return ack({ success: false, error: 'Invalid recipient type' });
        }

        console.log(`📤 Sending message ${savedMessage._id} to: ${recipients.join(', ')}`);

        for (const recipient of recipients) {
            const user = await userSvc.findOnly(recipient);
            if (user?.socketId) {
                io.to(user.socketId).timeout(5000).emit('new_message', savedMessage, async (err, response) => {
                    if (err) {
                        console.warn(`⚠️ No delivery ACK from: ${recipient}`);
                        return;
                    }

                    await msgSvc.updateMessageStatus(savedMessage._id, { status: 'DELIVERED' });
                    console.log(`✅ Message DELIVERED to: ${recipient}`);

                    const sender = await userSvc.findOnly(senderId);
                    if (sender?.socketId) {
                        io.to(sender.socketId).emit('message_status_updated', {
                            messageId: savedMessage._id,
                            status: 'DELIVERED',
                            recipientId: recipient
                        });
                    }
                });
            }
        }

        ack({ success: true });

    } catch (err) {
        console.error('❌ send_message error:', err);
        ack({ success: false, error: err.message });
    }
});

});

async function performInitialSync(socket, user_id, syncEpochUsers, syncEpochChat, syncEpochMessages) {
  console.log(`🔄 Starting initial sync for user ${user_id}...`);

  if (syncEpochUsers) {
    console.log(`🧩 Syncing users updated since ${new Date(syncEpochUsers).toLocaleString()}`);
    const sinceUsers = await userSvc.getUpdatedSince(syncEpochUsers);
    const filteredUsers = sinceUsers.filter(u => u._id !== user_id);
    await syncDataInChunks(socket, 'user_data_sync', filteredUsers);
  } else {
    console.log('⚠️ User sync timestamp not provided, skipping user sync.');
  }

  if (syncEpochChat) {
    console.log(`🧩 Syncing chats updated since ${new Date(syncEpochChat).toLocaleString()}`);
    const sinceChats = await chatSvc.getUserChatsSince(user_id, syncEpochChat);
    await syncDataInChunks(socket, 'chat_data_sync', sinceChats);

    if (syncEpochMessages) {
      console.log(`🧩 Syncing messages updated since ${new Date(syncEpochMessages).toLocaleString()}`);
      const sinceMsgs = await msgSvc.getMessagesSince(user_id, syncEpochMessages);
      syncMessagesForUser(socket,user_id,sinceMsgs)
    } else {
      console.log('⚠️ Message sync timestamp not provided, skipping message sync.');
    }
  } else {
    console.log('⚠️ Chat sync timestamp not provided, skipping chat and message sync.');
  }

  console.log(`✅ Initial sync completed for user ${user_id}`);
}
async function syncMessagesForUser(socket, userId, messages, chunkSize = 50) {
    console.log(`🔄 Starting message sync for user ${userId}...`);

    if (!messages.length) {
        console.log(`ℹ️ No messages to sync for user ${userId}`);
        return;
    }

    const sorted = messages.sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
    const chunks = [];
    for (let i = 0; i < sorted.length; i += chunkSize) {
        chunks.push(sorted.slice(i, i + chunkSize));
    }

    console.log(`🚚 Syncing ${chunks.length} chunks of messages to user ${userId}`);

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        await new Promise(resolve => {
            socket.timeout(5000).emit('message_data_sync', chunk, async (err, response) => {
                if (err) {
                    console.warn(`⚠️ No ACK for chunk ${i + 1}/${chunks.length} from user ${userId}`);
                    return resolve();
                }

                console.log(`✅ ACK received for chunk ${i + 1}/${chunks.length} from user ${userId}`);

                for (const message of chunk) {
                    if (message.senderId !== userId) {
                        await msgSvc.updateMessageStatus(message._id, {
                            status: 'DELIVERED'
                         });

                        const sender = await userSvc.findOnly(message.senderId);
                        if (sender?.socketId) {
                            socket.to(sender.socketId).emit('message_status_updated', {
                                messageId: message._id,
                                status: 'DELIVERED',
                                recipientId: userId,
                            });
                        }
                    }
                }
                resolve();
            });
        });
    }

    console.log(`✅ Finished syncing messages for user ${userId}`);
}


async function syncDataInChunks(socket, event, dataList, chunkSize = 50) {
  if (!dataList.length) {
    console.log(`ℹ️ No data to sync for ${event}`);
    return;
  }

  const sorted = dataList.sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt)); // oldest to newest
  const chunks = [];

  for (let i = 0; i < sorted.length; i += chunkSize) {
    chunks.push(sorted.slice(i, i + chunkSize));
  }

  console.log(`🚚 Syncing ${chunks.length} chunk(s) for ${event} (${dataList.length} item(s))`);

  for (let i = 0; i < chunks.length; i++) {
    await new Promise(resolve => {
      socket.emit(event, chunks[i], () => {
        console.log(`✅ Acknowledged: ${event} chunk ${i + 1}/${chunks.length}`);
        resolve();
      });
    });
  }

  console.log(`✅ Finished syncing all chunks for ${event}`);
}


// ✅ Express routes
app.get('/health', (req, res) => {
  console.log('✅ Health check requested');
  res.json({ status: 'OK', timestamp: new Date(), uptime: process.uptime() });
});

app.get('/oar', (req, res) => res.send('<h1>Socket.IO Server is Running</h1>'));

// ✅ Graceful shutdown handlers
process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down...');
  mongoose.disconnect().then(() => process.exit(0));
});

process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down...');
  mongoose.disconnect().then(() => process.exit(0));
});

// ✅ Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});

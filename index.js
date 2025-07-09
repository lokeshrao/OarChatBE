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
  const { user_id, epoch_date_users, epoch_date_chat, epoch_date_messages } = socket.handshake.query;
  console.log(`📡 New socket connected: ${socket.id}, user: ${user_id}`);

  if (epoch_date_users) {
    console.log(`📦 epoch_date_users: ${epoch_date_users} → ${new Date(+epoch_date_users).toLocaleString()}`);
  }

  if (epoch_date_chat) {
    console.log(`💬 epoch_date_chat: ${epoch_date_chat} → ${new Date(+epoch_date_chat).toLocaleString()}`);
  }

  if (epoch_date_messages) {
    console.log(`📨 epoch_date_messages: ${epoch_date_messages} → ${new Date(+epoch_date_messages).toLocaleString()}`);
  }

  if (!user_id) {
    console.warn(`❌ Missing user_id. Disconnecting socket ${socket.id}`);
    return socket.disconnect(true);
  }

  try {
    const user = await userSvc.findOrCreate(user_id, socket.id, {});
    console.log(`👤 User connected: ${user.name} (${user._id})`);

    socket.broadcast.emit('user_data_update', user);

    const sinceUsers = await userSvc.getUpdatedSince(epoch_date_users || 0);
    sinceUsers.filter(u => u._id !== user_id).forEach(u => socket.emit('user_data_sync', u));

    const sinceChats = await chatSvc.getUserChatsSince(user_id, epoch_date_chat || 0);
    sinceChats.forEach(c => socket.emit('chat_data_sync', c));

    const chatIds = sinceChats.map(c => c._id);
    const sinceMsgs = await msgSvc.getMessagesSince(chatIds, epoch_date_messages || 0);
    sinceMsgs.forEach(m => socket.emit('message_data_sync', m));

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

  socket.on('user_fb_token', async ({ user_id, fb_token }) => {
    await userSvc.findOrCreate(user_id, socket.id, { fbToken: fb_token });
    console.log(`🔐 FB token updated for user ${user_id}`);
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
      console.log('📨 Received message:', JSON.stringify(data, null, 2));
      const { chatId, content, senderId, recipientId, recipientType } = data;

      if (!chatId || !content || !senderId || !recipientType) {
        console.warn('⚠️ Invalid message payload:', data);
        return ack({ success: false, error: 'Missing required message fields' });
      }

      const savedMessage = await msgSvc.addMessage(data);
      console.log(`💾 Message saved: ${savedMessage.content} (id: ${savedMessage._id})`);

      await chatSvc.updateLastMessage(chatId, content);
      console.log(`📌 Updated chat ${chatId} with last message.`);

      let recipients;
      if (recipientType === 'individual') {
        recipients = [recipientId];
      } else if (recipientType === 'group') {
        const chat = await chatSvc.getChatById(chatId);
        if (!chat) {
          console.warn(`⚠️ Chat not found for id: ${chatId}`);
          return ack({ success: false, error: 'Chat not found' });
        }
        recipients = chat.members.filter(uid => uid !== senderId);
      } else {
        console.warn(`⚠️ Unknown recipientType: ${recipientType}`);
        return ack({ success: false, error: 'Invalid recipient type' });
      }

      console.log(`👥 Sending message to recipients: ${recipients.join(', ')}`);
      for (const recipient of recipients) {
        const user = await userSvc.findOnly(recipient);
        if (user?.socketId) {
          io.to(user.socketId).emit('new_message', savedMessage);
          console.log(`📤 Message sent to ${recipient} (socketId: ${user.socketId})`);
        } else {
          console.warn(`⚠️ User ${recipient} is offline or has no socket connection.`);
        }
      }

      ack({ success: true });

    } catch (err) {
      console.error(`❌ Error in send_message:`, err);
      ack({ success: false, error: err.message });
    }
  });
});

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

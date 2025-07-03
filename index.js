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
const io = new Server(server, { cors: { origin: "*", methods: ["GET","POST"] } });

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('✅ MongoDB connected'));

io.on('connection', async socket => {
  const { user_id, epoch_date_users, epoch_date_chat, epoch_date_messages } = socket.handshake.query;

  if (!user_id) return socket.disconnect(true);

  const user = await userSvc.findOrCreate(user_id, socket.id, {});
  const sinceUsers = await userSvc.getUpdatedSince(epoch_date_users || 0);
  sinceUsers.filter(u => u._id !== user_id).forEach(u => socket.emit('user_data_update', u));

  const sinceChats = await chatSvc.getUserChatsSince(user_id, epoch_date_chat || 0);
  sinceChats.forEach(c => socket.emit('chat_created', c));

  const chatIds = sinceChats.map(c => c._id);
  const sinceMsgs = await msgSvc.getMessagesSince(chatIds, epoch_date_messages || 0);
  sinceMsgs.forEach(m => socket.emit('new_message', m));

  socket.on('edit_user', async (data, ack) => {
    try {
      const updated = await userSvc.findOrCreate(data.user_id, socket.id, data);
      io.emit('user_data_update', updated);
      ack({ success: true });
    } catch (e) {
      ack({ success: false, message: e.message });
    }
  });

  socket.on('user_fb_token', async ({ user_id, fb_token }) => {
    await userSvc.findOrCreate(user_id, socket.id, { fbToken: fb_token });
  });

  socket.on('disconnect', async () => {
    await userSvc.updateOnlineStatus(user_id, false);
    const u = await userSvc.updateOnlineStatus(user_id, false);
    io.emit('user_data_update', u);
  });

  socket.on('validate_chat_and_save', async chatJson => {
    const exists = await chatSvc.existsWithMembers(chatJson.user_ids);
    socket.emit('chat_validation_response', { exists });

    if (!exists) {
      const newChat = await chatSvc.createChat(chatJson);
      chatJson.user_ids.forEach(uid =>
        io.to(uid === user_id ? socket.id : (async () => {
          const u = await userSvc.findOrCreate(uid, null, {});
          return u.socketId;
        })()).emit('chat_created', newChat)
      );
    }
  });

  socket.on('send_message', async (data, ack) => {
    try {
      const saved = await msgSvc.addMessage(data);
      await chatSvc.updateLastMessage(data.chat_id, data.content);

      const recipients = data.recipient_type === 'individual'
        ? [data.recipient_id]
        : (await chatSvc.createChat({})).members.filter(m => m !== data.sender_id);

      recipients.forEach(async r => {
        const u = await userSvc.findOrCreate(r, null, {});
        if (u.socketId) io.to(u.socketId).emit('new_message', saved);
      });

      ack({ success: true });
    } catch (e) {
      ack({ success: false, error: e.message });
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date(), uptime: process.uptime() });
});

app.get('/oar', (req, res) => res.send('<h1>Socket.IO Server is Running</h1>'));

process.on('SIGINT', () => mongoose.disconnect().then(() => process.exit(0)));
process.on('SIGTERM', () => mongoose.disconnect().then(() => process.exit(0)));

server.listen(process.env.PORT || 8080, () =>
  console.log(`🚀 Server on port ${process.env.PORT || 8080}`));

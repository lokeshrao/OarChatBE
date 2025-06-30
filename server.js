const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins during development
        methods: ["GET", "POST"],
    }
});

// Use /tmp directory for file storage on Railway
const dataDir = process.env.NODE_ENV === 'production' ? '/tmp' : './';
const dataFile = path.join(dataDir, 'userData.json');
const chatFile = path.join(dataDir, 'chats.json');
const messagesFile = path.join(dataDir, 'messages.json');

const PORT = process.env.PORT || 8080;

let users = {};
let chats = {};
let messages = {};

// Load data from files with better error handling
function loadDataFromFiles() {
    try {
        if (fs.existsSync(dataFile)) {
            const data = fs.readFileSync(dataFile, 'utf-8');
            users = JSON.parse(data);
            console.log('User data loaded from file.');
        }
    } catch (err) {
        console.error('Error loading user data:', err);
        users = {};
    }

    try {
        if (fs.existsSync(chatFile)) {
            const data = fs.readFileSync(chatFile, 'utf-8');
            chats = JSON.parse(data);
            console.log('Chat data loaded from file.');
        }
    } catch (err) {
        console.error('Error loading chat data:', err);
        chats = {};
    }

    try {
        if (fs.existsSync(messagesFile)) {
            const data = fs.readFileSync(messagesFile, 'utf-8');
            messages = JSON.parse(data);
            console.log('Messages data loaded from file.');
        }
    } catch (err) {
        console.error('Error loading messages data:', err);
        messages = {};
    }
}

// Initialize data
loadDataFromFiles();

function saveUserDataToFile() {
    try {
        // Ensure directory exists
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(dataFile, JSON.stringify(users, null, 2), 'utf-8');
    } catch (err) {
        console.error('Error saving user data:', err);
    }
}

function saveChatsToFile() {
    try {
        // Ensure directory exists
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(chatFile, JSON.stringify(chats, null, 2), 'utf-8');
    } catch (err) {
        console.error('Error saving chat data:', err);
    }
}

function saveMessagesToFile() {
    try {
        // Ensure directory exists
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(messagesFile, JSON.stringify(messages, null, 2), 'utf-8');
    } catch (err) {
        console.error('Error saving messages data:', err);
    }
}

// Validate user ID
function isValidUserId(userId) {
    return userId !== "null" && userId !== undefined && typeof userId === 'string' && userId.trim() !== '';
}

// Helper functions
function getGroupMembers(chatId) {
    const chat = chats[chatId];
    if (chat && chat.type === "group") {
        return chat.members; // Return the members array if it's a group chat
    } else {
        console.error("Chat ID not found or not a group chat");
        return [];
    }
}

function getSocketIdByUserId(userId) {
    if (users[userId]) {
        return users[userId].socket_id;
    }
    return null; // Return null if the user is not found
}

// Main Socket.IO connection handler
io.on('connection', (socket) => {
    const user_id = socket.handshake.query.user_id;
    const epochDateUser = socket.handshake.query.epoch_date_users;
    const epochDateChat = socket.handshake.query.epoch_date_chat;
    const epochDateMessages = socket.handshake.query.epoch_date_messages;
    console.log(`Taking data after ${epochDateUser} ${epochDateChat} ${epochDateMessages}`);

    if (!isValidUserId(user_id)) {
        console.error(`Invalid user ID, disconnecting socket: ${socket.id}`);
        socket.disconnect(true);
        return;
    }

    if (users[user_id]) {
        users[user_id] = {
            ...users[user_id],
            socket_id: socket.id,
            is_online: true,
            last_online: Date.now(),
            updated_at: Date.now()
        };
        socket.broadcast.emit('notificationMessage', {
            title: 'OarChat',
            message: `User ${users[user_id].name} is now online.`,
            body: user_id
        });
        socket.broadcast.emit('user_data_update', users[user_id]);
        saveUserDataToFile();
    }

    const sortedUsers = [];
    for (let userKey in users) {
        if (userKey !== user_id && users[userKey].updated_at > epochDateUser) {
            let index = sortedUsers.findIndex(user => user.updated_at > users[userKey].updated_at);

            if (index === -1) {
                sortedUsers.push(users[userKey]);
            } else {
                sortedUsers.splice(index, 0, users[userKey]);
            }
        }
    }
    console.log(`Taking Users ${JSON.stringify(sortedUsers)}`);
    sortedUsers.forEach(user => {
        socket.emit('user_data_update', user);
    });

    const sortedChats = [];
    for (let chatKey in chats) {
        const chat = chats[chatKey];

        if (chat.members.includes(user_id) && chat.updated_at > epochDateChat) {
            let index = sortedChats.findIndex(existingChat => existingChat.updated_at > chat.updated_at);

            if (index === -1) {
                sortedChats.push(chat);
            } else {
                sortedChats.splice(index, 0, chat);
            }
        }
    }
    console.log(`Taking chats ${JSON.stringify(sortedChats)}`);

    sortedChats.forEach(chat => {
        socket.emit('chat_created', chat);
    });

    const userChats = Object.values(chats).filter(chat => chat.members.includes(user_id));
    const userChatIds = userChats.map(chat => chat.id);
    const sortedMessages = [];

    for (let messageKey in messages) {
        const messageArray = messages[messageKey];
        if (userChatIds.includes(messageKey)) {
            const filteredMessages = messageArray.filter(
                message => message.created_at > epochDateMessages
            );
            sortedMessages.push(...filteredMessages);
        }
    }

    sortedMessages.sort((a, b) => a.updated_at - b.updated_at);
    console.log(`Taking messages ${JSON.stringify(sortedMessages)}`);

    sortedMessages.forEach(message => {
        socket.emit('new_message', message);
    });

    socket.on('edit_user', (userData, ackCallback) => {
        const { user_id, name, email, username } = userData;

        if (!isValidUserId(user_id)) {
            console.error(`Invalid user ID in edit_user: ${JSON.stringify(userData)}`);
            ackCallback({ success: false, message: 'Invalid user ID' });
            return;
        }

        // Check if the username already exists for a different user
        for (let existingUserId in users) {
            if (users[existingUserId].username === username && existingUserId !== user_id) {
                console.log(`Username already exists: ${username} for user ${existingUserId}`);
                ackCallback({ success: false, message: 'Username already exists' });
                return;
            }
        }

        if (users[user_id]) {
            console.log(`User updated: ${user_id}`);
            Object.assign(users[user_id], {
                id: user_id,
                name: name,
                email: email,
                username: username,
                is_online: true,
                last_online: Date.now(),
                updated_at: Date.now()
            });
        } else {
            users[user_id] = {
                id: user_id,
                name: name,
                email: email,
                username: username,
                socket_id: socket.id,
                is_online: true,
                last_online: Date.now(),
                created_at: Date.now(),
                updated_at: Date.now()
            };
            console.log(`User created: ${user_id}`);
            socket.broadcast.emit('notificationMessage', {
                title: 'OarChat',
                message: `User ${users[user_id].name} joined OarChat.`,
                body: ""
            });
        }

        ackCallback({ success: true });
        socket.broadcast.emit('user_data_update', users[user_id]);
        saveUserDataToFile();
    });

    socket.on('user_fb_token', (data) => {
        const { user_id, fb_token } = data;

        if (!isValidUserId(user_id)) {
            console.error(`Invalid user ID in user_fb_token: ${JSON.stringify(data)}`);
            return;
        }

        users[user_id] = { ...users[user_id], fb_token, socket_id: socket.id };
        console.log(`User token updated: ${user_id}`);
        saveUserDataToFile();
    });

    socket.on('disconnect_user', (key) => {
        const user_id = Object.keys(users).find(userId => users[userId].id === key.user_id);
        console.log(`User ${user_id} is now offline.`);
        console.log(`User ${key.user_id} is now offline.`);
        if (user_id) {
            users[user_id].is_online = false;
            users[user_id].last_online = Date.now();
            users[user_id].updated_at = Date.now();
            console.log(`User ${JSON.stringify(users[user_id])}`);
            socket.broadcast.emit('user_data_update', users[user_id]);
            saveUserDataToFile();
        }
    });

    socket.on('validate_chat_and_save', (chatJson) => {
        const { user_ids, id, name, type } = chatJson;
        console.log(`Chat request: ${JSON.stringify(chatJson)}`);

        const chatExists = Object.values(chats).some(chat => {
            const membersMatch = chat.members.length === new Set(user_ids).size;
            const allUsersPresent = user_ids.every(userId => chat.members.includes(userId));
            return membersMatch && allUsersPresent;
        });
        console.log(`Chat Exist: ${chatExists}`);
        
        if (chatExists === true) {
            socket.emit('chat_validation_response', {
                exists: chatExists
            });
            return;
        }
        
        if (!chatExists) {
            chats[id] = {
                id: id,
                name: name,
                type: type,
                members: user_ids,
                created_at: Date.now(),
                updated_at: Date.now()
            };
            console.log(`Users: ${JSON.stringify(users)}`);
            console.log(`User Ids: ${JSON.stringify(user_ids)}`);
            
            user_ids.forEach(userId => {
                const user = users[userId];
                socket.emit('chat_create_response', chats[id]);
                console.log(`Sending to User: ${JSON.stringify(user)}`);
                if (user && user.socket_id) {
                    io.to(user.socket_id).emit('chat_created', chats[id]);
                }
            });
            console.log(`Chat created: ${JSON.stringify(chats[id])}`);
            saveChatsToFile();
        }
    });

    socket.on('send_message', (data, ack) => {
        try {
            const message = {
                id: data.id,
                content: data.content,
                chat_id: data.chat_id,
                sender_id: data.sender_id,
                recipient_id: data.recipient_id,
                recipient_type: data.recipient_type,
                created_at: data.created_at,
                updated_at: Date.now(),
                status: data.status,
                type: data.type || "TEXT",
            };

            if (!messages[message.chat_id]) {
                messages[message.chat_id] = [];
            }
            messages[message.chat_id].push(message);

            // Fix the bug: check if chat exists before updating
            if (chats[message.chat_id]) {
                chats[message.chat_id].last_message = message.content;
                chats[message.chat_id].updated_at = Date.now();
                saveChatsToFile();
            }
            
            saveMessagesToFile();

            if (message.recipient_type === "individual") {
                const recipientSocketId = getSocketIdByUserId(message.recipient_id);
                console.log("Recipient:", recipientSocketId);
                if (recipientSocketId) {
                    io.to(recipientSocketId).emit('new_message', message);
                }
            } else if (message.recipient_type === "group") {
                const groupMembers = getGroupMembers(message.chat_id);

                groupMembers.forEach(memberId => {
                    if (memberId !== message.sender_id) {
                        const recipientSocketId = getSocketIdByUserId(memberId);
                        if (recipientSocketId) {
                            io.to(recipientSocketId).emit('new_message', message);
                        }
                    }
                });
            }

            if (typeof ack === 'function') {
                ack({ success: true, message: "Message delivered successfully." });
            }
        } catch (error) {
            console.error("Error handling send_message:", error);

            if (typeof ack === 'function') {
                ack({ success: false, error: "Failed to deliver message." });
            }
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
        
        // Find the user associated with this socket
        for (let userId in users) {
            if (users[userId].socket_id === socket.id) {
                users[userId].is_online = false;
                users[userId].last_online = Date.now();
                users[userId].updated_at = Date.now();
                console.log(`User ${userId} went offline due to disconnect`);
                socket.broadcast.emit('user_data_update', users[userId]);
                saveUserDataToFile();
                break;
            }
        }
    });
});

// Health check endpoint for Railway
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        users: Object.keys(users).length,
        chats: Object.keys(chats).length
    });
});

// Test route for HTTP requests
app.get('/oar', (req, res) => {
    res.send('<h1>Socket.IO Server is Running</h1>');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Data directory: ${dataDir}`);
});
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const admin = require('firebase-admin');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins during development
        methods: ["GET", "POST"],
    }
});

const dataFile = 'userData.json';
const chatFile = 'chats.json';
const messagesFile = 'messages.json';


const PORT = 3000;

let users = {};
let chats = {};
let messages = {};


try {
    const data = fs.readFileSync(dataFile, 'utf-8');
    users = JSON.parse(data);
    console.log('User data loaded from file.');
} catch (err) {
    console.error('Error loading user data:', err);
}
try {
    const data = fs.readFileSync(chatFile, 'utf-8');
    chats = JSON.parse(data);
    console.log('Chat data loaded from file.');
} catch (err) {
    console.error('Error loading Chat data:', err);
}
try {
    const data = fs.readFileSync(messagesFile, 'utf-8');
    messages = JSON.parse(data);
    console.log('messages data loaded from file.');
} catch (err) {
    console.error('Error loading Chat data:', err);
}


function saveUserDataToFile() {
    try {
        fs.writeFileSync(dataFile, JSON.stringify(users), 'utf-8');
    } catch (err) {
        console.error('Error saving user data:', err);
    }
}
function saveChatsToFile() {
    try {
        fs.writeFileSync(chatFile, JSON.stringify(chats), 'utf-8');
    } catch (err) {
        console.error('Error saving chat data:', err);
    }
}
function saveMessagesToFile() {
    try {
        fs.writeFileSync(messagesFile, JSON.stringify(messages), 'utf-8');
    } catch (err) {
        console.error('Error saving chat data:', err);
    }
}
// Validate user ID
function isValidUserId(userId) {
    return userId !== "null" && userId !== undefined && typeof userId === 'string' && userId.trim() !== '';
}

// Main Socket.IO connection handler
io.on('connection', (socket) => {
    const user_id = socket.handshake.query.user_id;
    const epochDateUser = socket.handshake.query.epoch_date_users;
    const epochDateChat = socket.handshake.query.epoch_date_chat;
    const epochDateMessages = socket.handshake.query.epoch_date_messages;
    console.log(`tAKING dATA AFTER ${epochDateUser}  ${epochDateChat} ${epochDateMessages}`);

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
            last_online: Date.now()
        };
        socket.broadcast.emit('notificationMessage', {
            title: 'OarChat',
            message: `User ${users[user_id].name} is now online.`,
            body: user_id
        });
        // console.log(`User online: ${user_id} - ${users[user_id].name}`);
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
    const userChatIds = userChats.map(chat => chat.id); // Extract chat IDs
    const sortedMessages = [];

    for (let messageKey in messages) {
        const messageArray = messages[messageKey]; // This is an array of messages
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






    // Object.keys(users).forEach((userKey) => {
    //     if (userKey !== user_id && users[userKey].updated_at > epochDate) {
    //         // var name = ""
    //         // if (users[user_id] && users[user_id] == null && users[user_id].name) {
    //         //     name = users[user_id].name
    //         // }
    //         // console.log(`sending user: ${user_id} - ${name}`);
    //         socket.emit('user_data_update', users[userKey]);
    //     }
    // });
    // Object.keys(users).forEach((userKey) => {
    //     if (userKey !== user_id && users[userKey].updated_at > epochDate) {
    //         // var name = ""
    //         // if (users[user_id] && users[user_id] == null && users[user_id].name) {
    //         //     name = users[user_id].name
    //         // }
    //         // console.log(`sending user: ${user_id} - ${name}`);
    //         socket.emit('user_data_update', users[userKey]);
    //     }
    // });

    socket.on('edit_user', (userData, ackCallback) => {
        const { user_id, name, email, username } = userData;

        // Validate user ID (if needed)
        if (!isValidUserId(user_id)) {
            console.error(`Invalid user ID in edit_user: ${JSON.stringify(userData)}`);
            ackCallback({ success: false, message: 'Invalid user ID' });
            return;
        }

        // Check if the username already exists for a different user
        for (let existingUserId in users) {
            if (users[existingUserId].username === username && existingUserId !== user_id) {
                // If the username exists for a different user, ask the client to choose a new one
                console.log(`Username already exists: ${username} for user ${existingUserId}`);
                ackCallback({ success: false, message: 'Username already exists' });
                return;
            }
        }

        // Proceed with user update or creation
        if (users[user_id]) {
            console.log(`User updated: ${user_id}`);
            // Update the user data
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
            // Create a new user
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

        // Emit success response
        ackCallback({ success: true });

        // Broadcast user data update
        socket.broadcast.emit('user_data_update', users[user_id]);

        // Save user data to file (if needed)
        saveUserDataToFile();
    });


    // Event: Update user status
    // socket.on('user_status_online', (data) => {
    //     const { user_id, is_online, last_online } = data;

    //     if (!isValidUserId(user_id)) {
    //         console.error(`Invalid user ID in user_status_online: ${JSON.stringify(data)}`);
    //         return;
    //     }

    //     users[user_id] = { ...users[user_id], socket_id: socket.id, is_online, last_online };
    //     console.log(`User online: ${user_id}, Status: ${is_online ? 'Online' : 'Offline'}`);
    //     socket.broadcast.emit('user_data_update', users[user_id]);
    //     saveUserDataToFile();
    // });

    // Event: Store user's Firebase token and notify others
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

    // Event: Disconnect user
    socket.on('disconnect_user', (key) => {
        const user_id = Object.keys(users).find(userId => users[userId].id === key.user_id);
        console.log(`User ${user_id} is now offline.`);
        console.log(`User ${key.user_id} is now offline.`);
        if (user_id) {
            users[user_id].is_online = false;
            users[user_id].last_online = Date.now();
            console.log(`User ${JSON.stringify(users[user_id])}`);
            socket.broadcast.emit('user_data_update', users[user_id]);
            saveUserDataToFile();
        }
    });

    socket.on('validate_chat_and_save', (chatJson) => {
        const { user_ids, id, name, type } = chatJson;
        console.log(`Chat request: ${chatJson}`);

        const chatExists = Object.values(chats).some(chat => {
            const membersMatch = chat.members.length === new Set(user_ids).size;
            const allUsersPresent = user_ids.every(userId => chat.members.includes(userId));
            return membersMatch && allUsersPresent;
        });
        console.log(`Chat Exist: ${chatExists} }`);
        if (chatExists === true) {
            socket.emit('chat_validation_response', {
                exists: chatExists
            });
            return
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
                if (user) {
                    io.to(user.socket_id).emit('chat_created', chats[id]);
                }
            });
            console.log(`Chat created: ${JSON.stringify(chats[id])}`);
            saveChatsToFile()
        }
    });
    socket.on('send_message', (data, ack) => {
        try {
            // Parse incoming data
            const message = {
                id: data.id,
                content: data.content,
                chat_id: data.chat_id,
                sender_id: data.sender_id,
                recipient_id: data.recipient_id,
                recipient_type: data.recipient_type,
                created_at: data.created_at,
                status: data.status,
                type: data.type || "TEXT",
            };


            if (!messages[message.chat_id]) {
                messages[message.chat_id] = [];
            }
            messages[message.chat_id].push(message);

            if (!chats[message.chat_id]) {
                 chats[message.chat_id].last_message = message.content
            }
            saveMessagesToFile()
            if (message.recipient_type === "individual") {
                const recipientSocketId = getSocketIdByUserId(message.recipient_id);
                console.log("Recepent:", recipientSocketId);
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

            // Acknowledge failure
            if (typeof ack === 'function') {
                ack({ success: false, error: "Failed to deliver message." });
            }
        }
    });
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
});

// Test route for HTTP requests
app.get('/', (req, res) => {
    res.send('<h1>Socket.IO Server is Running</h1>');
});

// Start server
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

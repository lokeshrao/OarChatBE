import express, { Request, Response } from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import admin from 'firebase-admin';


// Initialize Firebase Admin SDK
admin.initializeApp({
    credential: admin.credential.cert('./oarchat-firebase-adminsdk-sopnx-90d680db88.json'),
});

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins during development
        methods: ["GET", "POST"],
    },
});

const dataFile = 'userData.json';
const PORT = 3000;

// User data type definition
interface User {
    id: string;
    name?: string;
    email?: string;
    username?: string;
    socketId?: string;
    is_online?: boolean;
    last_online?: number;
    fb_token?: string;
}

// Object to store user data
let users: Record<string, User> = {};

// Load user data from file
try {
    const data = fs.readFileSync(dataFile, 'utf-8');
    users = JSON.parse(data);
    console.log('User data loaded from file.');
} catch (err) {
    console.error('Error loading user data:', err);
}

// Helper function to save user data to file
function saveUserDataToFile(): void {
    try {
        fs.writeFileSync(dataFile, JSON.stringify(users), 'utf-8');
        console.log('User data saved to file.');
    } catch (err) {
        console.error('Error saving user data:', err);
    }
}

// Validate user ID
function isValidUserId(userId: any): boolean {
    return userId !== "null" && userId !== undefined && typeof userId === 'string' && userId.trim() !== '';
}

// Main Socket.IO connection handler
io.on('connection', (socket: Socket) => {
    const userId = socket.handshake.query.user_id as string;

    if (!isValidUserId(userId)) {
        console.error('Invalid user ID, disconnecting socket:', socket.id);
        socket.disconnect(true);
        return;
    }

    users[userId] = {
        ...users[userId],
        socketId: socket.id,
        is_online: true,
        last_online: Date.now(),
    };
    console.log(`User connected: ${userId}`);
    socket.broadcast.emit('user_data_update', users[userId]);
    saveUserDataToFile();

    // Emit all other users to the newly connected user
    Object.keys(users).forEach((userKey) => {
        if (userKey !== userId) {
            socket.emit('user_data_update', users[userKey]);
        }
    });

    // Event: Create or update a user
    socket.on('create_user', (userData: User) => {
        const { id, name, email, username } = userData;

        if (!isValidUserId(id)) {
            console.error('Invalid user ID in create_user:', userData);
            socket.emit('userCreateResponse', { success: false, message: 'Invalid user ID' });
            return;
        }

        if (users[id]) {
            console.log(`User updated: ${id}`);
            Object.assign(users[id], { name, email, username });
        } else {
            users[id] = { id, name, email, username, socketId: socket.id };
            console.log(`User created: ${id}`);
        }

        socket.emit('userCreateResponse', { success: true });
        socket.broadcast.emit('user_data_update', users[id]);
        saveUserDataToFile();
    });

    // Event: Update user status
    socket.on('user_status_online', (data: { user_id: string; is_online: boolean; last_online: number }) => {
        const { user_id, is_online, last_online } = data;

        if (!isValidUserId(user_id)) {
            console.error('Invalid user ID in user_status_online:', data);
            return;
        }

        users[user_id] = { ...users[user_id], socketId: socket.id, is_online, last_online };
        console.log(`User online: ${user_id}, Status: ${is_online ? 'Online' : 'Offline'}`);
        socket.broadcast.emit('user_data_update', users[user_id]);
        saveUserDataToFile();
    });

    // Event: Store user's Firebase token and notify others
    socket.on('user_fb_token', (data: { user_id: string; fb_token: string }) => {
        const { user_id, fb_token } = data;

        if (!isValidUserId(user_id)) {
            console.error('Invalid user ID in user_fb_token:', data);
            return;
        }

        users[user_id] = { ...users[user_id], fb_token, socketId: socket.id };
        console.log(`User token updated: ${user_id}`);
        saveUserDataToFile();
    });

    // Event: Disconnect user
    socket.on('disconnect_user', (data: { user_id: string; last_online: number }) => {
        const { user_id, last_online } = data;

        if (!isValidUserId(user_id)) {
            console.error('Invalid user ID in disconnect_user:', data);
            return;
        }

        const user = users[user_id];
        if (user) {
            users[user_id].is_online = false;
            users[user_id].last_online = last_online;
            console.log(`User disconnected: ${user_id}`);
            socket.broadcast.emit('user_data_update', users[user_id]);
            saveUserDataToFile();
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        const disconnectedUser = Object.keys(users).find(userId => users[userId].socketId === socket.id);
        if (disconnectedUser) {
            users[disconnectedUser].is_online = false;
            console.log(`User disconnected (socket): ${disconnectedUser}`);
            saveUserDataToFile();
        }
    });
});

// Test route for HTTP requests
app.get('/', (_req: Request, res: Response) => {
    res.send('<h1>Socket.IO Server is Running</h1>');
});

// Start server
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

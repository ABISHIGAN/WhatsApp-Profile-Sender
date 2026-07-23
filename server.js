const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

let client;
let isClientInitializing = false;
let isAuthenticated = false;
let isReady = false;
let currentSocket = null;

function clearAuthSession() {
    const authPath = path.join(__dirname, '.wwebjs_auth');
    const cachePath = path.join(__dirname, '.wwebjs_cache');
    try {
        fs.rmSync(authPath, { recursive: true, force: true });
    } catch (err) {
        console.warn('Failed to clear auth path:', err && err.message);
    }
    try {
        fs.rmSync(cachePath, { recursive: true, force: true });
    } catch (err) {
        console.warn('Failed to clear cache path:', err && err.message);
    }
}

function createClient() {
    isAuthenticated = false;
    isReady = false;
    client = new Client({
        authStrategy: new LocalAuth(),
        authTimeoutMs: 180000,
        takeoverTimeoutMs: 180000,
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            protocolTimeout: 180000,
            timeout: 0
        }
    });

    client.on('qr', (qr) => {
        if (currentSocket) {
            currentSocket.emit('qr', qr);
            currentSocket.emit('clientState', { qr });
        }
    });

    client.on('authenticated', () => {
        isAuthenticated = true;
        if (currentSocket) {
            currentSocket.emit('authenticated');
            currentSocket.emit('clientState', { authenticated: true });
        }
    });

    client.on('ready', () => {
        isReady = true;
        if (currentSocket) {
            currentSocket.emit('ready');
            currentSocket.emit('clientState', { ready: true });
        }
    });

    client.on('auth_failure', (message) => {
        if (currentSocket) {
            currentSocket.emit('authFailure', message || 'Authentication failed.');
        }
    });

    client.on('disconnected', (reason) => {
        if (currentSocket) {
            currentSocket.emit('disconnected', reason || 'unknown');
        }
        client.destroy();
        client = null;
    });

    client.initialize().catch((err) => {
        if (currentSocket) {
            currentSocket.emit('errorMessage', err.message || 'Failed to initialize client.');
        }
        client = null;
        isClientInitializing = false;
    });
}

io.on('connection', (socket) => {
    currentSocket = socket;

    socket.on('startAuthentication', () => {
        if (isReady) {
            socket.emit('clientState', { authenticated: true, ready: true });
            return;
        }

        if (isAuthenticated && !client) {
            socket.emit('errorMessage', 'Client session exists but the client is not available. Reload the page.');
            return;
        }

        if (!client && !isClientInitializing) {
            isClientInitializing = true;
            createClient();
            return;
        }

        if (client && !isReady) {
            socket.emit('clientState', { authenticated: isAuthenticated });
            return;
        }
    });

    socket.on('refreshQR', async () => {
        if (!client) {
            socket.emit('errorMessage', 'No active client to refresh.');
            return;
        }

        client.removeAllListeners();

        try {
            if (typeof client.logout === 'function') {
                await client.logout();
            }
        } catch (err) {
            console.warn('refreshQR logout failed:', err && err.message);
        }

        try {
            await client.destroy();
        } catch (err) {
            console.warn('refreshQR destroy failed:', err && err.message);
        }

        client = null;
        isAuthenticated = false;
        isReady = false;
        isClientInitializing = false;

        clearAuthSession();

        if (currentSocket) {
            currentSocket.emit('loggedOut');
        }

        isClientInitializing = true;
        createClient();
    });

    socket.on('searchGroup', async (groupName) => {
        if (!client || !client.info || !client.info.wid) {
            socket.emit('errorMessage', 'WhatsApp client is not authenticated yet.');
            return;
        }

        try {
            const chats = await client.getChats();
            const group = chats.find(chat => chat.isGroup && (chat.id._serialized === groupName || chat.name.toLowerCase() === groupName.toLowerCase()));

            if (!group) {
                socket.emit('groupNotFound', {
                    query: groupName,
                    groups: chats.filter(c => c.isGroup).map(g => g.name)
                });
                return;
            }

            socket.emit('groupFound', { name: group.name, members: group.participants.length });

            let sent = 0;
            let skipped = 0;
            let withName = 0;
            let withoutName = 0;

            for (const participant of group.participants) {
                const contact = await client.getContactById(participant.id._serialized);
                const name = contact.pushname || contact.name || participant.id.user;
                if (contact.pushname || contact.name) {
                    withName++;
                } else {
                    withoutName++;
                }

                try {
                    const picUrl = await client.getProfilePicUrl(contact.id._serialized);
                    if (picUrl) {
                        const media = await MessageMedia.fromUrl(picUrl, { unsafeMime: true });
                        await group.sendMessage(media, { caption: `📸 ${name}` });
                        sent++;
                        socket.emit('memberStatus', { status: 'sent', name });
                    } else {
                        skipped++;
                        socket.emit('memberStatus', { status: 'noPhoto', name });
                    }
                } catch (err) {
                    skipped++;
                    socket.emit('memberStatus', { status: 'error', name, error: err.message });
                }
            }

            socket.emit('groupStats', { withName, withoutName });
            socket.emit('done', { sent, skipped });
        } catch (err) {
            socket.emit('errorMessage', err.message || 'Unable to search the group.');
        }
    });

    socket.on('disconnect', () => {
        if (currentSocket === socket) {
            currentSocket = null;
        }
    });
});

server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
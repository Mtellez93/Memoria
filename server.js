const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const lobbies = new Map();
const socketLobbyMap = new Map();
const reconnectTimers = new Map();
const RECONNECT_GRACE_MS = 60000;

const cardImages = [
    "https://raw.githubusercontent.com/Mtellez93/Memoria/main/public/img/1.jpg", "https://raw.githubusercontent.com/Mtellez93/Memoria/main/public/img/10.jpg",
    "https://raw.githubusercontent.com/Mtellez93/Memoria/main/public/img/2.jpg", "https://raw.githubusercontent.com/Mtellez93/Memoria/main/public/img/11.jpg",
    "https://raw.githubusercontent.com/Mtellez93/Memoria/main/public/img/3.jpg", "https://raw.githubusercontent.com/Mtellez93/Memoria/main/public/img/12.jpg",
    "https://raw.githubusercontent.com/Mtellez93/Memoria/main/public/img/4.jpg", "https://raw.githubusercontent.com/Mtellez93/Memoria/main/public/img/13.jpg",
    "https://raw.githubusercontent.com/Mtellez93/Memoria/main/public/img/5.jpg", "https://raw.githubusercontent.com/Mtellez93/Memoria/main/public/img/14.jpg",
    "https://raw.githubusercontent.com/Mtellez93/Memoria/main/public/img/6.jpg", "https://raw.githubusercontent.com/Mtellez93/Memoria/main/public/img/15.jpg",
    "https://raw.githubusercontent.com/Mtellez93/Memoria/main/public/img/7.jpg", "https://raw.githubusercontent.com/Mtellez93/Memoria/main/public/img/16.jpg",
    "https://raw.githubusercontent.com/Mtellez93/Memoria/main/public/img/8.jpg", "https://raw.githubusercontent.com/Mtellez93/Memoria/main/public/img/17.jpg",
    "https://raw.githubusercontent.com/Mtellez93/Memoria/main/public/img/9.jpg", "https://raw.githubusercontent.com/Mtellez93/Memoria/main/public/img/18.jpg"
];

function generateLobbyCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return lobbies.has(code) ? generateLobbyCode() : code;
}

function createLobby(config, hostId) {
    const code = generateLobbyCode();
    const rows = parseInt(config.rows, 10);
    const cols = parseInt(config.cols, 10);
    const maxPlayers = parseInt(config.players, 10);

    lobbies.set(code, {
        code,
        hostId,
        cards: [],
        players: [],
        currentPlayerIndex: 0,
        gameStarted: false,
        canPlay: true,
        flippedCards: [],
        config: { rows, cols, maxPlayers }
    });

    return code;
}

function clearReconnectTimer(clientId) {
    const timer = reconnectTimers.get(clientId);
    if (timer) {
        clearTimeout(timer);
        reconnectTimers.delete(clientId);
    }
}

function bindSocketToLobby(socket, code) {
    const currentCode = socketLobbyMap.get(socket.id);
    if (currentCode && currentCode !== code) {
        socket.leave(currentCode);
    }

    socket.join(code);
    socketLobbyMap.set(socket.id, code);
}

function initGame(lobby) {
    const totalCards = lobby.config.rows * lobby.config.cols;
    const pairsNeeded = totalCards / 2;
    const selectedImages = cardImages.slice(0, pairsNeeded);
    lobby.cards = [...selectedImages, ...selectedImages]
        .sort(() => Math.random() - 0.5)
        .map((url, i) => ({
            id: i,
            url,
            coord: `${String.fromCharCode(65 + (i % lobby.config.cols))}${Math.floor(i / lobby.config.cols) + 1}`,
            isFlipped: false,
            isMatched: false
        }));

    lobby.currentPlayerIndex = 0;
    lobby.gameStarted = true;
    lobby.canPlay = true;
    lobby.flippedCards = [];

    lobby.players.forEach((player) => {
        player.score = 0;
    });
}

function emitLobbyUpdate(code) {
    const lobby = lobbies.get(code);
    if (!lobby) return;
    io.to(code).emit('gameUpdate', {
        code: lobby.code,
        cards: lobby.cards,
        players: lobby.players,
        currentPlayerIndex: lobby.currentPlayerIndex,
        gameStarted: lobby.gameStarted,
        canPlay: lobby.canPlay,
        flippedCards: lobby.flippedCards,
        config: lobby.config
    });
}

function cleanUpLobby(code) {
    const lobby = lobbies.get(code);
    if (!lobby) return;
    if (lobby.players.length === 0 || lobby.hostId === null) {
        lobbies.delete(code);
    }
}

io.on('connection', (socket) => {
    socket.on('createLobby', ({ config, clientId }) => {
        if (!clientId) return;
        socket.data.clientId = clientId;
        const existingCode = socketLobbyMap.get(socket.id);
        if (existingCode) {
            socket.leave(existingCode);
            socketLobbyMap.delete(socket.id);
        }

        const code = createLobby(config, clientId);
        bindSocketToLobby(socket, code);
        clearReconnectTimer(clientId);

        socket.emit('lobbyCreated', { code });
        emitLobbyUpdate(code);
    });

    socket.on('joinLobby', ({ code, name, clientId }) => {
        const normalizedCode = String(code || '').trim().toUpperCase();
        const playerName = String(name || '').trim();
        const normalizedClientId = String(clientId || '').trim();
        const lobby = lobbies.get(normalizedCode);

        if (!normalizedClientId) {
            socket.emit('joinError', 'No se pudo validar tu sesión. Recarga la página.');
            return;
        }

        socket.data.clientId = normalizedClientId;

        if (!lobby) {
            socket.emit('joinError', 'Código de sala inválido.');
            return;
        }

        const existingPlayer = lobby.players.find((p) => p.id === normalizedClientId);

        if (lobby.gameStarted && !existingPlayer) {
            socket.emit('joinError', 'La partida ya comenzó.');
            return;
        }

        if (!playerName) {
            socket.emit('joinError', 'Escribe tu nombre.');
            return;
        }

        if (lobby.players.length >= lobby.config.maxPlayers && !existingPlayer) {
            socket.emit('joinError', 'La sala está llena.');
            return;
        }

        bindSocketToLobby(socket, normalizedCode);
        clearReconnectTimer(normalizedClientId);

        if (!existingPlayer) {
            lobby.players.push({ id: normalizedClientId, name: playerName, score: 0, connected: true });
        } else {
            existingPlayer.connected = true;
            if (playerName) {
                existingPlayer.name = playerName;
            }
        }

        emitLobbyUpdate(normalizedCode);
    });

    socket.on('startGame', ({ code }) => {
        const lobby = lobbies.get(code);
        if (!lobby) return;
        if (socket.data.clientId !== lobby.hostId) return;
        if (lobby.players.length !== lobby.config.maxPlayers) return;
        if (!lobby.players.every((player) => player.connected)) return;

        initGame(lobby);
        emitLobbyUpdate(code);
    });

    socket.on('flipCard', (coord) => {
        const code = socketLobbyMap.get(socket.id);
        const lobby = lobbies.get(code);
        if (!lobby || !lobby.gameStarted) return;

        const player = lobby.players[lobby.currentPlayerIndex];
        if (!lobby.canPlay || !player || player.id !== socket.data.clientId) return;

        const card = lobby.cards.find((c) => c.coord === coord);
        if (!card || card.isFlipped || card.isMatched) return;

        card.isFlipped = true;
        lobby.flippedCards.push(card);
        emitLobbyUpdate(code);

        if (lobby.flippedCards.length === 2) {
            lobby.canPlay = false;
            const [c1, c2] = lobby.flippedCards;

            if (c1.url === c2.url) {
                c1.isMatched = c2.isMatched = true;
                player.score++;
                lobby.flippedCards = [];
                lobby.canPlay = true;
                if (lobby.cards.every((c) => c.isMatched)) {
                    io.to(code).emit('gameOver', lobby.players);
                }
            } else {
                setTimeout(() => {
                    c1.isFlipped = c2.isFlipped = false;
                    lobby.flippedCards = [];
                    lobby.currentPlayerIndex = (lobby.currentPlayerIndex + 1) % lobby.players.length;
                    lobby.canPlay = true;
                    emitLobbyUpdate(code);
                }, 1500);
            }

            emitLobbyUpdate(code);
        }
    });

    socket.on('requestReset', () => {
        const code = socketLobbyMap.get(socket.id);
        const lobby = lobbies.get(code);
        if (!lobby || socket.data.clientId !== lobby.hostId) return;

        io.to(code).emit('goToMenu');
        lobby.gameStarted = false;
        lobby.cards = [];
        lobby.players = [];
        lobby.flippedCards = [];
        emitLobbyUpdate(code);
    });

    socket.on('disconnect', () => {
        const code = socketLobbyMap.get(socket.id);
        socketLobbyMap.delete(socket.id);
        if (!code) return;

        const lobby = lobbies.get(code);
        if (!lobby) return;

        const clientId = socket.data.clientId;
        if (!clientId) return;

        const playerIndex = lobby.players.findIndex((p) => p.id === clientId);
        if (playerIndex !== -1) {
            lobby.players[playerIndex].connected = false;
            emitLobbyUpdate(code);
        }

        clearReconnectTimer(clientId);
        const timeout = setTimeout(() => {
            reconnectTimers.delete(clientId);

            const activeLobby = lobbies.get(code);
            if (!activeLobby) return;

            if (activeLobby.hostId === clientId) {
                io.to(code).emit('goToMenu');
                lobbies.delete(code);
                return;
            }

            const activePlayerIndex = activeLobby.players.findIndex((p) => p.id === clientId);
            if (activePlayerIndex !== -1 && !activeLobby.players[activePlayerIndex].connected) {
                activeLobby.players.splice(activePlayerIndex, 1);
                if (activeLobby.currentPlayerIndex >= activeLobby.players.length) {
                    activeLobby.currentPlayerIndex = 0;
                }
                emitLobbyUpdate(code);
            }

            cleanUpLobby(code);
        }, RECONNECT_GRACE_MS);

        reconnectTimers.set(clientId, timeout);

        cleanUpLobby(code);
    });

    socket.on('registerClient', ({ clientId, role, code, name }) => {
        const normalizedClientId = String(clientId || '').trim();
        if (!normalizedClientId) return;

        socket.data.clientId = normalizedClientId;

        if (role === 'mobile' && code && name) {
            socket.emit('resumeJoin', { code, name, clientId: normalizedClientId });
            return;
        }

        if (role === 'host' && code) {
            const lobby = lobbies.get(code);
            if (lobby && lobby.hostId === normalizedClientId) {
                bindSocketToLobby(socket, code);
                clearReconnectTimer(normalizedClientId);
                socket.emit('hostRejoined', { code });
                emitLobbyUpdate(code);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));

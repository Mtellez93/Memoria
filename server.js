const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let gameState = {
    cards: [],
    players: [],
    currentPlayerIndex: 0,
    gameStarted: false,
    canPlay: true,
    flippedCards: [],
    config: { rows: 4, cols: 4, maxPlayers: 1 }
};

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

function initGame(rows, cols, maxPlayers) {
    const totalCards = rows * cols;
    const pairsNeeded = totalCards / 2;
    let selectedImages = cardImages.slice(0, pairsNeeded);
    let cardsDeck = [...selectedImages, ...selectedImages]
        .sort(() => Math.random() - 0.5)
        .map((url, i) => ({
            id: i,
            url: url,
            coord: `${String.fromCharCode(65 + (i % cols))}${Math.floor(i / cols) + 1}`,
            isFlipped: false,
            isMatched: false
        }));

    gameState = {
        cards: cardsDeck,
        players: [],
        currentPlayerIndex: 0,
        gameStarted: true,
        canPlay: true,
        flippedCards: [],
        config: { rows, cols, maxPlayers }
    };
}

io.on('connection', (socket) => {
    socket.emit('gameUpdate', gameState);

    socket.on('startGame', (config) => {
        initGame(parseInt(config.rows), parseInt(config.cols), parseInt(config.players));
        io.emit('gameUpdate', gameState);
    });

    socket.on('joinGame', (name) => {
        if (gameState.players.length < gameState.config.maxPlayers) {
            gameState.players.push({ id: socket.id, name: name, score: 0 });
            io.emit('gameUpdate', gameState);
        }
    });

    socket.on('flipCard', (coord) => {
        const player = gameState.players[gameState.currentPlayerIndex];
        if (!gameState.canPlay || !player || player.id !== socket.id) return;

        const card = gameState.cards.find(c => c.coord === coord);
        if (!card || card.isFlipped || card.isMatched) return;

        card.isFlipped = true;
        gameState.flippedCards.push(card);
        io.emit('gameUpdate', gameState);

        if (gameState.flippedCards.length === 2) {
            gameState.canPlay = false;
            const [c1, c2] = gameState.flippedCards;

            if (c1.url === c2.url) {
                c1.isMatched = c2.isMatched = true;
                player.score++;
                gameState.flippedCards = [];
                gameState.canPlay = true;
                if (gameState.cards.every(c => c.isMatched)) io.emit('gameOver', gameState.players);
            } else {
                setTimeout(() => {
                    c1.isFlipped = c2.isFlipped = false;
                    gameState.flippedCards = [];
                    gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
                    gameState.canPlay = true;
                    io.emit('gameUpdate', gameState);
                }, 1500);
            }
            io.emit('gameUpdate', gameState);
        }
    });

    socket.on('requestReset', () => {
        gameState.gameStarted = false;
        io.emit('goToMenu');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));

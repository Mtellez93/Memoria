const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSnoYk8Oag6BHpzOLK3JFWjuOLxaY0fuM4e-fyUevQ5E-2oXBBJnf31-6biWM_YWfwApOQ6WvXwFme1/pub?output=csv";

let gameState = {
    cards: [],
    selectedCards: [],
    canPlay: false,
    players: [], // { id, name, score }
    currentPlayerIndex: 0,
    gameStarted: false,
    config: { rows: 4, cols: 4 }
};

async function initGame(rows, cols, numPlayers) {
    try {
        const res = await axios.get(CSV_URL);
        const rowsCSV = res.data.split('\n').slice(1);
        let allImages = rowsCSV.map(r => {
            const [id, url] = r.split(',');
            return { id: id.trim(), url: url.trim() };
        });

        const totalCards = rows * cols;
        const numPairs = totalCards / 2;
        
        let selectedImages = allImages.slice(0, numPairs);
        let deck = [...selectedImages, ...selectedImages].sort(() => Math.random() - 0.5);

        const colLabels = ['A', 'B', 'C', 'D', 'E', 'F'];
        gameState.cards = deck.map((card, i) => ({
            ...card,
            coord: `${colLabels[i % cols]}${Math.floor(i / cols) + 1}`,
            isFlipped: false,
            isMatched: false
        }));

        gameState.players = Array.from({ length: numPlayers }, (_, i) => ({
            id: i,
            name: `Jugador ${i + 1}`,
            score: 0
        }));

        gameState.currentPlayerIndex = 0;
        gameState.gameStarted = true;
        gameState.canPlay = true;
        gameState.config = { rows, cols };
        
        io.emit('gameUpdate', gameState);
    } catch (e) { console.error(e); }
}

app.use(express.static('public'));

io.on('connection', (socket) => {
    socket.emit('gameUpdate', gameState);

    socket.on('startGame', ({ rows, cols, players }) => {
        initGame(parseInt(rows), parseInt(cols), parseInt(players));
    });

    socket.on('flipCard', (coord) => {
        if (!gameState.canPlay) return;
        const card = gameState.cards.find(c => c.coord === coord);
        if (!card || card.isFlipped || card.isMatched) return;

        card.isFlipped = true;
        gameState.selectedCards.push(card);
        io.emit('gameUpdate', gameState);

        if (gameState.selectedCards.length === 2) {
            gameState.canPlay = false;
            const [c1, c2] = gameState.selectedCards;

            if (c1.id === c2.id) {
                // Acierto: Punto para el jugador actual y sigue su turno
                gameState.players[gameState.currentPlayerIndex].score++;
                c1.isMatched = true;
                c2.isMatched = true;
                gameState.selectedCards = [];
                gameState.canPlay = true;
                io.emit('gameUpdate', gameState);
                // Verificar si terminó el juego
                if (gameState.cards.every(c => c.isMatched)) {
                    io.emit('gameOver', gameState.players);
                }
            } else {
                // Fallo: Cambia el turno después de 2 segundos
                setTimeout(() => {
                    c1.isFlipped = false;
                    c2.isFlipped = false;
                    gameState.selectedCards = [];
                    gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
                    gameState.canPlay = true;
                    io.emit('gameUpdate', gameState);
                }, 2000);
            }
        }
    });
});

server.listen(process.env.PORT || 3000);

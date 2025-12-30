const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSnoYk8Oag6BHpzOLK3JFWjuOLxaY0fuM4e-fyUevQ5E-2oXBBJnf31-6biWM_YWfwApOQ6WvXwFme1/pub?output=csv";

let gameState = {
    cards: [],
    selectedCards: [], // Para comparar las dos cartas volteadas
    canPlay: true
};

// Función para obtener y preparar las cartas
async function initGame() {
    try {
        const res = await axios.get(CSV_URL);
        const rows = res.data.split('\n').slice(1);
        let baseCards = rows.map(row => {
            const [id, url] = row.split(',');
            return { id: id.trim(), url: url.trim() };
        });

        // Tomamos solo 8 imágenes para hacer un tablero 4x4 (16 cartas)
        baseCards = baseCards.slice(0, 8);
        let deck = [...baseCards, ...baseCards]; // Duplicar para pares
        deck = deck.sort(() => Math.random() - 0.5); // Mezclar

        const cols = ['A', 'B', 'C', 'D'];
        gameState.cards = deck.map((card, i) => ({
            ...card,
            coord: `${cols[i % 4]}${Math.floor(i / 4) + 1}`,
            isFlipped: false,
            isMatched: false
        }));
        
        console.log("Juego inicializado con", gameState.cards.length, "cartas.");
    } catch (e) { console.error("Error cargando Sheets:", e); }
}

initGame();

app.use(express.static('public'));

io.on('connection', (socket) => {
    // Enviar estado actual al conectar
    socket.emit('updateBoard', gameState.cards);

    socket.on('flipCard', (coord) => {
        if (!gameState.canPlay) return;

        const card = gameState.cards.find(c => c.coord === coord);
        if (!card || card.isFlipped || card.isMatched) return;

        card.isFlipped = true;
        gameState.selectedCards.push(card);
        io.emit('updateBoard', gameState.cards);

        if (gameState.selectedCards.length === 2) {
            gameState.canPlay = false;
            const [c1, c2] = gameState.selectedCards;

            if (c1.id === c2.id) {
                // ¡Par encontrado!
                c1.isMatched = true;
                c2.isMatched = true;
                gameState.selectedCards = [];
                gameState.canPlay = true;
                io.emit('updateBoard', gameState.cards);
            } else {
                // No son iguales, esperar 2 segundos y voltear de nuevo
                setTimeout(() => {
                    c1.isFlipped = false;
                    c2.isFlipped = false;
                    gameState.selectedCards = [];
                    gameState.canPlay = true;
                    io.emit('updateBoard', gameState.cards);
                }, 2000);
            }
        }
    });

    socket.on('resetGame', () => {
        initGame().then(() => io.emit('updateBoard', gameState.cards));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Rota de contatos
app.get('/api/contatos', (req, res) => {
    fs.readFile('contatos.json', 'utf8', (err, data) => {
        if (err) res.status(500).json([]);
        else res.json(JSON.parse(data));
    });
});

io.on('connection', (socket) => {
    console.log('Usuário conectado:', socket.id);

    // 1. Chat de Texto
    socket.on('chat-msg', (msg) => {
        socket.broadcast.emit('chat-msg', msg); // Envia para os outros
    });

    // 2. WebRTC - Sinais para Chamada de Voz (Offer, Answer, ICE Candidates)
    socket.on('offer', (payload) => {
        socket.broadcast.emit('offer', payload);
    });

    socket.on('answer', (payload) => {
        socket.broadcast.emit('answer', payload);
    });

    socket.on('candidate', (payload) => {
        socket.broadcast.emit('candidate', payload);
    });

    socket.on('hangup', () => {
        socket.broadcast.emit('hangup');
    });
});

server.listen(3000, () => {
    console.log('Servidor rodando em http://localhost:3000');
});
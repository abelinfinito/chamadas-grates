const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

// Configuração do Socket.io preparada para produção
const io = new Server(server, { 
    cors: { origin: "*" }, 
    maxHttpBufferSize: 1e7 // 10MB para áudio/voz
});

// Servir ficheiros estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));

let users = {}; 

// Rotas da API com caminhos absolutos (evita erros na Render)
app.get('/api/contatos', (req, res) => {
    const filePath = path.join(__dirname, 'contatos.json');
    if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        res.json(JSON.parse(data));
    } else {
        res.json([]); // Retorna vazio se o ficheiro não existir
    }
});

app.get('/api/grupos', (req, res) => {
    const filePath = path.join(__dirname, 'grupos.json');
    if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        res.json(JSON.parse(data));
    } else {
        res.json([]);
    }
});

io.on('connection', (socket) => {
    socket.on('login', (numero) => {
        users[numero] = socket.id;
        socket.myNumber = numero;
        io.emit('online-users', Object.keys(users)); 
    });

    socket.on('logout', () => {
        if (socket.myNumber) {
            delete users[socket.myNumber];
            io.emit('online-users', Object.keys(users));
        }
    });

    socket.on('private-msg', (data) => {
        const target = users[data.to];
        if (target) io.to(target).emit('chat-msg', { from: socket.myNumber, text: data.text, type: data.type });
    });

    // WebRTC Sinalização
    socket.on('offer', d => users[d.target] && io.to(users[d.target]).emit('offer', { sdp: d.sdp, from: socket.myNumber }));
    socket.on('answer', d => users[d.target] && io.to(users[d.target]).emit('answer', { sdp: d.sdp }));
    socket.on('candidate', d => users[d.target] && io.to(users[d.target]).emit('candidate', { candidate: d.candidate }));
    socket.on('hangup', d => users[d.target] && io.to(users[d.target]).emit('hangup'));

    socket.on('disconnect', () => {
        if (socket.myNumber) {
            delete users[socket.myNumber];
            io.emit('online-users', Object.keys(users));
        }
    });
});

// --- AJUSTE DA PORTA PARA A RENDER ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor ANGO ZAP a rodar na porta ${PORT}`);
});
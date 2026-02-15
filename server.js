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
let usersMeta = {}; // { numero: { name, guest, cooldownUntil } }
let activeCallTimers = {}; // key -> timeoutId

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
    socket.on('login', (data) => {
        // data can be a string (numero) or an object { numero, guest, nome }
        let numero = data, guest = false, nome = null;
        if (typeof data === 'object') {
            numero = data.numero;
            guest = !!data.guest;
            nome = data.nome || null;
        }

        users[numero] = socket.id;
        socket.myNumber = numero;
        socket.isGuest = guest;
        socket.userName = nome || null;

        usersMeta[numero] = usersMeta[numero] || {};
        usersMeta[numero].name = socket.userName || usersMeta[numero].name || null;
        usersMeta[numero].guest = !!guest;
        usersMeta[numero].cooldownUntil = usersMeta[numero].cooldownUntil || null;

        io.emit('online-users', Object.keys(users));
        io.emit('user-meta', { numero, meta: usersMeta[numero] });
    });

    socket.on('logout', () => {
        if (socket.myNumber) {
            const num = socket.myNumber;
            delete users[num];
            delete usersMeta[num];
            io.emit('online-users', Object.keys(users));
            io.emit('user-meta', { numero: num, meta: null });
        }
    });

    socket.on('private-msg', (data) => {
        const target = users[data.to];
        if (target) io.to(target).emit('chat-msg', { from: socket.myNumber, text: data.text, type: data.type });
    });

    // TYPING INDICATOR (encaminha status de escrita)
    socket.on('typing', (d) => {
        const target = users[d.to];
        if (target) io.to(target).emit('typing', { from: socket.myNumber, typing: !!d.typing });
    });

    // WebRTC Sinalização
    socket.on('offer', (d) => {
        const caller = socket.myNumber;
        const callerMeta = usersMeta[caller] || {};
        // se for convidado em cooldown, recusa
        if (callerMeta.guest && callerMeta.cooldownUntil && callerMeta.cooldownUntil > Date.now()) {
            socket.emit('call-denied', { reason: 'cooldown', wait: Math.ceil((callerMeta.cooldownUntil - Date.now())/1000) });
            return;
        }
        if (users[d.target]) io.to(users[d.target]).emit('offer', { sdp: d.sdp, from: caller });
    });

    // Ao receber resposta, inicia temporizador se houver convidado (3 minutos)
    socket.on('answer', (d) => {
        const caller = d.target;
        const callee = socket.myNumber;
        if (users[caller]) io.to(users[caller]).emit('answer', { sdp: d.sdp });

        const callerMeta = usersMeta[caller] || {};
        const calleeMeta = usersMeta[callee] || {};
        if (callerMeta.guest || calleeMeta.guest) {
            const callKey = [caller, callee].sort().join('|');
            if (activeCallTimers[callKey]) clearTimeout(activeCallTimers[callKey]);
            // encerrar chamada automaticamente após 3 minutos quando há convidado
            activeCallTimers[callKey] = setTimeout(() => {
                if (users[caller]) io.to(users[caller]).emit('hangup');
                if (users[callee]) io.to(users[callee]).emit('hangup');

                const cooldownUntil = Date.now() + 5 * 60 * 1000; // 5 minutos
                if (callerMeta.guest) usersMeta[caller].cooldownUntil = cooldownUntil;
                if (calleeMeta.guest) usersMeta[callee].cooldownUntil = cooldownUntil;

                if (users[caller]) io.to(users[caller]).emit('guest-call-ended', { reason: 'time_limit', cooldown: 5*60 });
                if (users[callee]) io.to(users[callee]).emit('guest-call-ended', { reason: 'time_limit', cooldown: 5*60 });

                delete activeCallTimers[callKey];
                io.emit('user-meta', { numero: caller, meta: usersMeta[caller] || null });
                io.emit('user-meta', { numero: callee, meta: usersMeta[callee] || null });
            }, 3 * 60 * 1000);
        }
    });

    socket.on('candidate', (d) => { if (users[d.target]) io.to(users[d.target]).emit('candidate', { candidate: d.candidate }); });

    socket.on('hangup', (d) => {
        if (users[d.target]) io.to(users[d.target]).emit('hangup');
        // limpa timers relacionados à chamada
        Object.keys(activeCallTimers).forEach(k => {
            if (k.includes(socket.myNumber || '') || k.includes(d.target || '')) {
                clearTimeout(activeCallTimers[k]);
                delete activeCallTimers[k];
            }
        });
    });

    socket.on('disconnect', () => {
        if (socket.myNumber) {
            const num = socket.myNumber;
            delete users[num];
            delete usersMeta[num];
            io.emit('online-users', Object.keys(users));
            io.emit('user-meta', { numero: num, meta: null });
        }
    });
});

// --- AJUSTE PARA RODAR NO PC E NA RENDER ---
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    // Se estiver no PC (onde a porta costuma ser 3000), mostra o link do localhost
    if (PORT == 3000) {
        console.log('✅ Servidor LOCAL iniciado!');
        console.log(`👉 Aceda em: http://localhost:${PORT}`);
    } else {
        // Se estiver na Render, apenas confirma que está online
        console.log(`✅ Servidor ONLINE na porta ${PORT}`);
    }
});
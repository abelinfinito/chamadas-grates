const socket = io();

// Elementos do DOM
const contactListEl = document.getElementById('contact-list');
const searchInput = document.getElementById('search-input');
const messagesArea = document.getElementById('messages-area');
const msgInput = document.getElementById('msg-input');
const btnSend = document.getElementById('btn-send');
const btnCall = document.getElementById('btn-call');
const btnHangup = document.getElementById('btn-hangup');
const callStatus = document.getElementById('call-status');
const localAudio = document.getElementById('localAudio');
const remoteAudio = document.getElementById('remoteAudio');

let allContacts = []; // Variável global para guardar os dados do JSON

// --- 1. FUNÇÃO PARA DESENHAR OS CONTACTOS NA TELA ---
function renderContacts(contacts) {
    // IMPORTANTE: Limpa a lista antes de desenhar
    contactListEl.innerHTML = ''; 

    if (contacts.length === 0) {
        contactListEl.innerHTML = '<p style="padding:10px; color:gray;">Nenhum contacto encontrado.</p>';
        return;
    }

    contacts.forEach(c => {
        const div = document.createElement('div');
        div.className = 'contact';
        div.innerHTML = `
            <div class="avatar"></div> 
            <div>
                <strong>${c.nome}</strong><br>
                <small>${c.numero}</small>
            </div>
        `;
        
        // Ao clicar no contacto, seleciona para o chat
        div.onclick = () => {
            document.querySelector('#chat-title strong').textContent = c.nome;
            callStatus.textContent = "Visto por último: " + c.status;
            messagesArea.innerHTML = ''; // Limpa as mensagens ao trocar de contacto
        };
        contactListEl.appendChild(div);
    });
}

// --- 2. CARREGAR CONTACTOS DO SERVIDOR ---
fetch('/api/contatos')
    .then(res => res.json())
    .then(data => {
        allContacts = data; // Guarda na variável global
        renderContacts(allContacts); // Mostra todos ao abrir
    })
    .catch(err => {
        console.error("Erro ao carregar JSON:", err);
        contactListEl.innerHTML = "Erro ao carregar contactos.";
    });

// --- 3. LÓGICA DE PESQUISA (O QUE FALTAVA) ---
searchInput.addEventListener('keyup', () => {
    const termo = searchInput.value.toLowerCase().trim();
    
    // Filtra tanto por nome quanto por número
    const filtrados = allContacts.filter(c => {
        return c.nome.toLowerCase().includes(termo) || c.numero.includes(termo);
    });

    renderContacts(filtrados); // Redesenha a lista com o filtro
});

// --- 4. RESTANTE DA LÓGICA (CHAT E VOZ) ---

// Enviar Mensagem de Texto
function sendMessage() {
    const text = msgInput.value.trim();
    if (text === '') return;

    addMessage(text, 'sent');
    socket.emit('chat-msg', text);
    msgInput.value = '';
}

btnSend.onclick = sendMessage;
msgInput.onkeypress = (e) => { if(e.key === 'Enter') sendMessage(); };

socket.on('chat-msg', (msg) => {
    addMessage(msg, 'received');
});

function addMessage(text, type) {
    const div = document.createElement('div');
    div.classList.add('message', type === 'sent' ? 'msg-sent' : 'msg-received');
    div.textContent = text;
    messagesArea.appendChild(div);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

// Lógica de Chamada (WebRTC)
let localStream;
let peerConnection;
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

btnCall.onclick = async () => {
    callStatus.textContent = "Iniciando chamada...";
    btnCall.style.display = 'none';
    btnHangup.style.display = 'inline-block';
    
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localAudio.srcObject = localStream;
    createPeerConnection();
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', offer);
};

socket.on('offer', async (offer) => {
    if (!peerConnection) {
        btnCall.style.display = 'none';
        btnHangup.style.display = 'inline-block';
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        createPeerConnection();
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }
    await peerConnection.setRemoteDescription(offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', answer);
});

socket.on('answer', (answer) => {
    callStatus.textContent = "📞 Em chamada";
    peerConnection.setRemoteDescription(answer);
});

socket.on('candidate', (candidate) => {
    if (peerConnection) peerConnection.addIceCandidate(candidate);
});

socket.on('hangup', () => endCall());
btnHangup.onclick = () => { socket.emit('hangup'); endCall(); };

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);
    peerConnection.onicecandidate = (e) => { if (e.candidate) socket.emit('candidate', e.candidate); };
    peerConnection.ontrack = (e) => { remoteAudio.srcObject = e.streams[0]; };
}

function endCall() {
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); }
    callStatus.textContent = "Chamada terminada";
    btnCall.style.display = 'inline-block';
    btnHangup.style.display = 'none';
}
const socket = io();
let myNumber, myName, currentTarget, allContacts = [], allGroups = [], onlineUsers = [];
let peerConnection, localStream, timerInterval, seconds = 0;
let mediaRecorder, audioChunks = [], voiceTimerInterval, voiceSeconds = 0;

// Carregar Dados Iniciais
Promise.all([
    fetch('/api/contatos').then(r => r.json()),
    fetch('/api/grupos').then(r => r.json())
]).then(([c, g]) => { 
    allContacts = c; 
    allGroups = g; 
});

// LOGIN
function tentarLogin() {
    const num = document.getElementById('login-input').value;
    const user = allContacts.find(u => u.numero === num);
    if (user) {
        myNumber = num; 
        myName = user.nome;
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('user-greeting').innerText = `Bem-vindo, ${myName}`;
        socket.emit('login', myNumber);
    } else {
        alert("Acesso negado: Número não registado!");
    }
}

function sair() { 
    socket.emit('logout');
    location.reload(); 
}

function toggleMenu() { document.getElementById('sidebar').classList.toggle('open'); }

// ATUALIZAÇÃO DE USUÁRIOS ONLINE
socket.on('online-users', (list) => {
    onlineUsers = list;
    renderSidebar();
});

function renderSidebar() {
    const onlineList = document.getElementById('online-list');
    onlineList.innerHTML = '';
    
    allContacts.filter(c => onlineUsers.includes(c.numero) && c.numero !== myNumber).forEach(c => {
        const div = document.createElement('div');
        div.style.cssText = 'padding: 15px; cursor: pointer; border-bottom: 1px solid #f2f2f2;';
        div.innerHTML = `🟢 <strong>${c.nome}</strong><div style="font-size:12px;color:#999">${c.numero}</div>`;
        div.onclick = () => selectTarget(c.numero, c.nome);
        onlineList.appendChild(div);
    });

    const groupList = document.getElementById('group-list');
    groupList.innerHTML = '';
    allGroups.forEach(g => {
        const div = document.createElement('div');
        div.style.cssText = 'padding: 15px; cursor: pointer; border-bottom: 1px solid #f2f2f2;';
        div.innerHTML = `👥 <strong>${g.nome}</strong><div style="font-size:12px;color:#999">Grupo</div>`;
        div.onclick = () => selectTarget(g.id, g.nome);
        groupList.appendChild(div);
    });
}

function selectTarget(id, nome) {
    currentTarget = id;
    document.getElementById('chat-title').innerText = nome;
    document.getElementById('messages').innerHTML = '';
    document.getElementById('chat-status').innerText = 'Online';
    if(document.getElementById('sidebar').classList.contains('open')) toggleMenu();
}

// CHAT DE TEXTO
function enviarTexto() {
    const input = document.getElementById('msg-input');
    if (!input.value || !currentTarget) return;
    socket.emit('private-msg', { to: currentTarget, text: input.value, type: 'text' });
    addMsg(input.value, 'sent');
    input.value = '';
}

// GRAVAÇÃO DE VOZ (ESTILO WHATSAPP)
async function iniciarGravacao() {
    if (!currentTarget) return alert("Selecione um contacto!");
    
    try {
        audioChunks = [];
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(localStream);
        
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = () => {
            if (audioChunks.length > 0) {
                const blob = new Blob(audioChunks, { type: 'audio/ogg; codecs=opus' });
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                reader.onloadend = () => {
                    socket.emit('private-msg', { to: currentTarget, text: reader.result, type: 'audio' });
                    addMsg(reader.result, 'sent', 'audio');
                };
            }
        };

        mediaRecorder.start();
        document.getElementById('normal-input').style.display = 'none';
        document.getElementById('recording-ui').style.display = 'flex';
        
        voiceSeconds = 0;
        voiceTimerInterval = setInterval(() => {
            voiceSeconds++;
            const m = String(Math.floor(voiceSeconds/60)).padStart(2,'0');
            const s = String(voiceSeconds%60).padStart(2,'0');
            document.getElementById('voice-timer').innerText = `${m}:${s}`;
        }, 1000);
    } catch(e) { alert("Microfone não disponível."); }
}

function pararEEnviar() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
        resetVoiceUI();
    }
}

function cancelarGravacao() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        audioChunks = []; 
        mediaRecorder.stop();
        resetVoiceUI();
    }
}

function resetVoiceUI() {
    clearInterval(voiceTimerInterval);
    document.getElementById('normal-input').style.display = 'flex';
    document.getElementById('recording-ui').style.display = 'none';
    if(localStream) localStream.getTracks().forEach(t => t.stop());
}

// RECEBIMENTO DE MENSAGENS
socket.on('chat-msg', d => {
    if (d.from === currentTarget || allGroups.find(g => g.id === currentTarget)) {
        addMsg(d.text, 'received', d.type);
    }
});

// ... (Lógica de Socket e WebRTC anterior permanece igual) ...

// Adiciona isto para o scroll automático sempre que uma mensagem chega
function addMsg(content, cl, type = 'text') {
    const d = document.createElement('div');
    d.className = `msg ${cl}`;
    if (type === 'audio') {
        const audio = document.createElement('audio');
        audio.src = content; audio.controls = true;
        audio.style.width = '200px';
        d.appendChild(audio);
    } else {
        d.innerText = content;
    }
    const msgContainer = document.getElementById('messages');
    msgContainer.appendChild(d);
    
    // Scroll suave para o fim
    msgContainer.scrollTo({ top: msgContainer.scrollHeight, behavior: 'smooth' });
}

// Garante que o menu fecha ao clicar no "X"
function toggleMenu() {
    const side = document.getElementById('sidebar');
    side.classList.toggle('open');
}

// CHAMADAS DE VOZ (WebRTC)
async function iniciarChamada() {
    if(!currentTarget) return;
    document.getElementById('caller-name').innerText = document.getElementById('chat-title').innerText;
    document.getElementById('call-modal').style.display = 'flex';
    document.getElementById('btn-answer').style.display = 'none';
    document.getElementById('call-label').innerText = "Chamando...";

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
    
    peerConnection.onicecandidate = e => e.candidate && socket.emit('candidate', { target: currentTarget, candidate: e.candidate });
    peerConnection.ontrack = e => document.getElementById('remoteAudio').srcObject = e.streams[0];

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', { target: currentTarget, sdp: offer });
}

socket.on('offer', async d => {
    currentTarget = d.from;
    const user = allContacts.find(u => u.numero === d.from);
    document.getElementById('caller-name').innerText = user ? user.nome : d.from;
    document.getElementById('call-modal').style.display = 'flex';
    document.getElementById('btn-answer').style.display = 'inline-block';
    document.getElementById('call-label').innerText = "A receber chamada...";
    
    peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    await peerConnection.setRemoteDescription(new RTCSessionDescription(d.sdp));
    peerConnection.onicecandidate = e => e.candidate && socket.emit('candidate', { target: d.from, candidate: e.candidate });
    peerConnection.ontrack = e => document.getElementById('remoteAudio').srcObject = e.streams[0];
});

async function atender() {
    document.getElementById('btn-answer').style.display = 'none';
    document.getElementById('call-label').innerText = "Chamada Atendida";
    document.getElementById('call-label').classList.remove('anim-calling');
    document.getElementById('timer').style.display = 'block';
    
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
    
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { target: currentTarget, sdp: answer });
    startCallTimer();
}

socket.on('answer', d => {
    document.getElementById('call-label').innerText = "Chamada Atendida";
    document.getElementById('call-label').classList.remove('anim-calling');
    document.getElementById('timer').style.display = 'block';
    peerConnection.setRemoteDescription(new RTCSessionDescription(d.sdp));
    startCallTimer();
});

function startCallTimer() {
    seconds = 0;
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        seconds++;
        const m = String(Math.floor(seconds/60)).padStart(2,'0');
        const s = String(seconds%60).padStart(2,'0');
        document.getElementById('timer').innerText = `${m}:${s}`;
    }, 1000);
}

function desligar() {
    socket.emit('hangup', { target: currentTarget });
    resetCallUI();
}

socket.on('hangup', () => { 
    resetCallUI(); 
    alert("Chamada encerrada pelo outro usuário."); 
});

socket.on('candidate', d => {
    if(peerConnection) peerConnection.addIceCandidate(new RTCIceCandidate(d.candidate));
});

function resetCallUI() {
    clearInterval(timerInterval);
    if(peerConnection) peerConnection.close();
    if(localStream) localStream.getTracks().forEach(t => t.stop());
    document.getElementById('call-modal').style.display = 'none';
    document.getElementById('timer').style.display = 'none';
    document.getElementById('timer').innerText = "00:00";
    document.getElementById('call-label').innerText = "Chamando...";
    document.getElementById('call-label').classList.add('anim-calling');
}
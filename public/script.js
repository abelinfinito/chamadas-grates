const socket = io();
let myNumber, myName, currentTarget, allContacts = [], allGroups = [], onlineUsers = [];
let peerConnection, localStream, timerInterval, seconds = 0;
let mediaRecorder, audioChunks = [], voiceTimerInterval, voiceSeconds = 0;

// Typing indicator state
let isTyping = false, typingTimeout = null, remoteTypingTimeout = null;

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

function toggleMenu() {
    const side = document.getElementById('sidebar');
    side.classList.toggle('open');
    // ao abrir, foca o campo de pesquisa se existir
    setTimeout(() => {
        const s = document.getElementById('sidebar-search');
        if (side.classList.contains('open') && s) s.focus();
    }, 160);
}

// ATUALIZAÇÃO DE USUÁRIOS ONLINE
socket.on('online-users', (list) => {
    onlineUsers = list;
    renderSidebar();

    // ligar pesquisa (apenas uma vez)
    const s = document.getElementById('sidebar-search');
    if (s && !s._hasListener) {
        s.addEventListener('input', renderSidebar);
        s._hasListener = true;
    }
});

function renderSidebar() {
    const onlineList = document.getElementById('online-list');
    onlineList.innerHTML = '';

    const qEl = document.getElementById('sidebar-search');
    const q = qEl && qEl.value ? qEl.value.trim().toLowerCase() : '';

    const onlineContacts = allContacts.filter(c => onlineUsers.includes(c.numero) && c.numero !== myNumber);
    const filtered = q ? onlineContacts.filter(c => (c.nome || '').toLowerCase().includes(q) || (c.numero || '').includes(q)) : onlineContacts;

    if (filtered.length === 0) {
        onlineList.innerHTML = '<div style="padding:15px;color:#999;font-size:0.95rem;">Nenhum contacto online encontrado</div>';
    } else {
        filtered.forEach(c => {
            const div = document.createElement('div');
            div.style.cssText = 'padding: 12px 15px; cursor: pointer; border-bottom: 1px solid #f2f2f2; display:flex; gap:12px; align-items:center;';
            const avatar = `<div style="width:36px;height:36px;border-radius:50%;background:#f1fbf7;color:#00a884;display:flex;align-items:center;justify-content:center;font-weight:700">${(c.nome||'?').charAt(0).toUpperCase()}</div>`;
            div.innerHTML = `${avatar}<div style="flex:1;min-width:0"><strong style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.nome}</strong><div style="font-size:12px;color:#999">${c.numero}</div></div>`;
            div.onclick = () => selectTarget(c.numero, c.nome);
            onlineList.appendChild(div);
        });
    }

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
    const prevTarget = currentTarget;
    if (isTyping && prevTarget) {
        // informar que deixou de escrever para o contacto anterior
        socket.emit('typing', { to: prevTarget, typing: false });
        isTyping = false;
        clearTimeout(typingTimeout);
    }

    currentTarget = id;
    document.getElementById('chat-title').innerText = nome;
    document.getElementById('messages').innerHTML = '';
    document.getElementById('chat-status').innerText = 'Online';
    hideTypingIndicator();
    if(document.getElementById('sidebar').classList.contains('open')) toggleMenu();
}

// CHAT DE TEXTO
function enviarTexto() {
    const input = document.getElementById('msg-input');
    if (!input.value || !currentTarget) return;
    socket.emit('private-msg', { to: currentTarget, text: input.value, type: 'text' });
    addMsg(input.value, 'sent');
    input.value = '';

    // informar que deixou de escrever
    if (isTyping) {
        isTyping = false;
        clearTimeout(typingTimeout);
        socket.emit('typing', { to: currentTarget, typing: false });
    }
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
        // ao receber mensagem, remove indicador de escrita
        if (d.from === currentTarget) hideTypingIndicator();
    }
});

// Indicador de escrita (recebe do servidor)
socket.on('typing', (d) => {
    if (!currentTarget) return;
    if (d.from === currentTarget) {
        if (d.typing) {
            const contact = allContacts.find(c => c.numero === d.from);
            showTypingIndicator(contact ? contact.nome : d.from);
        } else {
            hideTypingIndicator();
        }
    }
});

function showTypingIndicator(name) {
    const el = document.getElementById('typing-indicator');
    const nameEl = document.getElementById('typing-name');
    if (!el || !nameEl) return;
    nameEl.innerText = `${name} está a escrever...`;
    el.classList.add('show');
    clearTimeout(remoteTypingTimeout);
    remoteTypingTimeout = setTimeout(() => el.classList.remove('show'), 4000);
}

function hideTypingIndicator() {
    const el = document.getElementById('typing-indicator');
    if (!el) return;
    el.classList.remove('show');
    clearTimeout(remoteTypingTimeout);
}

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

// --- PARTE DE QUEM RECEBE A CHAMADA ---

socket.on('offer', async (d) => {
    // 1. Resetar estados anteriores
    if (peerConnection) peerConnection.close();
    
    currentTarget = d.from;
    document.getElementById('call-modal').style.display = 'flex';
    document.getElementById('btn-answer').style.display = 'inline-block';
    document.getElementById('caller-name').innerText = d.from;
    document.getElementById('call-label').innerText = "A receber chamada...";

    // 2. Criar a conexão IMEDIATAMENTE ao receber o sinal
    peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // 3. Configurar para receber o teu áudio e tocar no ouvido dele
    peerConnection.ontrack = (event) => {
        const remoteAudio = document.getElementById('remoteAudio');
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.play().catch(e => console.log("Erro autoplay:", e));
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('candidate', { target: currentTarget, candidate: event.candidate });
        }
    };

    // 4. Definir a descrição remota (os teus dados)
    await peerConnection.setRemoteDescription(new RTCSessionDescription(d.sdp));
    
    // 5. Processar fila de candidatos (se houver)
    while (iceQueue.length) {
        await peerConnection.addIceCandidate(iceQueue.shift());
    }
});

// --- A FUNÇÃO MÁGICA QUE VAI CORRIGIR O ERRO ---
async function atender() {
    document.getElementById('btn-answer').style.display = 'none';
    document.getElementById('call-label').innerText = "A conectar áudio...";

    try {
        // PASSO CRUCIAL: Pegar o microfone DELE antes de responder
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Adicionar o microfone dele na conexão para TU ouvires
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        // Só AGORA criamos a resposta. Assim, a resposta já leva a informação do áudio dele.
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit('answer', { target: currentTarget, sdp: answer });

        // Iniciar cronômetro e interface
        document.getElementById('timer').style.display = 'block';
        document.getElementById('call-label').innerText = "Em chamada";
        startTimer();

    } catch (err) {
        console.error("Erro ao atender:", err);
        alert("Erro: O microfone precisa ser permitido para atender.");
    }
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

// Mantém o campo de mensagem visível (resolve movimento com teclado/mobile) e melhora UX do input
(function keepMessageInputVisible() {
    const input = document.getElementById('msg-input');
    const messages = document.getElementById('messages');
    if (!input || !messages) return;

    // Ao focar, garante que a área de mensagens role até ao fim e que o input fique visível
    input.addEventListener('focus', () => {
        setTimeout(() => {
            messages.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' });
            input.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 200);
    });

    // Enviar com Enter (prevent default do comportamento de nova linha)
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            enviarTexto();
        }
    });

    // Notificar "a escrever" (debounced)
    input.addEventListener('input', () => {
        if (!currentTarget) return;
        if (!isTyping) {
            isTyping = true;
            socket.emit('typing', { to: currentTarget, typing: true });
        }
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            isTyping = false;
            socket.emit('typing', { to: currentTarget, typing: false });
        }, 1020);
    });

    // Se o input perder o foco, garante que avisamos que deixámos de escrever
    input.addEventListener('blur', () => {
        if (isTyping) {
            isTyping = false;
            clearTimeout(typingTimeout);
            socket.emit('typing', { to: currentTarget, typing: false });
        }
    });

    // Ao redimensionar (ex.: teclado virtual), mantém scroll no fim
    window.addEventListener('resize', () => {
        messages.scrollTo({ top: messages.scrollHeight });
    });
})();
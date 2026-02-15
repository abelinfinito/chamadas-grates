const socket = io();
const SUPPORT_NUMBER = '0000';
const SUPPORT_NAME = 'Mensagem do Suporte';
let myNumber, myName, currentTarget, allContacts = [], allGroups = [], onlineUsers = [];
let peerConnection, localStream, timerInterval, seconds = 0;
let mediaRecorder, audioChunks = [], voiceTimerInterval, voiceSeconds = 0;

// Typing indicator state
let isTyping = false, typingTimeout = null, remoteTypingTimeout = null;
let onlineMeta = {}; // metadata for online users (guests)
let isGuestUser = false;
let guestCooldownUntil = 0; // timestamp (ms)

// Messages + notifications state
let messagesStore = {}; // { numero: [ { from, text, type, dir, ts } ] }
let unreadCounts = {};


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
        isGuestUser = false;
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('user-greeting').innerText = `Bem-vindo, ${myName}`;
        socket.emit('login', myNumber);
    } else {
        alert("Acesso negado: Número não registado!");
    }
}

function abrirGuestForm() {
    const m = document.getElementById('guest-modal');
    if (m) { m.style.display = 'flex'; m.setAttribute('aria-hidden', 'false'); document.getElementById('guest-name').focus(); }
}
function fecharGuestForm() {
    const m = document.getElementById('guest-modal');
    if (m) { m.style.display = 'none'; m.setAttribute('aria-hidden', 'true'); }
}
function tentarLoginConvidado() {
    const nome = document.getElementById('guest-name').value.trim();
    const numero = document.getElementById('guest-phone').value.trim();
    if (!nome) return alert('Por favor informe o teu nome.');
    if (!/^9\d{8}$/.test(numero)) return alert('Número inválido — tem de começar por 9 e ter 9 dígitos.');

    myNumber = numero;
    myName = nome;
    isGuestUser = true;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('user-greeting').innerText = `Bem-vindo, ${myName}`;
    socket.emit('login', { numero, guest: true, nome });
    fecharGuestForm();
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

    const onlineSet = new Set(onlineUsers.filter(n => n !== myNumber));

    // contacts that are online
    const contacts = allContacts.filter(c => onlineSet.has(c.numero));
    const filteredContacts = q ? contacts.filter(c => (c.nome||'').toLowerCase().includes(q) || (c.numero||'').includes(q)) : contacts;

    // guests / unknown online numbers
    const unknownNumbers = Array.from(onlineSet).filter(n => !allContacts.find(c => c.numero === n));
    const filteredUnknowns = q ? unknownNumbers.filter(n => {
        const meta = onlineMeta[n] || {};
        const name = (meta.name || '').toLowerCase();
        return name.includes(q) || n.includes(q);
    }) : unknownNumbers;

    const combined = [];
    filteredContacts.forEach(c => combined.push({ numero: c.numero, nome: c.nome, isGuest: false }));
    filteredUnknowns.forEach(n => combined.push({ numero: n, nome: (onlineMeta[n] && onlineMeta[n].name) || `Convidado`, isGuest: (n===SUPPORT_NUMBER ? false : (onlineMeta[n] && onlineMeta[n].guest)) }));

    if (combined.length === 0) {
        onlineList.innerHTML = '<div style="padding:15px;color:#999;font-size:0.95rem;">Nenhum contacto online encontrado</div>';
    } else {
        // ordena por mensagens não lidas (primeiro) e depois pela ordem online
        combined.sort((a,b) => (unreadCounts[b.numero] || 0) - (unreadCounts[a.numero] || 0) || (onlineUsers.indexOf(a.numero) - onlineUsers.indexOf(b.numero)));

        combined.forEach(c => {
            const div = document.createElement('div');
            div.className = 'online-item';
            const hasUnread = !!(unreadCounts[c.numero]);
            if (hasUnread) div.classList.add('unread');
            div.style.cssText = 'padding: 12px 15px; cursor: pointer; border-bottom: 1px solid #f2f2f2; display:flex; gap:12px; align-items:center;';
            const avatar = `<div style="width:36px;height:36px;border-radius:50%;background:${c.isGuest? '#fff4ea' : '#f1fbf7'};color:${c.isGuest? '#ff8a00' : '#00a884'};display:flex;align-items:center;justify-content:center;font-weight:700">${(c.nome||'?').charAt(0).toUpperCase()}</div>`;
            const unread = unreadCounts[c.numero] || 0;
            const badge = unread ? `<span class="unread-badge">${unread>99? '99+' : unread}</span>` : '';
            div.innerHTML = `${avatar}<div style="flex:1;min-width:0;display:flex;align-items:center;justify-content:space-between"><div style="min-width:0"><strong style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.nome}</strong><div style="font-size:12px;color:#999">${c.numero}${c.isGuest? ' • Convidado' : ''}</div></div>${badge}</div>`;
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
    document.getElementById('chat-status').innerText = 'Online';
    hideTypingIndicator();

    // renderiza mensagens armazenadas e limpa contador de não lidas
    renderMessagesFor(currentTarget);
    clearUnread(currentTarget);

    if(document.getElementById('sidebar').classList.contains('open')) toggleMenu();
}

// CHAT DE TEXTO
function enviarTexto() {
    const input = document.getElementById('msg-input');
    if (!input.value || !currentTarget) return;
    socket.emit('private-msg', { to: currentTarget, text: input.value, type: 'text' });
    addMsg(input.value, 'sent');
    storeMessage(currentTarget, input.value, 'sent', 'text');
    input.value = '';

    // informar que deixou de escrever
    if (isTyping) {
        isTyping = false;
        clearTimeout(typingTimeout);
        socket.emit('typing', { to: currentTarget, typing: false });
    }
    // limpar badge/local unread
    clearUnread(currentTarget);
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
                    storeMessage(currentTarget, reader.result, 'sent', 'audio');
                    clearUnread(currentTarget);
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
    // guarda a mensagem sempre
    storeMessage(d.from, d.text, 'received', d.type);

    // se estiveres a ver a conversa, mostra imediatamente
    if (d.from === currentTarget || allGroups.find(g => g.id === currentTarget)) {
        addMsg(d.text, 'received', d.type);
        if (d.from === currentTarget) hideTypingIndicator();
    } else {
        // notificação + badge + reordena a lista (fica no topo)
        unreadCounts[d.from] = (unreadCounts[d.from] || 0) + 1;
        bringContactToTop(d.from);
        renderSidebar();

        const contact = allContacts.find(c => c.numero === d.from);
        const name = contact ? contact.nome : (onlineMeta[d.from] && onlineMeta[d.from].name) || d.from;
        showNewMessageToast(name, d.text, d.from);
        showInChatNotification(name, d.from, d.text);
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

// --- Mensagens em memória e notificações ---
function storeMessage(contactNum, text, dir = 'received', type = 'text') {
    if (!contactNum) return;
    messagesStore[contactNum] = messagesStore[contactNum] || [];
    const from = (dir === 'sent') ? myNumber : contactNum;
    messagesStore[contactNum].push({ from, text, type, dir, ts: Date.now() });
}

function renderMessagesFor(contactNum) {
    const container = document.getElementById('messages');
    container.innerHTML = '';
    const msgs = messagesStore[contactNum] || [];
    msgs.forEach(m => addMsg(m.text, m.dir === 'sent' ? 'sent' : 'received', m.type));
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}

function clearUnread(contactNum) {
    if (unreadCounts[contactNum]) {
        delete unreadCounts[contactNum];
        renderSidebar();
    }
}

function bringContactToTop(num) {
    if (!num) return;
    const idx = onlineUsers.indexOf(num);
    if (idx > -1) {
        onlineUsers.splice(idx, 1);
        onlineUsers.unshift(num);
    }
}

function getDisplayName(num){
    if (!num) return '';
    if (num === SUPPORT_NUMBER) return SUPPORT_NAME;
    const c = allContacts.find(u => u.numero === num);
    if (c) return c.nome;
    if (onlineMeta[num] && onlineMeta[num].name) return onlineMeta[num].name;
    return num;
}

function showNewMessageToast(name, text, num) {
    const toast = document.getElementById('new-msg-toast');
    const title = document.getElementById('toast-title');
    const txt = document.getElementById('toast-text');
    if (!toast || !title || !txt) return;
    const displayName = name || getDisplayName(num);
    title.innerText = `Nova mensagem de ${displayName}`;
    txt.innerText = (typeof text === 'string' && text.length > 80) ? text.slice(0,77)+'...' : text;
    toast.classList.add('show');
    toast.style.display = 'flex';
    toast.onclick = () => { selectTarget(num, displayName); toast.classList.remove('show'); toast.style.display = 'none'; };
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.classList.remove('show'); toast.style.display = 'none'; }, 4500);
}

function showInChatNotification(name, num, text) {
    const el = document.getElementById('in-chat-notif');
    if (!el) return;
    const displayName = name || getDisplayName(num);
    el.innerText = `Nova mensagem de ${displayName}`;
    el.style.display = 'block';
    el.onclick = () => selectTarget(num, displayName);
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 6000);
}

// Garante que o menu fecha ao clicar no "X"
function toggleMenu() {
    const side = document.getElementById('sidebar');
    side.classList.toggle('open');
}

// CHAMADAS DE VOZ (WebRTC)
async function iniciarChamada() {
    if(!currentTarget) return;
    // bloqueio local extra para convidados em cooldown (servidor também valida)
    if (isGuestUser && guestCooldownUntil && Date.now() < guestCooldownUntil) {
        const sec = Math.ceil((guestCooldownUntil - Date.now())/1000);
        return alert(`Modo convidado: aguarde ${Math.ceil(sec/60)} minuto(s) antes de fazer nova chamada.`);
    }

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
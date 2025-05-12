const socket = io();

const conversation = document.getElementById('conversation');
const textInput = document.getElementById('text-input');
const sendTextBtn = document.getElementById('send-text');
const startRecordingBtn = document.getElementById('start-recording');
const recordingStatus = document.getElementById('recording-status');
const recordingIndicator = recordingStatus.querySelector('.recording-indicator');
const recordingText = recordingStatus.querySelector('span');
const statusMessage = document.getElementById('status-message');
const audioPlayer = document.getElementById('audio-player');
const autoListenToggle = document.getElementById('auto-listen-toggle');
const assistantLoadingIndicator = document.getElementById('assistant-loading-indicator');
const userLoadingIndicator = document.getElementById('user-loading-indicator');
const modelSelector = document.getElementById('model-selector');
const ttsLangSelector = document.getElementById('tts-lang-selector');

let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let autoListen = true;
let audioContext;
let analyser;
let audioBuffer = [];
let audioSampleRate = 0;
let currentModel = "llama3.1:8b";
let currentTtsLang = "fr";
let isPlayingAudio = false;
let continuousListening = true;
let manualStopped = false;

function init() {
    sendTextBtn.addEventListener('click', sendTextMessage);
    textInput.addEventListener('keypress', handleTextInputKeypress);
    startRecordingBtn.addEventListener('click', toggleRecording);
    
    if (autoListenToggle) {
        autoListenToggle.addEventListener('change', function() {
            autoListen = this.checked;
            setStatus(autoListen ? 'Écoute automatique activée' : 'Écoute automatique désactivée');
            
            if (autoListen && !isRecording && !isPlayingAudio) {
                startRecording();
            }
        });
        autoListenToggle.checked = autoListen;
    }
    
    if (ttsLangSelector) {
        ttsLangSelector.addEventListener('change', function() {
            currentTtsLang = this.value;
            socket.emit('change_tts_lang', { lang: currentTtsLang });
            const langLabel = currentTtsLang === 'fr' ? 'Français' : 'English';
            setStatus(`Langue TTS changée pour ${langLabel}`);
        });
        ttsLangSelector.value = currentTtsLang;
    }
    
    loadAvailableModels();
    
    audioPlayer.addEventListener('ended', handleAudioPlaybackEnded);
    
    setupSocketListeners();
    
    if (continuousListening && autoListen) {
        setTimeout(() => {
            startRecording();
        }, 1000);
    }
}

function loadAvailableModels() {
    fetch('/models')
        .then(response => response.json())
        .then(data => {
            const models = data.models;
            populateModelSelector(models);
        })
        .catch(error => {
            console.error('Erreur lors du chargement des modèles:', error);
            setStatus('Erreur lors du chargement des modèles', true);
        });
}

function populateModelSelector(models) {
    if (!modelSelector) return;
    
    modelSelector.innerHTML = '';
    
    if (Object.keys(models).length > 0) {
        for (const [id, name] of Object.entries(models)) {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = name;
            modelSelector.appendChild(option);
        }
    } else {
        const option = document.createElement('option');
        option.value = 'default';
        option.textContent = 'Aucun modèle disponible';
        modelSelector.appendChild(option);
        modelSelector.disabled = true;
    }
    
    modelSelector.addEventListener('change', function() {
        currentModel = this.value;
        const selectedModelName = models[currentModel] || 'Modèle inconnu';
        socket.emit('change_model', { model: currentModel });
        setStatus(`Modèle changé pour ${selectedModelName}`);
    });
}

function setupSocketListeners() {
    socket.on('connect', () => {
        console.log('Connected to server');
        setStatus('Connecté au serveur');
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        setStatus('Déconnecté du serveur');
    });
    
    socket.on('status', (data) => {
        setStatus(data.message);
    });
    
    socket.on('transcript', (data) => {
        hideUserLoading();
        addMessage('user', data.text);
        showAssistantLoading();
    });
    
    socket.on('response', (data) => {
        hideAssistantLoading();
        
        sendTextBtn.disabled = false;
        textInput.disabled = false;
        
        addMessage('assistant', data.text);
        
        const mots_arret = ["au revoir", "arrête", "stop", "termine", "bye", "goodbye", "exit", "quit", "ciao"];
        const userSaidGoodbye = mots_arret.some(mot => data.lastUserMessage && data.lastUserMessage.toLowerCase().includes(mot));
        
        if (userSaidGoodbye) {
            console.log('Mots d\'arrêt détectés, désactivation de l\'écoute automatique');
            
            if (autoListenToggle) {
                autoListenToggle.checked = false;
                autoListen = false;
            }
        }
        
        if (data.audio) {
            playAudio(data.audio);
        } else if (autoListen && !isRecording && !userSaidGoodbye && !manualStopped) {
            startRecording();
        }
    });
    
    socket.on('error', (data) => {
        hideAssistantLoading();
        hideUserLoading();
        sendTextBtn.disabled = false;
        textInput.disabled = false;
        
        setStatus(data.message, true);
        
        if (autoListen && !isRecording && !isPlayingAudio && !manualStopped) {
            console.log('Relance automatique après erreur de compréhension');
            setTimeout(() => {
                startRecording();
            }, 1000);
        }
    });
    
    socket.on('listening_started', () => {
        console.log('Listening started on server');
    });
    
    socket.on('listening_stopped', () => {
        console.log('Listening stopped on server');
        stopRecording();
    });
}

function handleAudioPlaybackEnded() {
    console.log('Audio playback ended');
    
    isPlayingAudio = false;
    
    recordingText.textContent = 'Inactive';
    
    if (autoListen) {
        console.log('REDÉMARRAGE FORCÉ après réponse audio');
        manualStopped = false;
        setTimeout(() => {
            startRecording();
        }, 500);
    }
}

function showAssistantLoading() {
    const conversation = document.getElementById('conversation');
    conversation.insertAdjacentElement('afterend', assistantLoadingIndicator);
    
    assistantLoadingIndicator.classList.add('active');
    scrollToBottom();
}

function hideAssistantLoading() {
    assistantLoadingIndicator.classList.remove('active');
}

function showUserLoading() {
    userLoadingIndicator.classList.add('active');
    scrollToBottom();
}

function hideUserLoading() {
    userLoadingIndicator.classList.remove('active');
}

function sendTextMessage() {
    const text = textInput.value.trim();
    if (text) {
        addMessage('user', text);
        showAssistantLoading();
        socket.emit('text_input', { text });
        textInput.value = '';
        
        sendTextBtn.disabled = true;
        textInput.disabled = true;
    }
}

function handleTextInputKeypress(e) {
    if (e.key === 'Enter') {
        sendTextMessage();
    }
}

function toggleRecording() {
    if (!isRecording) {
        manualStopped = false;
        startRecording();
    } else {
        manualStopped = true;
        stopRecording();
    }
}

async function startRecording() {
    if (window.isSecureContext === false) {
        setStatus('Le microphone nécessite HTTPS. Utilisez HTTPS ou localhost pour accéder au microphone.', true);
        console.error('Microphone access requires HTTPS or localhost');
        return;
    }
    
    try {
        if (audioContext && audioContext.state !== 'closed') {
            try {
                await audioContext.close();
            } catch (e) {
                console.log("Erreur lors de la fermeture du contexte audio précédent:", e);
            }
        }
        
        isRecording = false;
        audioContext = null;
        analyser = null;
        
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        isRecording = true;
        console.log("Recording started, isRecording set to:", isRecording);
        
        mediaRecorder.addEventListener('dataavailable', event => {
            audioChunks.push(event.data);
        });
        
        mediaRecorder.addEventListener('stop', () => {
            const audioBlob = new Blob(audioChunks);
            processAudio(audioBlob);
            
            stream.getTracks().forEach(track => track.stop());
            if (audioContext) {
                if (audioContext.state !== 'closed') {
                    audioContext.close().catch(e => console.log("Erreur fermeture AudioContext:", e));
                }
            }
        });
        
        mediaRecorder.start(100);
        
        startRecordingBtn.classList.add('recording');
        startRecordingBtn.innerHTML = '<span class="icon">⏹</span> Arrêter';
        recordingIndicator.classList.add('active');
        recordingText.textContent = 'Enregistrement...';
        
        socket.emit('start_listening');
        
    } catch (error) {
        isRecording = false;
        console.error('Error accessing microphone:', error);
        
        if (error.name === 'NotAllowedError') {
            setStatus('Accès au microphone refusé. Veuillez autoriser l\'accès dans les paramètres de votre navigateur.', true);
        } else if (error.name === 'NotFoundError') {
            setStatus('Aucun microphone détecté sur votre appareil.', true);
        } else if (error.name === 'NotReadableError') {
            setStatus('Impossible d\'accéder au microphone. Il est peut-être utilisé par une autre application.', true);
        } else if (error.name === 'SecurityError') {
            setStatus('Accès au microphone bloqué. Utilisez HTTPS pour permettre l\'accès au microphone.', true);
        } else {
            setStatus('Erreur d\'accès au microphone: ' + error.message, true);
        }
    }
}

function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        
        startRecordingBtn.classList.remove('recording');
        startRecordingBtn.innerHTML = '<span class="icon">🎤</span> Parler';
        recordingIndicator.classList.remove('active');
        recordingText.textContent = 'Inactive';
        
        socket.emit('stop_listening');
    }
}

function processAudio(audioBlob) {
    showUserLoading();
    
    const reader = new FileReader();
    reader.onloadend = () => {
        const audioData = reader.result;
        socket.emit('audio_data', { audio: audioData });
    };
    reader.readAsDataURL(audioBlob);
}

function addMessage(sender, text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    
    contentDiv.appendChild(paragraph);
    messageDiv.appendChild(contentDiv);
    conversation.appendChild(messageDiv);
    
    scrollToBottom();
}

function scrollToBottom() {
    requestAnimationFrame(() => {
        const scrollContainer = document.querySelector('.conversation-container');
        scrollContainer.scrollTo({
            top: scrollContainer.scrollHeight,
            behavior: 'smooth'
        });
    });
}

function setStatus(message, isError = false) {
    statusMessage.textContent = message;
    statusMessage.className = isError ? 'error' : '';
}

function playAudio(base64Audio) {
    const wasManualStopped = manualStopped;
    
    if (isRecording) {
        manualStopped = false;
        stopRecording();
    }
    
    manualStopped = wasManualStopped;
    
    isPlayingAudio = true;
    
    const audioSrc = `data:audio/mp3;base64,${base64Audio}`;
    audioPlayer.src = audioSrc;
    audioPlayer.play();
    
    recordingText.textContent = 'Assistant parle...';
}

document.addEventListener('DOMContentLoaded', init);
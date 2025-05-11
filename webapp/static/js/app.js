// Voice Assistant Web Application JavaScript

// Socket.io connection
const socket = io();

// DOM Elements
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

// Recording variables
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let autoListen = true; // Activer l'écoute automatique par défaut
let silenceDetectionEnabled = false;
let audioContext;
let analyser;
let silenceThreshold = 15; // Valeur ajustée en fonction des observations réelles
let silenceFrames = 0;
let requiredSilenceFrames = 20; // Environ 0.3 sec à 60fps
let audioBuffer = []; // Pour stocker les données audio brutes
let audioSampleRate = 0;

// Initialize the application
function init() {
    // Set up event listeners
    sendTextBtn.addEventListener('click', sendTextMessage);
    textInput.addEventListener('keypress', handleTextInputKeypress);
    startRecordingBtn.addEventListener('click', toggleRecording);
    
    // Auto-listen toggle
    if (autoListenToggle) {
        autoListenToggle.addEventListener('change', function() {
            autoListen = this.checked;
            setStatus(autoListen ? 'Écoute automatique activée' : 'Écoute automatique désactivée');
        });
        autoListenToggle.checked = autoListen;
    }
    
    // Set up audio player events
    audioPlayer.addEventListener('ended', handleAudioPlaybackEnded);
    
    // Set up socket listeners
    setupSocketListeners();
}

// Set up Socket.io event listeners
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
        addMessage('user', data.text);
    });
    
    socket.on('response', (data) => {
        addMessage('assistant', data.text);
        if (data.audio) {
            playAudio(data.audio);
        } else if (autoListen && !isRecording) {
            // Si pas d'audio mais auto-listen activé, commencer l'enregistrement
            startRecording();
        }
    });
    
    socket.on('error', (data) => {
        setStatus(data.message, true);
    });
    
    socket.on('listening_started', () => {
        console.log('Listening started on server');
    });
    
    socket.on('listening_stopped', () => {
        console.log('Listening stopped on server');
        stopRecording();
    });
}

// Handle audio playback ended
function handleAudioPlaybackEnded() {
    console.log('Audio playback ended');
    // Si l'écoute automatique est activée, commencer l'enregistrement
    if (autoListen && !isRecording) {
        console.log('Starting automatic recording after audio response');
        startRecording();
    }
}

// Send text message
function sendTextMessage() {
    const text = textInput.value.trim();
    if (text) {
        addMessage('user', text);
        socket.emit('text_input', { text });
        textInput.value = '';
    }
}

// Handle Enter key in text input
function handleTextInputKeypress(e) {
    if (e.key === 'Enter') {
        sendTextMessage();
    }
}

// Toggle recording state
function toggleRecording() {
    if (!isRecording) {
        startRecording();
    } else {
        stopRecording();
    }
}

// Start recording audio
async function startRecording() {
    // Check if we're in a secure context
    if (window.isSecureContext === false) {
        setStatus('Le microphone nécessite HTTPS. Utilisez HTTPS ou localhost pour accéder au microphone.', true);
        console.error('Microphone access requires HTTPS or localhost');
        return;
    }
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        // Définir isRecording à true AVANT de configurer la détection de silence
        isRecording = true;
        console.log("Recording started, isRecording set to:", isRecording);
        
        // Configurer l'analyse audio pour la détection de silence
        setupSilenceDetection(stream);
        
        mediaRecorder.addEventListener('dataavailable', event => {
            audioChunks.push(event.data);
        });
        
        mediaRecorder.addEventListener('stop', () => {
            const audioBlob = new Blob(audioChunks);
            processAudio(audioBlob);
            
            // Release the microphone and audio analysis resources
            stream.getTracks().forEach(track => track.stop());
            if (audioContext) {
                if (audioContext.state !== 'closed') {
                    audioContext.close();
                }
            }
            
            // Réinitialiser la détection de silence
            silenceDetectionEnabled = false;
            silenceFrames = 0;
        });
        
        // Start recording
        mediaRecorder.start(100); // Collecte les données toutes les 100ms
        
        // Update UI
        startRecordingBtn.classList.add('recording');
        startRecordingBtn.innerHTML = '<span class="icon">⏹</span> Arrêter';
        recordingIndicator.classList.add('active');
        recordingText.textContent = 'Enregistrement...';
        
        // Start the server's listening process
        socket.emit('start_listening');
        
        // Activer la détection de silence après un court délai
        setTimeout(() => {
            silenceDetectionEnabled = true;
            console.log('Silence detection enabled');
        }, 1000);
        
    } catch (error) {
        // En cas d'erreur, s'assurer que isRecording est false
        isRecording = false;
        console.error('Error accessing microphone:', error);
        
        // Provide more specific error messages based on the error
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

// Configure silence detection
function setupSilenceDetection(stream) {
    try {
        // Créer l'AudioContext pour analyser le flux audio
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        source.connect(analyser);
        
        // Afficher l'état actuel de l'enregistrement
        console.log("setupSilenceDetection - isRecording:", isRecording);
        
        // Démarrer la vérification de silence
        requestAnimationFrame(checkSilence);
    } catch (e) {
        console.error('Error setting up silence detection:', e);
    }
}

// Check for silence in the audio stream
function checkSilence() {
    if (!isRecording || !analyser) return;
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    
    // Calculer l'amplitude moyenne du signal
    const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
    
    // Debug information
    console.log(`Audio level: ${average.toFixed(1)}, threshold: ${silenceThreshold}, frames: ${silenceFrames}/${requiredSilenceFrames}`);
    
    // Si nous sommes en mode de détection de silence et que le son est en dessous du seuil
    if (silenceDetectionEnabled) {
        // Si le niveau est très bas, considérer comme silence
        if (average < silenceThreshold) {
            silenceFrames++;
            if (silenceFrames >= requiredSilenceFrames) {
                console.log('Silence détecté, arrêt de l\'enregistrement');
                stopRecording();
                return;
            }
        } else {
            // Réinitialiser le compteur si on détecte du son
            silenceFrames = 0;
        }
    }
    
    // Continuer la vérification si l'enregistrement est actif
    if (isRecording) {
        requestAnimationFrame(checkSilence);
    }
}

// Stop recording audio
function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        
        // Update UI
        startRecordingBtn.classList.remove('recording');
        startRecordingBtn.innerHTML = '<span class="icon">🎤</span> Parler';
        recordingIndicator.classList.remove('active');
        recordingText.textContent = 'Inactive';
        
        // Stop the server's listening process
        socket.emit('stop_listening');
    }
}

// Process recorded audio
function processAudio(audioBlob) {
    const reader = new FileReader();
    reader.onloadend = () => {
        const audioData = reader.result;
        socket.emit('audio_data', { audio: audioData });
    };
    reader.readAsDataURL(audioBlob);
}

// Add a message to the conversation
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
    
    // Scroll to the bottom
    scrollToBottom();
}

// Scroll conversation to the bottom
function scrollToBottom() {
    conversation.scrollTop = conversation.scrollHeight;
}

// Set status message
function setStatus(message, isError = false) {
    statusMessage.textContent = message;
    statusMessage.className = isError ? 'error' : '';
}

// Play audio from base64 string
function playAudio(base64Audio) {
    const audioSrc = `data:audio/mp3;base64,${base64Audio}`;
    audioPlayer.src = audioSrc;
    audioPlayer.play();
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', init);
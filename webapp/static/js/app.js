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
const assistantLoadingIndicator = document.getElementById('assistant-loading-indicator');
const userLoadingIndicator = document.getElementById('user-loading-indicator');
const modelSelector = document.getElementById('model-selector');
const ttsLangSelector = document.getElementById('tts-lang-selector');

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
let requiredSilenceFrames = 35; // Augmenté à 35 frames (environ 0.6 sec à 60fps)
let audioBuffer = []; // Pour stocker les données audio brutes
let audioSampleRate = 0;
let hasSpokenDetected = false; // Nouvelle variable pour suivre si l'utilisateur a commencé à parler
let currentModel = "gemma"; // Modèle par défaut
let currentTtsLang = "fr"; // Langue TTS par défaut

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
    
    // Gestionnaire pour le sélecteur de langue TTS
    if (ttsLangSelector) {
        ttsLangSelector.addEventListener('change', function() {
            currentTtsLang = this.value;
            socket.emit('change_tts_lang', { lang: currentTtsLang });
            const langLabel = currentTtsLang === 'fr' ? 'Français' : 'English';
            setStatus(`Langue TTS changée pour ${langLabel}`);
        });
        // Initialiser avec la valeur par défaut
        ttsLangSelector.value = currentTtsLang;
    }
    
    // Charger la liste des modèles disponibles depuis l'API
    loadAvailableModels();
    
    // Set up audio player events
    audioPlayer.addEventListener('ended', handleAudioPlaybackEnded);
    
    // Set up socket listeners
    setupSocketListeners();
}

// Charger la liste des modèles disponibles depuis l'API
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

// Remplir le sélecteur de modèles avec les modèles disponibles
function populateModelSelector(models) {
    if (!modelSelector) return;
    
    // Vider le sélecteur
    modelSelector.innerHTML = '';
    
    // Ajouter les options pour chaque modèle disponible
    if (Object.keys(models).length > 0) {
        for (const [id, name] of Object.entries(models)) {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = name;
            modelSelector.appendChild(option);
        }
    } else {
        // Si aucun modèle n'est disponible, ajouter une option par défaut
        const option = document.createElement('option');
        option.value = 'default';
        option.textContent = 'Aucun modèle disponible';
        modelSelector.appendChild(option);
        modelSelector.disabled = true;
    }
    
    // Ajouter l'événement de changement de modèle
    modelSelector.addEventListener('change', function() {
        currentModel = this.value;
        const selectedModelName = models[currentModel] || 'Modèle inconnu';
        socket.emit('change_model', { model: currentModel });
        setStatus(`Modèle changé pour ${selectedModelName}`);
    });
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
        hideUserLoading(); // Masquer l'indicateur de chargement de l'utilisateur
        addMessage('user', data.text);
        showAssistantLoading(); // Afficher l'indicateur de chargement de l'assistant
    });
    
    socket.on('response', (data) => {
        // Masquer l'indicateur de chargement de l'assistant
        hideAssistantLoading();
        
        // Réactiver les contrôles
        sendTextBtn.disabled = false;
        textInput.disabled = false;
        
        // Afficher la réponse
        addMessage('assistant', data.text);
        
        // Vérifier si la réponse contient un mot d'arrêt, ce qui signifierait que l'utilisateur a dit au revoir
        const mots_arret = ["au revoir", "arrête", "stop", "termine", "bye", "goodbye", "exit", "quit", "ciao"];
        const userSaidGoodbye = mots_arret.some(mot => data.lastUserMessage && data.lastUserMessage.toLowerCase().includes(mot));
        
        if (userSaidGoodbye) {
            // L'utilisateur a dit au revoir, donc nous ne démarrons pas l'écoute automatique
            console.log('Mots d\'arrêt détectés, désactivation de l\'écoute automatique');
            
            // Optionnel : désactiver la case à cocher d'écoute automatique également
            if (autoListenToggle) {
                autoListenToggle.checked = false;
                autoListen = false;
            }
        }
        
        if (data.audio) {
            playAudio(data.audio);
        } else if (autoListen && !isRecording && !userSaidGoodbye) {
            // Si pas d'audio mais auto-listen activé ET l'utilisateur n'a pas dit au revoir,
            // commencer l'enregistrement
            startRecording();
        }
    });
    
    socket.on('error', (data) => {
        // Masquer les indicateurs de chargement et réactiver les contrôles en cas d'erreur
        hideAssistantLoading();
        hideUserLoading();
        sendTextBtn.disabled = false;
        textInput.disabled = false;
        
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

// Show the assistant loading indicator (left side)
function showAssistantLoading() {
    // Positionner l'indicateur de chargement après le dernier message
    const conversation = document.getElementById('conversation');
    conversation.insertAdjacentElement('afterend', assistantLoadingIndicator);
    
    // Activer l'indicateur
    assistantLoadingIndicator.classList.add('active');
    scrollToBottom();
}

// Hide the assistant loading indicator
function hideAssistantLoading() {
    assistantLoadingIndicator.classList.remove('active');
}

// Show the user loading indicator (right side)
function showUserLoading() {
    // Simplement activer l'indicateur
    userLoadingIndicator.classList.add('active');
    scrollToBottom();
}

// Hide the user loading indicator
function hideUserLoading() {
    userLoadingIndicator.classList.remove('active');
}

// Send text message
function sendTextMessage() {
    const text = textInput.value.trim();
    if (text) {
        addMessage('user', text);
        showAssistantLoading(); // Afficher l'indicateur de chargement de l'assistant
        socket.emit('text_input', { text });
        textInput.value = '';
        
        // Désactiver le bouton d'envoi et le champ de texte pendant le chargement
        sendTextBtn.disabled = true;
        textInput.disabled = true;
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
        // S'assurer que toute ressource audio précédente est correctement fermée
        if (audioContext && audioContext.state !== 'closed') {
            try {
                await audioContext.close();
            } catch (e) {
                console.log("Erreur lors de la fermeture du contexte audio précédent:", e);
            }
        }
        
        // Réinitialiser toutes les variables
        isRecording = false;
        silenceDetectionEnabled = false;
        silenceFrames = 0;
        hasSpokenDetected = false;
        audioContext = null;
        analyser = null;
        
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
                    audioContext.close().catch(e => console.log("Erreur fermeture AudioContext:", e));
                }
            }
            
            // Réinitialiser la détection de silence
            silenceDetectionEnabled = false;
            silenceFrames = 0;
            hasSpokenDetected = false;
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
    console.log(`Audio level: ${average.toFixed(1)}, threshold: ${silenceThreshold}, hasSpoken: ${hasSpokenDetected}, frames: ${silenceFrames}/${requiredSilenceFrames}`);
    
    // Détecter si l'utilisateur a commencé à parler
    if (!hasSpokenDetected && average > silenceThreshold) {
        console.log('Voix détectée, début de parole');
        hasSpokenDetected = true;
    }
    
    // Si nous sommes en mode de détection de silence et que l'utilisateur a déjà parlé
    if (silenceDetectionEnabled && hasSpokenDetected) {
        // Si le niveau est très bas, considérer comme silence
        if (average < silenceThreshold) {
            silenceFrames++;
            console.log(`Silence après parole: ${silenceFrames}/${requiredSilenceFrames}`);
            if (silenceFrames >= requiredSilenceFrames) {
                console.log('Silence après parole détecté, arrêt de l\'enregistrement');
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
        
        // Réinitialiser la détection de parole
        hasSpokenDetected = false;
    }
}

// Process recorded audio
function processAudio(audioBlob) {
    // Afficher l'indicateur de chargement de l'utilisateur avant d'envoyer l'audio
    showUserLoading();
    
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

// Scroll conversation to the bottom with smooth animation
function scrollToBottom() {
    // Utiliser requestAnimationFrame pour s'assurer que le DOM est mis à jour
    requestAnimationFrame(() => {
        const scrollContainer = document.querySelector('.conversation-container');
        scrollContainer.scrollTo({
            top: scrollContainer.scrollHeight,
            behavior: 'smooth'
        });
    });
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
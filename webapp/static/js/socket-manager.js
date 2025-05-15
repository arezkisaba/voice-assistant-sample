import config from './config.js';
import uiController from './ui-controller.js';
import audioPlayer from './audio-player.js';
import audioRecorder from './audio-recorder.js';
import uiSoundManager from './ui-sound-manager.js';

class SocketManager {
    constructor() {
        this.socket = io();
        this.isGeneratingResponse = false;
    }

    init() {
        this.setupSocketListeners();
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to server');
            uiController.setStatus('Connecté au serveur');
        });
        
        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            uiController.setStatus('Déconnecté du serveur');
        });
        
        this.socket.on('status', (data) => {
            uiController.setStatus(data.message);
        });
        
        this.socket.on('transcript', (data) => {
            uiController.hideUserLoading();
            
            if (this.isGeneratingResponse) {
                this.Interrupt();
                return;
            }
            
            uiController.addMessage('user', data.text);
            uiController.showAssistantLoading();
        });
        
        this.socket.on('response_chunk', (data) => {
            this.isGeneratingResponse = true;
            console.log("--- RÉCEPTION CHUNK DE RÉPONSE ---");
            uiController.updateRecordingUI(true);
            audioRecorder.blockRecordingUntilFullResponse = true;
            let processedText = data.text;
            if (typeof processedText === 'string' && 
                (processedText.startsWith('"') && processedText.endsWith('"'))) {
                try {
                    processedText = JSON.parse(processedText);
                } catch (e) {
                    console.log("Impossible de parser le texte comme JSON:", e);
                }
            }
            
            if (!uiController.isStreamingResponse) {
                uiController.hideAssistantLoading();
                uiController.disableTextInput(false);
                uiController.startStreamingResponse(processedText);
            } else {
                uiController.appendToStreamingResponse(processedText);
            }
            
            if (data.audio) {
                audioPlayer.queueAudioForPlayback(data.audio);
            }
            
            setTimeout(() => {
                if (this.isGeneratingResponse) {
                    console.log("Réapplication de l'état d'interruption après délai");
                    uiController.updateRecordingUI(true);
                }
            }, 300);
        });
        
        this.socket.on('response_complete', (data) => {
            this.isGeneratingResponse = false;
            uiController.updateRecordingUI();
            uiController.completeStreamingResponse();
            
            if (data.cancelled) {
                console.log("🛑 Réponse annulée, nettoyage de l'interface");
                audioPlayer.clearAudioQueue();
                uiController.setStatus('Génération de réponse arrêtée');
                return;
            }
        });
        
        this.socket.on('interrupt', (data) => {
            this.isGeneratingResponse = false;
            this.interrupt();
        });
        
        this.socket.on('error', (data) => {
            this.isGeneratingResponse = false;
            uiController.updateRecordingUI();
            
            uiController.hideAssistantLoading();
            uiController.hideUserLoading();
            uiController.disableTextInput(false);
            
            uiController.setStatus(data.message, true);
        });
        
        this.socket.on('listening_started', () => {
            console.log('Listening started on server');
        });
    }

    startListening() {
        this.socket.emit('start_listening');
    }

    sendAudioData(audioData) {
        this.socket.emit('audio_data', { audio: audioData });
    }

    sendTextMessage(text) {
        this.socket.emit('text_input', { text });
    }

    interrupt() {
        this.cancelSpeech();
        audioPlayer.clearAudioQueue();
        uiController.hideAssistantLoading();
        uiController.hideUserLoading();
        uiController.disableTextInput(false);
        uiController.completeStreamingResponse();
        uiController.setRecordingStatusText('Inactive');
        uiController.updateRecordingUI();
        uiController.setStatus('Génération de réponse arrêtée');
    }

    changeModel(model) {
        this.socket.emit('change_model', { model });
    }

    changeTtsLang(lang) {
        this.socket.emit('change_tts_lang', { lang });
    }
    
    cancelSpeech() {
        const audioPlayer = document.getElementById('audio-player');
        if (audioPlayer) {
            audioPlayer.pause();
            audioPlayer.currentTime = 0;
        }
    }
}

const socketManager = new SocketManager();
export default socketManager;
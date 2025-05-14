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
            uiController.addMessage('user', data.text);
            
            if (this.isGeneratingResponse && this.isShutdownWord(data.text)) {
                this.handleShutdownWordDetection();
                return;
            }
            
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
            
            const userSaidStopWord = this.isStopWord(data.lastUserMessage);
            
            if (userSaidStopWord) {
                config.manualStopped = true;
                uiSoundManager.playShutdownSound();
            }
        });
        
        this.socket.on('response', (data) => {
            uiController.hideAssistantLoading();
            uiController.disableTextInput(false);
            uiController.addMessage('assistant', data.text);
            
            const userSaidStopWord = this.isStopWord(data.lastUserMessage);
            
            if (userSaidStopWord) {
                config.manualStopped = true;
            }
            
            if (data.audio) {
                audioPlayer.playAudio(data.audio);
            }
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
        console.log(`🎙️ Sending audio data - length: ${audioData.length} chars`);
        
        // Log first 10 seconds of silent detection to debug timing
        if (!this._lastAudioSent) {
            this._lastAudioSent = Date.now();
            console.log(`🕒 First audio chunk sent at: ${new Date().toISOString()}`);
        } else {
            const timeSinceLastAudio = Date.now() - this._lastAudioSent;
            console.log(`⏱️ Time since last audio chunk: ${timeSinceLastAudio}ms`);
            this._lastAudioSent = Date.now();
        }
        
        this.socket.emit('audio_data', { audio: audioData });
    }

    sendTextMessage(text) {
        this.socket.emit('text_input', { text });
    }

    changeModel(model) {
        this.socket.emit('change_model', { model });
    }

    changeTtsLang(lang) {
        this.socket.emit('change_tts_lang', { lang });
    }
    
    async handleShutdownWordDetection() {
        console.log('Shutdown word detected - canceling response generation and speech synthesis');
        
        this.socket.emit('cancel_response');
        this.cancelSpeech();
        audioPlayer.clearAudioQueue();
        config.manualStopped = true;
        
        uiController.hideAssistantLoading();
        uiController.hideUserLoading();
        uiController.disableTextInput(false);
        uiController.completeStreamingResponse();
        uiController.setRecordingStatusText('Inactive');
        uiController.updateRecordingUI();
        uiController.setStatus('Génération de réponse arrêtée');
        
        this.isGeneratingResponse = false;
    }
    
    isStopWord(text) {
        if (!text) return false;
        return config.stopWords.some(word => text.toLowerCase().includes(word));
    }
    
    isShutdownWord(text) {
        if (!text) return false;
        return config.shutdownWords.some(word => text.toLowerCase().includes(word));
    }
    
    cancelSpeech() {
        this.socket.emit('cancel_speech');
        const audioPlayer = document.getElementById('audio-player');
        if (audioPlayer) {
            audioPlayer.pause();
            audioPlayer.currentTime = 0;
        }
    }
}

const socketManager = new SocketManager();
export default socketManager;
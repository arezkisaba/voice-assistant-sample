import config from './config.js';
import uiController from './ui-controller.js';
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
            console.log("isGeneratingResponse mis à true");
            
            // Mettre à jour l'UI pour montrer l'état d'interruption
            uiController.updateRecordingUI(false, true);
            
            // Vérifions l'état du bouton après la mise à jour
            const startRecordingBtn = document.getElementById('start-recording');
            console.log("État du bouton:", {
                isInterrupting: startRecordingBtn.classList.contains('interrupting'),
                classNames: startRecordingBtn.className,
                innerHTML: startRecordingBtn.innerHTML,
                visible: !startRecordingBtn.classList.contains('hidden')
            });
            
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
                audioRecorder.queueAudioForPlayback(data.audio);
            }
            
            // Forcer l'application de l'état d'interruption à nouveau
            setTimeout(() => {
                if (this.isGeneratingResponse) {
                    console.log("Réapplication de l'état d'interruption après délai");
                    uiController.updateRecordingUI(false, true);
                }
            }, 300);
        });
        
        this.socket.on('response_complete', (data) => {
            this.isGeneratingResponse = false;
            // Restaurer l'UI après la fin de la génération
            uiController.updateRecordingUI(false, false);
            
            uiController.completeStreamingResponse();
            
            // Vérifier si la réponse a été annulée
            if (data.cancelled) {
                console.log("🛑 Réponse annulée, nettoyage de l'interface");
                // Ne pas ajouter cette réponse à l'historique de conversation
                audioRecorder.clearAudioQueue();
                uiController.setStatus('Génération de réponse arrêtée');
                return;
            }
            
            const userSaidStopWord = this.isStopWord(data.lastUserMessage);
            
            if (userSaidStopWord) {
                config.manualStopped = true;
                uiSoundManager.playShutdownSound();
            }
            
            const checkAudioQueueAndRestart = () => {
                console.log("Vérification de l'état de la file d'attente audio:", 
                    audioRecorder.audioQueue.length, 
                    "isPlayingAudio:", config.isPlayingAudio);
                
                if (audioRecorder.audioQueue.length === 0 && !config.isPlayingAudio) {
                    console.log("Tous les audios ont été joués, redémarrage de l'enregistrement");
                    
                    if (!config.isRecording && !config.manualStopped && !config.isPlayingAudio) {
                        console.log("Redémarrage de l'enregistrement maintenant");
                        setTimeout(() => {
                            audioRecorder.startRecording();
                        }, 500);
                    }
                } else {
                    setTimeout(checkAudioQueueAndRestart, 500);
                }
            };
            
            setTimeout(checkAudioQueueAndRestart, 500);
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
                audioRecorder.playAudio(data.audio);
            } else if (!config.isRecording && !userSaidStopWord && !config.manualStopped) {
                audioRecorder.startRecording();
            }
        });
        
        this.socket.on('error', (data) => {
            this.isGeneratingResponse = false;
            uiController.updateRecordingUI(false, false);
            
            uiController.hideAssistantLoading();
            uiController.hideUserLoading();
            uiController.disableTextInput(false);
            
            uiController.setStatus(data.message, true);
            
            if (!config.isRecording && !config.isPlayingAudio && !config.manualStopped) {
                console.log('Relance automatique après erreur de compréhension');
                setTimeout(() => {
                    audioRecorder.startRecording();
                }, 1000);
            }
        });
        
        this.socket.on('listening_started', () => {
            console.log('Listening started on server');
        });
        
        this.socket.on('listening_stopped', () => {
            console.log('Listening stopped on server');
            audioRecorder.stopRecording();
        });
    }

    startListening() {
        this.socket.emit('start_listening');
    }

    stopListening() {
        this.socket.emit('stop_listening');
    }

    sendAudioData(audioData) {
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
        audioRecorder.clearAudioQueue();
        config.manualStopped = true;
        
        uiController.hideAssistantLoading();
        uiController.hideUserLoading();
        uiController.disableTextInput(false);
        uiController.completeStreamingResponse();
        uiController.setRecordingStatusText('Inactive');
        uiController.updateRecordingUI(false, false);
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
        
        // Reset UI elements related to speech
        document.getElementById('recording-status').classList.remove('speaking');
        
        // Ne pas cacher automatiquement le bouton ici, car il peut être nécessaire
        // pendant la synthèse vocale même après l'arrêt d'un audio spécifique
    }
}

const socketManager = new SocketManager();
export default socketManager;
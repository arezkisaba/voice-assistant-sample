import config from './config.js';
import uiController from './ui-controller.js';
import audioRecorder from './audio-recorder.js';

class SocketManager {
    constructor() {
        this.socket = io();
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
            uiController.showAssistantLoading();
        });
        
        this.socket.on('response_chunk', (data) => {
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
        });
        
        this.socket.on('response_complete', (data) => {
            uiController.completeStreamingResponse();
            const userSaidGoodbye = config.stopWords.some(mot => 
                data.lastUserMessage && data.lastUserMessage.toLowerCase().includes(mot)
            );
            
            if (userSaidGoodbye) {
                config.manualStopped = true;
            }
            
            const checkAudioQueueAndRestart = () => {
                console.log("Vérification de l'état de la file d'attente audio:", 
                    audioRecorder.audioQueue.length, 
                    "isPlayingQueuedAudio:", audioRecorder.isPlayingQueuedAudio);
                
                if (audioRecorder.audioQueue.length === 0 && !audioRecorder.isPlayingQueuedAudio) {
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
            
            const userSaidGoodbye = config.stopWords.some(mot => 
                data.lastUserMessage && data.lastUserMessage.toLowerCase().includes(mot)
            );
            
            if (userSaidGoodbye) {
                config.manualStopped = true;
            }
            
            if (data.audio) {
                audioRecorder.playAudio(data.audio);
            } else if (!config.isRecording && !userSaidGoodbye && !config.manualStopped) {
                audioRecorder.startRecording();
            }
        });
        
        this.socket.on('error', (data) => {
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
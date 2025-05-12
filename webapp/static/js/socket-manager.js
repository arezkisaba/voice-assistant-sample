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
import config from './config.js';
import uiController from './ui-controller.js';
import socketManager from './socket-manager.js';

class AudioPlayer {
    constructor() {
        this.audioQueue = [];
    }

    interruptResponse() {
        if (socketManager.isGeneratingResponse || config.isPlayingAudio) {
            this.clearAudioQueue();
            socketManager.cancelSpeech();
            socketManager.handleShutdownWordDetection();
            uiController.stopSpeaking();
            uiController.setStatus('Réponse interrompue');
        }
    }

    queueAudioForPlayback(base64Audio) {
        this.audioQueue.push(base64Audio);
        if (!config.isPlayingAudio) {
            this.playNextQueuedAudio();
        }
    }
    
    playNextQueuedAudio() {
        if (this.audioQueue.length === 0) {
            config.isPlayingAudio = false;
            console.log('File d\'attente audio vide - réponse complète terminée');
            uiController.updateRecordingUI();
            return;
        }
        
        config.isPlayingAudio = true;
        uiController.updateRecordingUI(true);
        uiController.showInterruptButton(true);
        
        const base64Audio = this.audioQueue.shift();
        const audioSrc = `data:audio/mp3;base64,${base64Audio}`;
        const audioPlayer = document.getElementById('audio-player');
        audioPlayer.src = audioSrc;
        
        audioPlayer.onended = () => {
            console.log('Fin de lecture audio, passage au suivant');
            if (this.audioQueue.length === 0) {
                uiController.showInterruptButton(false);
            }

            setTimeout(() => {
                this.playNextQueuedAudio();
            }, 300);
        };
        
        audioPlayer.play().catch(error => {
            console.error('Erreur lors de la lecture audio:', error);
            this.playNextQueuedAudio();
        });
    }
    
    playAudio(base64Audio) {
        this.clearAudioQueue();
        const wasManualStopped = config.manualStopped;
        config.manualStopped = wasManualStopped;
        config.isPlayingAudio = true;
        uiController.showInterruptButton(true);
        uiController.playAudioInUI(base64Audio);
    }

    clearAudioQueue() {
        this.audioQueue = [];
        config.isPlayingAudio = false;
        uiController.showInterruptButton(false);
    }
}

const audioPlayer = new AudioPlayer();
export default audioPlayer;
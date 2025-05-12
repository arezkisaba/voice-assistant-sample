import config from './config.js';
import uiController from './ui-controller.js';
import socketManager from './socket-manager.js';

class AudioRecorder {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.audioContext = null;
        this.analyser = null;
        this.audioBuffer = [];
        this.audioSampleRate = 0;
    }

    async startRecording() {
        if (window.isSecureContext === false) {
            uiController.setStatus('Le microphone nécessite HTTPS. Utilisez HTTPS ou localhost pour accéder au microphone.', true);
            console.error('Microphone access requires HTTPS or localhost');
            return;
        }
        
        try {
            // Nettoyage complet des ressources précédentes
            if (this.mediaRecorder) {
                try {
                    if (this.mediaRecorder.state === 'recording') {
                        this.mediaRecorder.stop();
                    }
                } catch (e) {
                    console.log("Erreur lors de l'arrêt du mediaRecorder précédent:", e);
                }
                this.mediaRecorder = null;
            }
            
            if (this.audioContext && this.audioContext.state !== 'closed') {
                try {
                    await this.audioContext.close();
                } catch (e) {
                    console.log("Erreur lors de la fermeture du contexte audio précédent:", e);
                }
            }
            
            config.isRecording = false;
            this.audioContext = null;
            this.analyser = null;
            
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];
            
            config.isRecording = true;
            console.log("Recording started, isRecording set to:", config.isRecording);
            
            this.mediaRecorder.addEventListener('dataavailable', event => {
                this.audioChunks.push(event.data);
            });
            
            this.mediaRecorder.addEventListener('stop', () => {
                if (this.audioChunks.length === 0) {
                    console.log("No audio chunks recorded");
                    return;
                }
                
                const audioBlob = new Blob(this.audioChunks);
                this.processAudio(audioBlob);
                
                // Libérer immédiatement les ressources
                stream.getTracks().forEach(track => track.stop());
                this.audioChunks = [];
                
                if (this.audioContext) {
                    if (this.audioContext.state !== 'closed') {
                        this.audioContext.close().catch(e => console.log("Erreur fermeture AudioContext:", e));
                    }
                    this.audioContext = null;
                }
                
                this.mediaRecorder = null;
            });
            
            this.mediaRecorder.start(100);
            
            uiController.updateRecordingUI(true);
            socketManager.startListening();
            
        } catch (error) {
            config.isRecording = false;
            console.error('Error accessing microphone:', error);
            
            if (error.name === 'NotAllowedError') {
                uiController.setStatus('Accès au microphone refusé. Veuillez autoriser l\'accès dans les paramètres de votre navigateur.', true);
            } else if (error.name === 'NotFoundError') {
                uiController.setStatus('Aucun microphone détecté sur votre appareil.', true);
            } else if (error.name === 'NotReadableError') {
                uiController.setStatus('Impossible d\'accéder au microphone. Il est peut-être utilisé par une autre application.', true);
            } else if (error.name === 'SecurityError') {
                uiController.setStatus('Accès au microphone bloqué. Utilisez HTTPS pour permettre l\'accès au microphone.', true);
            } else {
                uiController.setStatus('Erreur d\'accès au microphone: ' + error.message, true);
            }
        }
    }

    stopRecording() {
        if (this.mediaRecorder && config.isRecording) {
            this.mediaRecorder.stop();
            config.isRecording = false;
            
            uiController.updateRecordingUI(false);
            socketManager.stopListening();
        }
    }

    processAudio(audioBlob) {
        uiController.showUserLoading();
        
        const reader = new FileReader();
        reader.onloadend = () => {
            const audioData = reader.result;
            socketManager.sendAudioData(audioData);
        };
        reader.readAsDataURL(audioBlob);
    }

    toggleRecording() {
        if (!config.isRecording) {
            config.manualStopped = false;
            this.startRecording();
        } else {
            config.manualStopped = true;
            this.stopRecording();
        }
    }

    playAudio(base64Audio) {
        const wasManualStopped = config.manualStopped;
        
        if (config.isRecording) {
            config.manualStopped = false;
            this.stopRecording();
        }
        
        config.manualStopped = wasManualStopped;
        config.isPlayingAudio = true;
        
        uiController.playAudioInUI(base64Audio);
    }

    handleAudioPlaybackEnded() {
        console.log('Audio playback ended');
        config.isPlayingAudio = false;
        
        uiController.setRecordingStatusText('Inactive');
        
        config.manualStopped = false;
        setTimeout(() => {
            this.startRecording();
        }, 500);
    }
}

const audioRecorder = new AudioRecorder();
export default audioRecorder;
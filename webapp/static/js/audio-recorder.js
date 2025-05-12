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
        this.silenceAudioFrameCount = 0;
        this.hasTalked = false;
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
            
            // Set up audio analyzer for real-time monitoring
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            const bufferLength = this.analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            // Connect stream to analyzer
            const source = this.audioContext.createMediaStreamSource(stream);
            source.connect(this.analyser);
            
            // Start analyzing audio input
            this.startAudioAnalysis(dataArray);
            
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
            this.hasTalked = false;
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

    startAudioAnalysis(dataArray) {
        // Create animation frame to continuously monitor audio levels
        let audioMonitoringId = null;
        
        const analyzeAudio = () => {
            if (!this.analyser || !config.isRecording) {
                if (audioMonitoringId) {
                    cancelAnimationFrame(audioMonitoringId);
                }
                return;
            }
            
            this.analyser.getByteFrequencyData(dataArray);
            
            // Calculate audio level (average of frequency data)
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            
            // Emit audio level event for UI updates
            this.handleAudioLevel(average);
            
            // Continue monitoring
            audioMonitoringId = requestAnimationFrame(analyzeAudio);
        };
        
        // Start the audio analysis loop
        audioMonitoringId = requestAnimationFrame(analyzeAudio);
    }
    
    handleAudioLevel(level) {
        if (!config.isRecording) {
            return;
        }
        
        const normalizedLevel = Math.min(100, Math.max(0, level * 2));
        uiController.updateAudioLevel(normalizedLevel);

        if (level < 15) {
            this.handleSilence();
            if (this.silenceAudioFrameCount > 100 && this.hasTalked) {
                console.log('Silence detected, stopping recording');
                this.silenceAudioFrameCount = 0;
                this.stopRecording();
            }
        } else {
            console.log('Talk detected');
            this.silenceAudioFrameCount = 0;
            this.hasTalked = true;
        }
    }
    
    handleSilence() {
        this.silenceAudioFrameCount++;
    }
}

const audioRecorder = new AudioRecorder();
export default audioRecorder;
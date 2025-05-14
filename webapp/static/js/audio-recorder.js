import config from './config.js';
import uiController from './ui-controller.js';
import socketManager from './socket-manager.js';

class AudioRecorder {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.stream = null;
        this.audioContext = null;
        this.analyser = null;
        this.audioBuffer = [];
        this.audioSampleRate = 0;
        this.talkAudioFrameCount = 0;
        this.silenceAudioFrameCount = 0;
        this.blockRecordingUntilFullResponse = false;
        this.backgroundStream = null;
    }

    async startRecording() {
        if (window.isSecureContext === false) {
            uiController.setStatus('Le microphone nécessite HTTPS. Utilisez HTTPS ou localhost pour accéder au microphone.', true);
            console.error('Microphone access requires HTTPS or localhost');
            return;
        }
        
        try {
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
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            const bufferLength = this.analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            const source = this.audioContext.createMediaStreamSource(this.stream);
            source.connect(this.analyser);
            this.startAudioAnalysis(dataArray);
            this.mediaRecorder = new MediaRecorder(this.stream);
            this.audioChunks = [];
            config.isRecording = true;
            this.mediaRecorder.addEventListener('dataavailable', event => this.audioChunks.push(event.data));
            this.mediaRecorder.start(100);
            uiController.updateRecordingUI(true);
            
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

            if (this.audioChunks.length === 0) {
                console.log("No audio chunks recorded");
                return;
            }
            
            const audioBlob = new Blob(this.audioChunks);
            this.processAudio(audioBlob);
            this.stream.getTracks().forEach(track => track.stop());
            this.audioChunks = [];
            
            if (this.audioContext) {
                if (this.audioContext.state !== 'closed') {
                    this.audioContext.close().catch(e => console.log("Erreur fermeture AudioContext:", e));
                }
                this.audioContext = null;
            }
            
            this.mediaRecorder = null;

            setTimeout(() => {
                audioRecorder.startRecording();
            }, 1000);
        }
    }

    startAudioAnalysis(dataArray) {
        let audioMonitoringId = null;
        const analyzeAudio = () => {
            if (!this.analyser || !config.isRecording) {
                if (audioMonitoringId) {
                    cancelAnimationFrame(audioMonitoringId);
                }
                return;
            }
            
            this.analyser.getByteFrequencyData(dataArray);
            
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            this.handleAudioLevel(average);
            audioMonitoringId = requestAnimationFrame(analyzeAudio);
        };
        
        audioMonitoringId = requestAnimationFrame(analyzeAudio);
    }

    processAudio(audioBlob) {
        console.log(`📊 Processing audio blob: size=${audioBlob.size} bytes, type=${audioBlob.type}`);
        
        if (audioBlob.size < 1000) {
            console.warn("⚠️ Audio blob too small, likely no speech detected");
            return;
        }
        
        const reader = new FileReader();
        reader.onloadend = () => {
            const audioData = reader.result;
            console.log(`📤 Sending audio data to server: ${audioData.substring(0, 50)}... (${audioData.length} chars total)`);
            socketManager.sendAudioData(audioData);
        };
        
        reader.onerror = (error) => {
            console.error("❌ Error reading audio blob:", error);
        };
        
        reader.readAsDataURL(audioBlob);
    }
    
    handleAudioLevel(level) {
        const normalizedLevel = Math.min(100, Math.max(0, level * 2));
        uiController.updateAudioLevel(normalizedLevel);

        if (level < 15) {
            this.silenceAudioFrameCount++;
            if (this.silenceAudioFrameCount > 100 && this.talkAudioFrameCount > 100) {
                console.log('Sentence end detected', this.silenceAudioFrameCount, this.talkAudioFrameCount);
                this.silenceAudioFrameCount = 0;
                this.talkAudioFrameCount = 0;
                this.stopRecording();
            }
        } else {
            console.log('Talk detected');
            this.silenceAudioFrameCount = 0;
            this.talkAudioFrameCount++;
        }
    }
}

const audioRecorder = new AudioRecorder();
export default audioRecorder;
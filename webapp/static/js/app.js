import config from './config.js';
import uiController from './ui-controller.js';
import audioRecorder from './audio-recorder.js';
import socketManager from './socket-manager.js';
import modelsManager from './models-manager.js';

// Configurer marked.js pour utiliser highlight.js
marked.setOptions({
    highlight: function(code, language) {
        const validLanguage = hljs.getLanguage(language) ? language : 'plaintext';
        return hljs.highlight(code, { language: validLanguage }).value;
    },
    breaks: true,  // Activer les sauts de ligne
    gfm: true      // Activer GitHub Flavored Markdown
});

class App {
    constructor() {
    }

    init() {
        uiController.initElements();
        this.setupEventListeners();
        socketManager.init();
        modelsManager.init();

        if (uiController.elements.ttsLangSelector) {
            uiController.elements.ttsLangSelector.addEventListener('change', this.handleTtsLangChange.bind(this));
            uiController.elements.ttsLangSelector.value = config.currentTtsLang;
        }

        setTimeout(() => {
            audioRecorder.startRecording();
        }, 1000);
    }

    setupEventListeners() {
        uiController.elements.sendTextBtn.addEventListener('click', this.handleSendTextMessage.bind(this));
        uiController.elements.textInput.addEventListener('keypress', this.handleTextInputKeypress.bind(this));
        uiController.elements.startRecordingBtn.addEventListener('click', this.handleToggleRecording.bind(this));
        uiController.elements.audioPlayer.addEventListener('ended', this.handleAudioPlaybackEnded.bind(this));
        
        // Ajout du gestionnaire d'événement pour le bouton d'annulation de la synthèse vocale
        const cancelSpeechBtn = document.getElementById('cancel-speech');
        if (cancelSpeechBtn) {
            cancelSpeechBtn.addEventListener('click', this.handleCancelSpeech.bind(this));
        }
    }

    handleSendTextMessage() {
        const text = uiController.elements.textInput.value.trim();
        if (text) {
            // Bloquer immédiatement l'enregistrement lorsqu'une demande est envoyée
            audioRecorder.blockRecordingUntilFullResponse = true;
            
            uiController.addMessage('user', text);
            uiController.showAssistantLoading();
            socketManager.sendTextMessage(text);
            uiController.clearInput();
            
            uiController.disableTextInput(true);
        }
    }

    handleTextInputKeypress(e) {
        if (e.key === 'Enter') {
            this.handleSendTextMessage();
        }
    }

    handleToggleRecording() {
        audioRecorder.toggleRecording();
    }

    handleAudioPlaybackEnded() {
        audioRecorder.handleAudioPlaybackEnded();
    }

    handleTtsLangChange(e) {
        config.currentTtsLang = e.target.value;
        socketManager.changeTtsLang(config.currentTtsLang);
        const langLabel = config.currentTtsLang === 'fr' ? 'Français' : 'English';
        uiController.setStatus(`Langue TTS changée pour ${langLabel}`);
    }

    // Méthode pour gérer l'annulation de la synthèse vocale
    handleCancelSpeech() {
        const cancelSpeechBtn = document.getElementById('cancel-speech');
        cancelSpeechBtn.classList.add('active');
        
        // Arrêter la file d'attente des audios
        audioRecorder.clearAudioQueue();
        
        // Annuler la synthèse vocale côté serveur
        socketManager.cancelSpeech();
        
        // Utiliser la méthode stopSpeaking de uiController pour réinitialiser l'interface
        uiController.stopSpeaking();
        
        // Débloquer l'enregistrement si le streaming est terminé
        if (!uiController.isStreamingResponse) {
            console.log("Débloquage de l'enregistrement après annulation de la synthèse vocale");
            audioRecorder.blockRecordingUntilFullResponse = false;
            
            // Redémarrer l'enregistrement si nécessaire
            if (!config.isRecording && !config.manualStopped) {
                setTimeout(() => {
                    audioRecorder.startRecording();
                }, 500);
            }
        }
        
        // Désactiver visuellement le bouton après un court délai
        setTimeout(() => {
            cancelSpeechBtn.classList.remove('active');
        }, 300);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
});
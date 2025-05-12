class UIController {
    constructor() {
        this.elements = {
            conversation: null,
            textInput: null,
            sendTextBtn: null,
            startRecordingBtn: null,
            recordingStatus: null,
            recordingIndicator: null,
            recordingText: null,
            cancelSpeechBtn: null,
            statusMessage: null,
            audioPlayer: null,
            assistantLoadingIndicator: null,
            userLoadingIndicator: null,
            ttsLangSelector: null,
            audioLevelMeter: null
        };
    }

    initElements() {
        this.elements.conversation = document.getElementById('conversation');
        this.elements.textInput = document.getElementById('text-input');
        this.elements.sendTextBtn = document.getElementById('send-text');
        this.elements.startRecordingBtn = document.getElementById('start-recording');
        this.elements.recordingStatus = document.getElementById('recording-status');
        this.elements.recordingIndicator = this.elements.recordingStatus.querySelector('.recording-indicator');
        this.elements.recordingText = this.elements.recordingStatus.querySelector('span');
        this.elements.cancelSpeechBtn = document.getElementById('cancel-speech');
        this.elements.statusMessage = document.getElementById('status-message');
        this.elements.audioPlayer = document.getElementById('audio-player');
        this.elements.assistantLoadingIndicator = document.getElementById('assistant-loading-indicator');
        this.elements.userLoadingIndicator = document.getElementById('user-loading-indicator');
        this.elements.ttsLangSelector = document.getElementById('tts-lang-selector');
        
        // Create audio level meter element if it doesn't exist
        if (!document.getElementById('audio-level-meter')) {
            const meterContainer = document.createElement('div');
            meterContainer.id = 'audio-level-container';
            meterContainer.className = 'audio-level-container';
            
            const meter = document.createElement('div');
            meter.id = 'audio-level-meter';
            meter.className = 'audio-level-meter';
            
            meterContainer.appendChild(meter);
            
            // Add the meter next to the recording status
            this.elements.recordingStatus.appendChild(meterContainer);
        }
        
        this.elements.audioLevelMeter = document.getElementById('audio-level-meter');
    }

    updateRecordingUI(isRecording) {
        if (isRecording) {
            this.elements.startRecordingBtn.classList.add('recording');
            this.elements.startRecordingBtn.innerHTML = '<span class="icon">⏹</span> Arrêter';
            this.elements.recordingIndicator.classList.add('active');
            this.elements.recordingText.textContent = 'Enregistrement...';
        } else {
            this.elements.startRecordingBtn.classList.remove('recording');
            this.elements.startRecordingBtn.innerHTML = '<span class="icon">🎤</span> Parler';
            this.elements.recordingIndicator.classList.remove('active');
            this.elements.recordingText.textContent = 'Inactive';
        }
    }

    setRecordingStatusText(text) {
        if (this.elements.recordingText) {
            this.elements.recordingText.textContent = text;
        }
    }

    showAssistantLoading() {
        const conversation = document.getElementById('conversation');
        conversation.insertAdjacentElement('afterend', this.elements.assistantLoadingIndicator);
        this.elements.assistantLoadingIndicator.classList.add('active');
        this.scrollToBottom();
    }

    hideAssistantLoading() {
        this.elements.assistantLoadingIndicator.classList.remove('active');
    }

    showUserLoading() {
        this.elements.userLoadingIndicator.classList.add('active');
        this.scrollToBottom();
    }

    hideUserLoading() {
        this.elements.userLoadingIndicator.classList.remove('active');
    }

    addMessage(sender, text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        // Vérifier si le texte contient du Markdown
        const hasMarkdown = /(\*\*|__|##|```|\[.*\]\(.*\)|^\s*[-*+]\s|\|[-|]+\||^\s*>\s)/.test(text);
        
        if (hasMarkdown && sender === 'assistant') {
            // Utilisation de la bibliothèque marked pour rendre le Markdown
            contentDiv.innerHTML = marked.parse(text);
            
            // Ajouter une classe pour le formatage Markdown
            contentDiv.classList.add('markdown-content');
            
            // Ajouter des styles pour les blocs de code si présents
            if (text.includes('```')) {
                this.applyCodeHighlighting(contentDiv);
            }
        } else {
            // Texte normal sans formatage Markdown
            const paragraph = document.createElement('p');
            paragraph.textContent = text;
            contentDiv.appendChild(paragraph);
        }
        
        messageDiv.appendChild(contentDiv);
        this.elements.conversation.appendChild(messageDiv);
        
        this.scrollToBottom();
    }
    
    applyCodeHighlighting(contentElement) {
        // Parcourir tous les blocs de code et ajouter des classes CSS
        const codeBlocks = contentElement.querySelectorAll('pre code');
        codeBlocks.forEach(block => {
            block.classList.add('hljs');
        });
    }

    scrollToBottom() {
        requestAnimationFrame(() => {
            const scrollContainer = document.querySelector('.conversation-container');
            scrollContainer.scrollTo({
                top: scrollContainer.scrollHeight,
                behavior: 'smooth'
            });
        });
    }

    setStatus(message, isError = false) {
        this.elements.statusMessage.textContent = message;
        this.elements.statusMessage.className = isError ? 'error' : '';
    }

    playAudioInUI(base64Audio) {
        const audioSrc = `data:audio/mp3;base64,${base64Audio}`;
        this.elements.audioPlayer.src = audioSrc;
        this.elements.audioPlayer.play();
        
        // Mettre à jour le texte et afficher l'indicateur que l'assistant parle
        this.elements.recordingText.textContent = 'Assistant parle...';
        this.elements.recordingStatus.classList.add('speaking');
        
        // Afficher le bouton d'annulation de la synthèse vocale
        if (this.elements.cancelSpeechBtn) {
            this.elements.cancelSpeechBtn.classList.remove('hidden');
        }
        
        // Ajouter un gestionnaire d'événement pour lorsque l'audio se termine
        this.elements.audioPlayer.onended = () => {
            this.stopSpeaking();
        };
    }
    
    stopSpeaking() {
        // Masquer le bouton d'annulation et réinitialiser le statut
        if (this.elements.cancelSpeechBtn) {
            this.elements.cancelSpeechBtn.classList.add('hidden');
        }
        
        // Réinitialiser l'indicateur d'état
        this.elements.recordingStatus.classList.remove('speaking');
        this.elements.recordingText.textContent = 'Inactive';
    }

    clearInput() {
        this.elements.textInput.value = '';
    }

    disableTextInput(disable) {
        this.elements.sendTextBtn.disabled = disable;
        this.elements.textInput.disabled = disable;
    }
    
    updateAudioLevel(level) {
        if (!this.elements.audioLevelMeter) return;
        
        // Update the audio level meter height based on input level
        this.elements.audioLevelMeter.style.width = `${level}%`;
        
        // Add color classes based on audio level
        this.elements.audioLevelMeter.classList.remove('low-level', 'mid-level', 'high-level');
        
        if (level < 30) {
            this.elements.audioLevelMeter.classList.add('low-level');
        } else if (level < 70) {
            this.elements.audioLevelMeter.classList.add('mid-level');
        } else {
            this.elements.audioLevelMeter.classList.add('high-level');
        }
    }
}

const uiController = new UIController();
export default uiController;
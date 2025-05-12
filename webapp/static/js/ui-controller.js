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
            statusMessage: null,
            audioPlayer: null,
            assistantLoadingIndicator: null,
            userLoadingIndicator: null,
            ttsLangSelector: null
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
        this.elements.statusMessage = document.getElementById('status-message');
        this.elements.audioPlayer = document.getElementById('audio-player');
        this.elements.assistantLoadingIndicator = document.getElementById('assistant-loading-indicator');
        this.elements.userLoadingIndicator = document.getElementById('user-loading-indicator');
        this.elements.ttsLangSelector = document.getElementById('tts-lang-selector');
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
        
        const paragraph = document.createElement('p');
        paragraph.textContent = text;
        
        contentDiv.appendChild(paragraph);
        messageDiv.appendChild(contentDiv);
        this.elements.conversation.appendChild(messageDiv);
        
        this.scrollToBottom();
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
        
        this.elements.recordingText.textContent = 'Assistant parle...';
    }

    clearInput() {
        this.elements.textInput.value = '';
    }

    disableTextInput(disable) {
        this.elements.sendTextBtn.disabled = disable;
        this.elements.textInput.disabled = disable;
    }
}

const uiController = new UIController();
export default uiController;
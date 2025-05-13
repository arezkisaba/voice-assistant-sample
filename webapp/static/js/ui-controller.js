import uiSoundManager from './ui-sound-manager.js';

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
        
        this.isStreamingResponse = false;
        this.currentStreamingMessageDiv = null;
        this.currentStreamingContentDiv = null;
        this.streamedText = '';
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
        
        if (!document.getElementById('audio-level-meter')) {
            const meterContainer = document.createElement('div');
            meterContainer.id = 'audio-level-container';
            meterContainer.className = 'audio-level-container';
            const meter = document.createElement('div');
            meter.id = 'audio-level-meter';
            meter.className = 'audio-level-meter';
            meterContainer.appendChild(meter);
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

    async showAssistantLoading() {
        const conversation = document.getElementById('conversation');
        conversation.insertAdjacentElement('afterend', this.elements.assistantLoadingIndicator);
        this.elements.assistantLoadingIndicator.classList.add('active');
        await uiSoundManager.playThinkingSound();
        this.scrollToBottom();
    }

    hideAssistantLoading() {
        this.elements.assistantLoadingIndicator.classList.remove('active');
        uiSoundManager.stopAllSounds();
    }

    async showUserLoading() {
        this.elements.userLoadingIndicator.classList.add('active');
        await uiSoundManager.playThinkingSound();
        this.scrollToBottom();
    }

    hideUserLoading() {
        this.elements.userLoadingIndicator.classList.remove('active');
        uiSoundManager.stopAllSounds();
    }

    addMessage(sender, text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        const hasMarkdown = /(\*\*|__|##|```|\[.*\]\(.*\)|^\s*[-*+]\s|\|[-|]+\||^\s*>\s)/.test(text);
        
        if (hasMarkdown && sender === 'assistant') {
            contentDiv.innerHTML = marked.parse(text);
            contentDiv.classList.add('markdown-content');
            
            if (text.includes('```')) {
                this.applyCodeHighlighting(contentDiv);
            }
        } else {
            const paragraph = document.createElement('p');
            paragraph.textContent = text;
            contentDiv.appendChild(paragraph);
        }
        
        messageDiv.appendChild(contentDiv);
        this.elements.conversation.appendChild(messageDiv);
        
        this.scrollToBottom();
    }
    
    applyCodeHighlighting(contentElement) {
        const codeBlocks = contentElement.querySelectorAll('pre code');
        codeBlocks.forEach(block => {
            block.classList.add('hljs');
        });
    }

    scrollToBottom() {
        setTimeout(() => {
            requestAnimationFrame(() => {
                const scrollContainer = document.querySelector('.conversation-container');
                scrollContainer.scrollTo({
                    top: scrollContainer.scrollHeight,
                    behavior: 'smooth'
                });
            });
        }, 500);
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
        this.elements.recordingStatus.classList.add('speaking');
        
        if (this.elements.cancelSpeechBtn) {
            this.elements.cancelSpeechBtn.classList.remove('hidden');
        }
        
        this.elements.audioPlayer.onended = () => {
            this.stopSpeaking();
        };
    }
    
    stopSpeaking() {
        if (this.elements.cancelSpeechBtn) {
            this.elements.cancelSpeechBtn.classList.add('hidden');
        }
        
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
        if (!this.elements.audioLevelMeter) {
            return;
        }
        
        this.elements.audioLevelMeter.style.width = `${level}%`;
        this.elements.audioLevelMeter.classList.remove('low-level', 'mid-level', 'high-level');
        
        if (level < 30) {
            this.elements.audioLevelMeter.classList.add('low-level');
        } else if (level < 70) {
            this.elements.audioLevelMeter.classList.add('mid-level');
        } else {
            this.elements.audioLevelMeter.classList.add('high-level');
        }
    }

    startStreamingResponse(initialText) {
        this.isStreamingResponse = true;
        this.streamedText = initialText;
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant';
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        const hasMarkdown = /(\*\*|__|##|```|\[.*\]\(.*\)|^\s*[-*+]\s|\|[-|]+\||^\s*>\s|\n\n|\n\*)/.test(this.streamedText);
        
        if (hasMarkdown) {
            contentDiv.innerHTML = marked.parse(this.streamedText, {
                breaks: true,
                gfm: true
            });
            contentDiv.classList.add('markdown-content');
        } else {
            const paragraph = document.createElement('p');
            paragraph.textContent = this.streamedText;
            contentDiv.appendChild(paragraph);
        }
        
        messageDiv.appendChild(contentDiv);
        this.elements.conversation.appendChild(messageDiv);
        this.currentStreamingMessageDiv = messageDiv;
        this.currentStreamingContentDiv = contentDiv;
        
        this.scrollToBottom();
    }
    
    appendToStreamingResponse(textChunk) {
        if (!this.isStreamingResponse || !this.currentStreamingContentDiv) {
            this.startStreamingResponse(textChunk);
            return;
        }

        let processedChunk = textChunk;
        processedChunk = processedChunk.replace(/\\u([0-9a-fA-F]{4})/g, (match, code) => {
            return String.fromCharCode(parseInt(code, 16));
        });
        processedChunk = processedChunk.replace(/\\n/g, '\n');
        
        const isListItem = processedChunk.trim().match(/^(\d+\.|\*|\-|\+)\s/);
        if (isListItem) {
            console.log('1');
            if (!this.streamedText.endsWith('\n') && this.streamedText.length > 0) {
                this.streamedText += '\n' + processedChunk;
            } else {
                this.streamedText += processedChunk;
            }
        } else {
            this.streamedText += processedChunk;
        }

        let processedText = this.streamedText;
        processedText = processedText.replace(/^(\*\*|\*|\d+\.)(.*)$/gm, '\n$1$2\n');

        console.warn("Texte reçu :", textChunk);
        console.log("Texte complet :", processedText);

        const hasMarkdown = /(\*\*|__|##|```|\[.*\]\(.*\)|^\s*[-*+]\s|\|[-|]+\||^\s*>\s|\d+\.\s|\*[^*]+\*|_[^_]+_)/.test(processedText);
        if (hasMarkdown) {
            this.currentStreamingContentDiv.innerHTML = marked.parse(processedText, { 
                breaks: true,
                gfm: true
            });
            this.currentStreamingContentDiv.classList.add('markdown-content');
            if (processedText.includes('```')) {
                this.applyCodeHighlighting(this.currentStreamingContentDiv);
            }
        } else {
            const paragraph = this.currentStreamingContentDiv.querySelector('p');
            if (paragraph) {
                paragraph.textContent = processedText;
            } else {
                const newParagraph = document.createElement('p');
                newParagraph.textContent = processedText;
                this.currentStreamingContentDiv.appendChild(newParagraph);
            }
        }
        
        this.scrollToBottom();
    }
    
    completeStreamingResponse() {
        this.isStreamingResponse = false;
        this.currentStreamingMessageDiv = null;
        this.currentStreamingContentDiv = null;
        this.streamedText = '';
        this.scrollToBottom();
    }
}

const uiController = new UIController();
export default uiController;